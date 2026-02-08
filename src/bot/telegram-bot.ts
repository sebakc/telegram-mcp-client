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
            `🔄 Retrying translation (attempt ${attempt}/${MAX_RETRIES})...`
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
                logger.info(`Parsed data:`, JSON.stringify(data, null, 2));

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
            `✅ Translation complete!\n\n📄 Original: ${originalFileName}\n📊 Size: ${fileSize}`
          );

          logger.info(`Background translation completed successfully for user ${userId}`);
          return; // Success! Exit the retry loop
        } else {
          throw new Error(`Translated file not found: ${translatedFilePath}`);
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
            await this.bot.telegram.sendMessage(chatId, '✅ Translation completed successfully!');
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
            `⚠️ Translation attempt ${attempt} failed. Retrying in ${delaySeconds} seconds...`
          );

          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }
      }
    }

    // If we get here, all retries failed
    logger.error(`All ${MAX_RETRIES} translation attempts failed for user ${userId}`);
    await this.bot.telegram.sendMessage(
      chatId,
      `❌ Translation failed after ${MAX_RETRIES} attempts.\n\n` +
      `Error: ${lastError?.message || 'Unknown error'}\n\n` +
      `Please try again later or contact support.`
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
      const welcomeMessage = `Welcome to MCP Telegram Client! 🤖\n\nI'm an AI assistant powered by the Model Context Protocol.\n\nAvailable commands:\n/help - Show this help message\n/connect <server_id> - Connect to an MCP server\n/disconnect <server_id> - Disconnect from a server\n/servers - List all connected servers and available tools\n/reset - Clear conversation history\n\nYou can send me:\n- Text messages\n- PDF documents (I can translate them!)\n\nJust upload a file and tell me what you want to do with it!`;

      await ctx.reply(welcomeMessage);
    });

    // Help command
    this.bot.command('help', async (ctx) => {
      await ctx.reply(`Available commands:\n/start - Welcome message\n/help - Show this help\n/connect <server_id> - Connect to MCP server\n/disconnect <server_id> - Disconnect from server\n/servers - List connected servers and tools\n/reset - Clear conversation history\n\nJust send me a message to chat!`);
    });

    // Connect command
    this.bot.command('connect', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        await ctx.reply('Usage: /connect <server_id>\n\nAvailable servers: (configure in servers.json)');
        return;
      }

      const serverId = args[0];
      const userId = ctx.from.id.toString();

      try {
        await ctx.reply(`Connecting to ${serverId}...`);

        // Find server config
        const serverConfig = this.config.mcp.servers.find((s) => s.id === serverId);
        if (!serverConfig) {
          await ctx.reply(`Server ${serverId} not found in configuration.`);
          return;
        }

        await this.mcpClient.connect(serverConfig);
        this.sessionManager.addActiveServer(userId, serverId);

        const tools = this.mcpClient.getAllTools();
        await ctx.reply(
          `✅ Connected to ${serverConfig.name}!\n\nAvailable tools (${tools.length}):\n${tools.map((t) => `• ${t.name}: ${t.description}`).join('\n')}`
        );
      } catch (error) {
        logger.error('Failed to connect to server:', error);
        await ctx.reply(`❌ Failed to connect to ${serverId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    // Disconnect command
    this.bot.command('disconnect', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length === 0) {
        await ctx.reply('Usage: /disconnect <server_id>');
        return;
      }

      const serverId = args[0];
      const userId = ctx.from.id.toString();

      try {
        await this.mcpClient.disconnect(serverId);
        this.sessionManager.removeActiveServer(userId, serverId);
        await ctx.reply(`✅ Disconnected from ${serverId}`);
      } catch (error) {
        logger.error('Failed to disconnect:', error);
        await ctx.reply(`❌ Failed to disconnect: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    // Servers command
    this.bot.command('servers', async (ctx) => {
      const connectedServers = this.mcpClient.getConnectedServers();
      const tools = this.mcpClient.getAllTools();

      if (connectedServers.length === 0) {
        await ctx.reply('No servers connected. Use /connect <server_id> to connect to a server.');
        return;
      }

      let message = `📡 Connected Servers (${connectedServers.length}):\n${connectedServers.map((s) => `• ${s}`).join('\n')}\n\n`;
      message += `🔧 Available Tools (${tools.length}):\n${tools.map((t) => `• ${t.name}: ${t.description}`).join('\n')}`;

      await ctx.reply(message);
    });

    // Reset command
    this.bot.command('reset', async (ctx) => {
      const userId = ctx.from.id.toString();
      this.sessionManager.clearHistory(userId);
      await ctx.reply('✅ Conversation history cleared!');
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
          await ctx.reply('No MCP servers connected. Please use /connect to connect to a server first.');
          return;
        }

        // Check if there's a translate_pdf tool available
        const hasTranslateTool = tools.some(t => t.name === 'translate_pdf');

        if (hasTranslateTool) {
          // Respond immediately
          await ctx.reply(
            `🔄 Your document is being translated...\n\n` +
            `📄 File: ${document.file_name}\n` +
            `📊 Size: ${fileSizeMB.toFixed(2)} MB\n\n` +
            `I'll send you the translated document when it's ready. This may take a few minutes.`
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
              `❌ Translation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
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
        await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
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

        if (tools.length === 0) {
          await ctx.reply('No MCP servers connected. Please use /connect to connect to a server first.');
          return;
        }

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
        await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
      }
    });

    // Error handling
    this.bot.catch((err, ctx) => {
      logger.error('Bot error:', err);
      ctx.reply('An error occurred while processing your request.');
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
