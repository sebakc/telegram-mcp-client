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

  private setupHandlers(): void {
    // Ensure temp directory exists
    const tempDir = join(process.cwd(), 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    // Start command
    this.bot.command('start', async (ctx) => {
      const welcomeMessage = `Welcome to MCP Telegram Client! 🤖

I'm an AI assistant powered by the Model Context Protocol.

Available commands:
/help - Show this help message
/connect <server_id> - Connect to an MCP server
/disconnect <server_id> - Disconnect from a server
/servers - List all connected servers and available tools
/reset - Clear conversation history

You can send me:
- Text messages
- PDF documents (I can translate them!)

Just upload a file and tell me what you want to do with it!`;

      await ctx.reply(welcomeMessage);
    });

    // Help command
    this.bot.command('help', async (ctx) => {
      await ctx.reply(`Available commands:
/start - Welcome message
/help - Show this help
/connect <server_id> - Connect to MCP server
/disconnect <server_id> - Disconnect from server
/servers - List connected servers and tools
/reset - Clear conversation history

Just send me a message to chat!`);
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

        // Use the correct API root (local or public)
        const apiRoot = this.config.telegram.useLocalApi && this.config.telegram.apiUrl
          ? this.config.telegram.apiUrl
          : 'https://api.telegram.org';

        const fileUrl = `${apiRoot}/file/bot${this.config.telegram.botToken}/${file.file_path}`;
        logger.info(`Downloading from: ${fileUrl}`);

        // Download file
        const tempDir = join(process.cwd(), 'temp');
        const localFilePath = join(tempDir, `${userId}_${document.file_name}`);

        const response = await fetch(fileUrl);
        const buffer = await response.arrayBuffer();
        const fs = await import('fs/promises');
        await fs.writeFile(localFilePath, Buffer.from(buffer));

        logger.info(`File downloaded: ${localFilePath}`);

        // Build query with file path
        const query = caption
          ? `${caption}\n\nFile path: ${localFilePath}`
          : `I received a file at ${localFilePath}. What should I do with it?`;

        await ctx.sendChatAction('typing');

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
        const llmResponse = await this.llmOrchestrator.processQuery(
          query,
          session.conversationHistory,
          tools,
          async (toolName, args) => {
            logger.info(`Executing tool ${toolName} for user ${userId}`, args);
            await ctx.sendChatAction('typing');
            const result = await this.mcpClient.executeTool(toolName, args);
            logger.info(`Tool result:`, result);
            toolResults.push({ toolName, result });
            return result;
          }
        );

        // Add assistant response to history
        const assistantMessage: ConversationMessage = {
          role: 'assistant',
          content: llmResponse,
          timestamp: Date.now(),
        };
        this.sessionManager.addMessage(userId, assistantMessage);

        // Send text response
        await ctx.reply(llmResponse, { parse_mode: 'Markdown' });

        // Check if any tool returned a translated file
        for (const { toolName, result } of toolResults) {
          if (result && typeof result === 'object') {
            const content = (result as any).content || [];
            for (const item of content) {
              if (item.type === 'text') {
                try {
                  const data = JSON.parse(item.text);
                  if (data.translatedFile && existsSync(data.translatedFile)) {
                    logger.info(`Sending translated file: ${data.translatedFile}`);
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
