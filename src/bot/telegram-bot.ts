import { Telegraf, Context } from 'telegraf';
import type { Update } from 'telegraf/types';
import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { MCPClient } from '../mcp/client.js';
import { LLMOrchestrator } from '../mcp/llm-orchestrator.js';
import { SessionManager } from '../session/manager.js';
import type { AppConfig, MCPServerConfig, ConversationMessage } from '../types/index.js';
import logger from '../utils/logger.js';

export class TelegramBot {
  private bot: Telegraf<Context<Update>>;
  private mcpClient: MCPClient;
  private llmOrchestrator: LLMOrchestrator;
  private sessionManager: SessionManager;
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;

    // Configure Telegraf to use local API if enabled
    let telegrafOptions: any = {};
    if (config.telegram.useLocalApi && config.telegram.apiUrl) {
      logger.info(`Using Telegram Bot API Local at: ${config.telegram.apiUrl}`);
      telegrafOptions = {
        telegram: {
          apiRoot: config.telegram.apiUrl,
        },
      };
    }

    logger.info(`Telegraf options:`, telegrafOptions);
    this.bot = new Telegraf(config.telegram.botToken, telegrafOptions);

    // Verify and log the API root being used
    if (config.telegram.useLocalApi && config.telegram.apiUrl) {
      logger.info(`Bot telegram options BEFORE override:`, (this.bot.telegram as any).options);
      (this.bot.telegram as any).options.apiRoot = config.telegram.apiUrl;
      logger.info(`Bot telegram options AFTER override:`, (this.bot.telegram as any).options);
    }

    this.mcpClient = new MCPClient();
    this.llmOrchestrator = new LLMOrchestrator(config.llm);
    this.sessionManager = new SessionManager();

