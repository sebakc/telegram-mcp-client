import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { AppConfig, MCPServerConfig } from '../types/index.js';

dotenv.config();

export function loadConfig(): AppConfig {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is required in environment variables');
  }

  const aiProvider = (process.env.AI_PROVIDER || 'google') as 'google' | 'anthropic' | 'openai';

  let apiKey: string;
  let model: string;

  switch (aiProvider) {
    case 'google':
      apiKey = process.env.GOOGLE_API_KEY || '';
      model = process.env.GOOGLE_MODEL || 'gemini-1.5-pro';
      break;
    case 'anthropic':
      apiKey = process.env.ANTHROPIC_API_KEY || '';
      model = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
      break;
    case 'openai':
      apiKey = process.env.OPENAI_API_KEY || '';
      model = process.env.OPENAI_MODEL || 'gpt-4-turbo';
      break;
    default:
      throw new Error(`Unsupported AI provider: ${aiProvider}`);
  }

  if (!apiKey) {
    throw new Error(`API key for ${aiProvider} is required`);
  }

  // Load MCP servers from servers.json file or environment variable
  const servers: MCPServerConfig[] = [];

  // Try to load from servers.json file
  const serversFilePath = join(process.cwd(), 'servers.json');
  if (existsSync(serversFilePath)) {
    try {
      const fileContent = readFileSync(serversFilePath, 'utf-8');
      const parsed = JSON.parse(fileContent);
      if (parsed.servers && Array.isArray(parsed.servers)) {
        servers.push(...parsed.servers);
        console.log(`Loaded ${servers.length} MCP servers from servers.json`);
      }
    } catch (error) {
      console.error('Failed to parse servers.json:', error);
    }
  }

  // Also support loading from environment variable (takes precedence)
  const serversJson = process.env.MCP_SERVERS;
  if (serversJson) {
    try {
      const parsed = JSON.parse(serversJson);
      if (Array.isArray(parsed)) {
        servers.push(...parsed);
      }
    } catch (error) {
      console.error('Failed to parse MCP_SERVERS:', error);
    }
  }

  const useLocalApi = process.env.USE_LOCAL_API === 'true';
  const apiUrl = process.env.TELEGRAM_API_URL || 'http://localhost:8081';

  console.log(`[CONFIG] USE_LOCAL_API: ${process.env.USE_LOCAL_API} -> ${useLocalApi}`);
  console.log(`[CONFIG] TELEGRAM_API_URL: ${apiUrl}`);

  return {
    telegram: {
      botToken: telegramToken,
      useLocalApi,
      apiUrl: useLocalApi ? apiUrl : undefined,
    },
    llm: {
      provider: aiProvider,
      model,
      apiKey,
      maxTokens: parseInt(process.env.MAX_TOKENS || '4096'),
      temperature: parseFloat(process.env.TEMPERATURE || '0.7'),
    },
    mcp: {
      servers,
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
    },
  };
}
