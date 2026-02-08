export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  autoConnect?: boolean;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface Session {
  userId: string;
  conversationHistory: ConversationMessage[];
  activeServers: Set<string>;
  createdAt: number;
  lastActivity: number;
}

export interface LLMConfig {
  provider: 'google' | 'anthropic' | 'openai';
  model: string;
  apiKey: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AppConfig {
  telegram: {
    botToken: string;
    useLocalApi: boolean;
    apiUrl?: string;
  };
  llm: LLMConfig;
  mcp: {
    servers: MCPServerConfig[];
  };
  logging: {
    level: string;
  };
}