    this.setupHandlers();
  }

  private async processTranslationInBackground(
    userId: string,
    chatId: number,
    filePath: string,
    query: string,
    instructions: string
  ): Promise<void> {
    const MAX_RETRIES = 3;
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < MAX_RETRIES) {
      try {
        attempt++;
        logger.info(`Starting background translation for user ${userId}, file: ${filePath} (attempt ${attempt}/${MAX_RETRIES})`);

        if (attempt > 1) {
          await this.bot.telegram.sendMessage(
            chatId,
            `🔄 Reintentando traducción (intento ${attempt}/${MAX_RETRIES})...`
          );
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Send typing indicator
        await this.bot.telegram.sendChatAction(chatId, 'upload_document');

        // Extract language from caption/instructions
        let sourceLang = 'en';
        let targetLang = 'es';

        const lowerInstructions = instructions.toLowerCase();
        if (lowerInstructions.includes('to spanish') || lowerInstructions.includes('a español')) {
          targetLang = 'es';
        } else if (lowerInstructions.includes('to english') || lowerInstructions.includes('a inglés')) {
          targetLang = 'en';
        } else if (lowerInstructions.includes('to french') || lowerInstructions.includes('a francés')) {
          targetLang = 'fr';
        }

        logger.info(`Translating ${filePath} from ${sourceLang} to ${targetLang}`);

        // Call translate_pdf tool DIRECTLY (no LLM overhead)
        const result = await this.mcpClient.executeTool('translate_pdf', {
          filePath,
          sourceLang,
          targetLang,
        });

        logger.info(`Translation result:`, JSON.stringify(result, null, 2));

        // Parse the result
        let translatedFilePath: string | null = null;
        let originalFileName = filePath.split('/').pop() || 'document';
        let fileSize = 'N/A';

        if (result && typeof result === 'object') {
          const content = (result as any).content || [];
          logger.info(`Result content array length: ${content.length}`);

          for (const item of content) {
            logger.info(`Content item type: ${item.type}`);
            if (item.type === 'text') {
              logger.info(`Text content: ${item.text}`);
              try {
                const data = JSON.parse(item.text);
                logger.info(`Parsed data:`, data);

                if (data.translatedFile) {
                  translatedFilePath = data.translatedFile;
                  originalFileName = data.originalFile?.split('/').pop() || originalFileName;
                  fileSize = data.fileSizeReadable || fileSize;

                  logger.info(`✅ Found translated file path: ${translatedFilePath}`);
                  logger.info(`   Original file: ${originalFileName}`);
                  logger.info(`   Size: ${fileSize}`);
                }
              } catch (err) {
                logger.error('Error parsing tool result:', err);
              }
            }
          }
        }

        // Send the file if we got it
        if (translatedFilePath && existsSync(translatedFilePath)) {
          const fs = await import('fs/promises');
          const fileStats = await fs.stat(translatedFilePath);

          logger.info(`📤 Sending translated file to user: ${translatedFilePath}`);
          logger.info(`   File exists: ${existsSync(translatedFilePath)}`);
          logger.info(`   File size on disk: ${fileStats.size} bytes`);

          await this.bot.telegram.sendDocument(chatId, { source: translatedFilePath });

          await this.bot.telegram.sendMessage(
            chatId,
            `✅ ¡Traducción completada!\n\n📄 Original: ${originalFileName}\n📊 Tamaño: ${fileSize}`
          );

          logger.info(`Background translation completed successfully for user ${userId}`);
          return; // Success! Exit the retry loop
        } else {
          throw new Error(`Archivo traducido no encontrado: ${translatedFilePath}`);
        }
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.error(`Background translation error for user ${userId} (attempt ${attempt}/${MAX_RETRIES}):`, error);

        // Special handling for timeout errors - file might have been created anyway
        if (error?.message?.includes('timeout') || error?.code === -32001) {
          logger.warn(`MCP timeout detected, checking if translation completed anyway...`);

          // Wait for file to potentially finish writing
          await new Promise(resolve => setTimeout(resolve, 10000));

          const tempDir = join(process.cwd(), 'temp');
          const fs = await import('fs/promises');

          // List all files that match the translated pattern
          const files = await fs.readdir(tempDir);
          const fileName = filePath.split('/').pop() || '';

          logger.info(`Looking for translated file matching: translated_*${fileName}`);
          logger.info(`Files in temp dir: ${files.filter(f => f.includes('translated_')).join(', ')}`);

          // Find the translated file (could have extra prefix)
          const translatedFile = files.find(f =>
            f.startsWith('translated_') && f.endsWith(fileName.replace(/^\d+_/, ''))
          );

          if (translatedFile) {
            const fullPath = join(tempDir, translatedFile);
            logger.info(`✅ Translation file found despite timeout: ${fullPath}`);

            await this.bot.telegram.sendDocument(chatId, { source: fullPath });
            await this.bot.telegram.sendMessage(chatId, '✅ ¡Traducción completada exitosamente!');
            return; // Success!
          } else {
            logger.error(`Translation file not found. Searched for pattern: translated_*${fileName}`);
          }
        }

        if (attempt < MAX_RETRIES) {
          // Wait before retrying (exponential backoff)
          const delaySeconds = Math.pow(2, attempt) * 5; // 10s, 20s, 40s
          logger.info(`Retrying in ${delaySeconds} seconds...`);

          await this.bot.telegram.sendMessage(
            chatId,
            `⚠️ Intento de traducción ${attempt} falló. Reintentando en ${delaySeconds} segundos...`
          );

          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }
      }
    }

    // If we get here, all retries failed
    logger.error(`All ${MAX_RETRIES} translation attempts failed for user ${userId}`);
    await this.bot.telegram.sendMessage(
      chatId,
      `❌ La traducción falló después de ${MAX_RETRIES} intentos.\n\n` +
      `Error: ${lastError?.message || 'Error desconocido'}\n\n` +
      `Por favor intenta de nuevo más tarde o contacta a soporte.`
    );
  }

  private setupHandlers(): void {
    // Ensure temp directory exists
    const tempDir = join(process.cwd(), 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Start command
    this.bot.command('start', async (ctx) => {
      const welcomeMessage = `¡Bienvenido al Cliente MCP de Telegram! 🤖\n\nSoy un asistente de IA impulsado por el Protocolo de Contexto de Modelo.\n\nComandos disponibles:\n/help - Mostrar este mensaje de ayuda\n/connect <server_id> - Conectar a un servidor MCP\n/disconnect <server_id> - Desconectar de un servidor\n/servers - Listar servidores conectados y herramientas disponibles\n/reset - Limpiar historial de conversación\n\nPuedes enviarme:\n- Mensajes de texto\n- Documentos PDF (¡puedo traducirlos!)\n\n¡Simplemente sube un archivo y dime qué quieres hacer con él!`;

      await ctx.reply(welcomeMessage);
    });

    // Help command
    this.bot.command('help', async (ctx) => {
      await ctx.reply(`Comandos disponibles:\n/start - Mensaje de bienvenida\n/help - Mostrar esta ayuda\n/connect <server_id> - Conectar a servidor MCP\n/disconnect <server_id> - Desconectar del servidor\n/servers - Listar servidores y herramientas conectadas\n/reset - Limpiar historial de conversación\n\n¡Simplemente envíame un mensaje para chatear!`);
    });

    // Connect command
    this.bot.command('connect', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        await ctx.reply('Uso: /connect <server_id>\n\nServidores disponibles: (configurar en servers.json)');
        return;
      }

      const serverId = args[0];
      const userId = ctx.from.id.toString();

      try {
        await ctx.reply(`Conectando a ${serverId}...`);

        // Find server config
        const serverConfig = this.config.mcp.servers.find((s) => s.id === serverId);
        if (!serverConfig) {
          await ctx.reply(`Servidor ${serverId} no encontrado en la configuración.`);
          return;
        }

        await this.mcpClient.connect(serverConfig);
        this.sessionManager.addActiveServer(userId, serverId);

        const tools = this.mcpClient.getAllTools();
        await ctx.reply(
          `✅ Conectado a ${serverConfig.name}!\n\nHerramientas disponibles (${tools.length}):\n${tools.map((t) => `• ${t.name}: ${t.description}`).join('\n')}`
        );
      } catch (error) {
        logger.error('Failed to connect to server:', error);
        await ctx.reply(`❌ Error al conectar a ${serverId}: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      }
    });

    // Disconnect command
    this.bot.command('disconnect', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        await ctx.reply('Uso: /disconnect <server_id>');
        return;
      }

      const serverId = args[0];
      const userId = ctx.from.id.toString();

      try {
        await this.mcpClient.disconnect(serverId);
        this.sessionManager.removeActiveServer(userId, serverId);
        await ctx.reply(`✅ Desconectado de ${serverId}`);
      } catch (error) {
        logger.error('Failed to disconnect:', error);
        await ctx.reply(`❌ Error al desconectar: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      }
    });

    // Servers command
    this.bot.command('servers', async (ctx) => {
      const connectedServers = this.mcpClient.getConnectedServers();
      const tools = this.mcpClient.getAllTools();

      if (connectedServers.length === 0) {
        await ctx.reply('No hay servidores conectados. Usa /connect <server_id> para conectar a un servidor.');
        return;
      }

      let message = `📡 Servidores Conectados (${connectedServers.length}):\n${connectedServers.map((s) => `• ${s}`).join('\n')}\n\n`;
      message += `🔧 Herramientas Disponibles (${tools.length}):\n${tools.map((t) => `• ${t.name}: ${t.description}`).join('\n')}`;

      await ctx.reply(message);
    });

    // Reset command
    this.bot.command('reset', async (ctx) => {
      const userId = ctx.from.id.toString();
      this.sessionManager.clearHistory(userId);
      await ctx.reply('✅ Historial de conversación limpiado!');
    });

    // Handle documents (PDFs, etc.)
    this.bot.on('document', async (ctx) => {
      const userId = ctx.from.id.toString();
      const document = ctx.message.document;
      const caption = ctx.message.caption || '';

      try {
        const fileSizeMB = document.file_size ? document.file_size / (1024 * 1024) : 0;
        logger.info(`Receiving file: ${document.file_name} (${fileSizeMB.toFixed(2)} MB)`);

        await ctx.reply(`📥 Downloading file (${fileSizeMB.toFixed(2)} MB)...`);

        // Get file info
        const file = await this.bot.telegram.getFile(document.file_id);

        // Download file
        const tempDir = join(process.cwd(), 'temp');
        const localFilePath = join(tempDir, `${userId}_${document.file_name}`);
        const fs = await import('fs/promises');

        if (this.config.telegram.useLocalApi && this.config.telegram.apiUrl) {
          // LOCAL API MODE: file.file_path is an absolute path inside the Docker container
          // We need to map it to the host volume path since the app runs on the host
          if (!file.file_path) {
            throw new Error('File path is undefined in local API mode');
          }
          const containerBasePath = '/var/lib/telegram-bot-api';
          const hostBasePath = process.env.TELEGRAM_LOCAL_DATA_DIR || `${process.env.HOME}/telegram-bot-api-data`;
          const hostFilePath = file.file_path.replace(containerBasePath, hostBasePath);

          logger.info(`Local API mode - container path: ${file.file_path}`);
          logger.info(`Local API mode - host path: ${hostFilePath}`);
          await fs.copyFile(hostFilePath, localFilePath);
        } else {
          // PUBLIC API MODE: Download file via HTTP
          const fileUrl = `https://api.telegram.org/file/bot${this.config.telegram.botToken}/${file.file_path}`;
          logger.info(`Downloading from: ${fileUrl}`);
          const response = await fetch(fileUrl);
          const buffer = await response.arrayBuffer();
          await fs.writeFile(localFilePath, Buffer.from(buffer));
        }

        logger.info(`File ready: ${localFilePath}`);

        // Build query with file path
        const query = caption
          ? `${caption}\n\nFile path: ${localFilePath}`
          : `Translate this document: ${localFilePath}`;

        // Get available tools
        const tools = this.mcpClient.getAllTools();

        if (tools.length === 0) {
          await ctx.reply('No hay servidores MCP conectados. Por favor usa /connect para conectar primero a un servidor.');
          return;
        }

        // Check if there's a translate_pdf tool available
        const hasTranslateTool = tools.some(t => t.name === 'translate_pdf');

        if (hasTranslateTool) {
          // Respond immediately
          await ctx.reply(
            `🔄 Tu documento está siendo traducido...\n\n` +
            `📄 Archivo: ${document.file_name}\n` +
            `📊 Tamaño: ${fileSizeMB.toFixed(2)} MB\n\n` +
            `Te enviaré el documento traducido cuando esté listo. Esto puede tomar unos minutos.`
          );

          // Store chatId for sending the file later
          const chatId = ctx.chat.id;

          // Process translation in background (no await)
          this.processTranslationInBackground(
            userId,
            chatId,
            localFilePath,
            query,
            caption || 'Translate to Spanish'
          ).catch((error) => {
            logger.error(`Background translation failed for user ${userId}:`, error);
            this.bot.telegram.sendMessage(
              chatId,
              `❌ Error en la traducción: ${error instanceof Error ? error.message : 'Error desconocido'}`
            ).catch(err => logger.error('Failed to send error message:', err));
          });
        } else {
          // No translation tool, process normally
          await ctx.sendChatAction('typing');
          const session = this.sessionManager.getSession(userId);

          const userMessage: ConversationMessage = {
            role: 'user',
            content: query,
            timestamp: Date.now(),
          };
          this.sessionManager.addMessage(userId, userMessage);

          const llmResponse = await this.llmOrchestrator.processQuery(
            query,
            session.conversationHistory,
            tools,
            async (toolName, args) => {
              logger.info(`Executing tool ${toolName} for user ${userId}`);
              return await this.mcpClient.executeTool(toolName, args);
            }
          );

          const assistantMessage: ConversationMessage = {
            role: 'assistant',
            content: llmResponse,
            timestamp: Date.now(),
          };
          this.sessionManager.addMessage(userId, assistantMessage);

          await ctx.reply(llmResponse);
        }

      } catch (error) {
        logger.error('Error processing document:', error);
        await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      }
    });

    // Handle regular messages
    this.bot.on('text', async (ctx) => {
      // Skip if it's a command
      if (ctx.message.text.startsWith('/')) {
        return;
      }

      const userId = ctx.from.id.toString();
      const query = ctx.message.text;

      try {
        // Show typing indicator
        await ctx.sendChatAction('typing');

        logger.info(`Processing query from user ${userId}: ${query}`);

        // Get available tools
        const tools = this.mcpClient.getAllTools();

        // Get session
        const session = this.sessionManager.getSession(userId);

        // Add user message to history
        const userMessage: ConversationMessage = {
          role: 'user',
          content: query,
          timestamp: Date.now(),
        };
        this.sessionManager.addMessage(userId, userMessage);

        // Store tool results to check for files
        const toolResults: any[] = [];

        // Process query with LLM
        const response = await this.llmOrchestrator.processQuery(
          query,
          session.conversationHistory,
          tools,
          async (toolName, args) => {
            logger.info(`Executing tool ${toolName} for user ${userId}`);
            await ctx.sendChatAction('typing');
            const result = await this.mcpClient.executeTool(toolName, args);
            toolResults.push({ toolName, result });
            return result;
          }
        );

        // Add assistant response to history
        const assistantMessage: ConversationMessage = {
          role: 'assistant',
          content: response,
          timestamp: Date.now(),
        };
        this.sessionManager.addMessage(userId, assistantMessage);

        // Send response
        await ctx.reply(response, { parse_mode: 'Markdown' });

        // Check if any tool returned a file to send
        for (const { toolName, result } of toolResults) {
          if (result && typeof result === 'object') {
            const content = (result as any).content || [];
            for (const item of content) {
              if (item.type === 'text') {
                try {
                  const data = JSON.parse(item.text);
                  if (data.translatedFile && existsSync(data.translatedFile)) {
                    logger.info(`Sending file: ${data.translatedFile}`);
                    await ctx.replyWithDocument({ source: data.translatedFile });
                  }
                } catch (err) {
                  // Not JSON or file doesn't exist, skip
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error('Error processing message:', error);
        await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Error desconocido'}`);
      }
    });

    // Error handling
    this.bot.catch((err, ctx) => {
      logger.error('Bot error:', err);
      ctx.reply('Ocurrió un error al procesar tu solicitud.');
    });
  }

  async start(): Promise<void> {
    logger.info('Starting Telegram bot...');

    // Auto-connect to servers if configured
    for (const serverConfig of this.config.mcp.servers) {
      if (serverConfig.autoConnect) {
        try {
          logger.info(`Auto-connecting to ${serverConfig.name}...`);
          await this.mcpClient.connect(serverConfig);
        } catch (error) {
          logger.error(`Failed to auto-connect to ${serverConfig.name}:`, error);
        }
      }
    }

    // Start session cleanup
    this.sessionManager.startCleanup();

    // Launch bot
    await this.bot.launch();
    logger.info('Telegram bot started successfully!');

    // Enable graceful stop
    process.once('SIGINT', () => this.stop('SIGINT'));
    process.once('SIGTERM', () => this.stop('SIGTERM'));
  }

  async stop(signal: string): Promise<void> {
    logger.info(`Received ${signal}, stopping bot...`);
    this.bot.stop(signal);
    await this.mcpClient.disconnectAll();
    logger.info('Bot stopped');
    process.exit(0);
  }
}
