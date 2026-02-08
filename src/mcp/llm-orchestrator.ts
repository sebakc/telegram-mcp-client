import { generateText, type CoreMessage, type CoreTool, jsonSchema } from 'ai';
import { google } from '@ai-sdk/google';
import type { LLMConfig, MCPTool, ConversationMessage } from '../types/index.js';
import logger from '../utils/logger.js';

export class LLMOrchestrator {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  private getModel() {
    switch (this.config.provider) {
      case 'google':
        // Set API key via environment variable for Google AI
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = this.config.apiKey;
        return google(this.config.model);
      case 'anthropic':
        // Import dynamically when needed
        throw new Error('Anthropic provider not yet implemented. Install @ai-sdk/anthropic');
      case 'openai':
        // Import dynamically when needed
        throw new Error('OpenAI provider not yet implemented. Install @ai-sdk/openai');
      default:
        throw new Error(`Unsupported provider: ${this.config.provider}`);
    }
  }

  private convertMCPToolsToAITools(
    mcpTools: MCPTool[],
    onToolCall: (toolName: string, args: Record<string, unknown>) => Promise<unknown>
  ): Record<string, CoreTool> {
    const tools: Record<string, CoreTool> = {};

    for (const tool of mcpTools) {
      tools[tool.name] = {
        description: tool.description,
        parameters: jsonSchema(tool.inputSchema as any),
        execute: async (args: Record<string, unknown>) => {
          logger.info(`Executing tool via AI SDK: ${tool.name}`);
          const result = await onToolCall(tool.name, args);
          return result;
        },
      };
    }

    return tools;
  }

  async processQuery(
    query: string,
    conversationHistory: ConversationMessage[],
    availableTools: MCPTool[],
    onToolCall: (toolName: string, args: Record<string, unknown>) => Promise<unknown>
  ): Promise<string> {
    try {
      logger.info(`Processing query with ${availableTools.length} available tools`);

      const model = this.getModel();
      const tools = this.convertMCPToolsToAITools(availableTools, onToolCall);

      // Build messages array from conversation history
      const messages: CoreMessage[] = conversationHistory.map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Add the new user query
      messages.push({
        role: 'user',
        content: query,
      });

      const systemPrompt = `You are a helpful AI assistant with access to various tools through the Model Context Protocol (MCP).
You can help users by using the available tools to perform tasks, access data, and answer questions.
Always use the appropriate tools when they can help answer the user's question.
Provide clear, concise responses and explain what you're doing when using tools.`;

      let response = await generateText({
        model,
        messages,
        tools,
        system: systemPrompt,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        maxSteps: 10, // Allow multiple tool calls
      });

      logger.info(`LLM response received with ${response.steps.length} steps`);

      return response.text;
    } catch (error) {
      logger.error('Failed to process query:', error);
      throw error;
    }
  }

  async processQuerySimple(
    query: string,
    availableTools: MCPTool[],
    onToolCall: (toolName: string, args: Record<string, unknown>) => Promise<unknown>
  ): Promise<string> {
    try {
      logger.info(`Processing simple query with ${availableTools.length} available tools`);

      const model = this.getModel();
      const tools = this.convertMCPToolsToAITools(availableTools, onToolCall);

      const systemPrompt = `You are a helpful AI assistant with access to various tools through the Model Context Protocol (MCP).
You can help users by using the available tools to perform tasks, access data, and answer questions.
Always use the appropriate tools when they can help answer the user's question.
Provide clear, concise responses and explain what you're doing when using tools.`;

      const response = await generateText({
        model,
        messages: [
          {
            role: 'user',
            content: query,
          },
        ],
        tools,
        system: systemPrompt,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        maxSteps: 10,
      });

      logger.info(`LLM response received`);

      return response.text;
    } catch (error) {
      logger.error('Failed to process query:', error);
      throw error;
    }
  }
}