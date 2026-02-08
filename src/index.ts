import { loadConfig } from './config/index.js';
import { TelegramBot } from './bot/telegram-bot.js';
import logger from './utils/logger.js';

async function main() {
  try {
    logger.info('Starting MCP Telegram Client...');

    // Load configuration
    const config = loadConfig();
    logger.info(`Using AI provider: ${config.llm.provider} with model: ${config.llm.model}`);

    // Create and start bot
    const bot = new TelegramBot(config);
    await bot.start();
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

main();
