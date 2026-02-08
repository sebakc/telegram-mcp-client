import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MCPServerConfig, MCPTool } from '../types/index.js';
import logger from '../utils/logger.js';

export class MCPClient {
  private clients: Map<string, Client> = new Map();
  private transports: Map<string, StdioClientTransport> = new Map();
  private availableTools: Map<string, MCPTool[]> = new Map();

  async connect(config: MCPServerConfig): Promise<void> {
    try {
      logger.info(`Connecting to MCP server: ${config.name} (${config.id})`);

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });

      const client = new Client(
        {
          name: 'telegram-mcp-client',
          version: '1.0.0',
        },
        {
          capabilities: {},
          timeout: Number.MAX_SAFE_INTEGER, // Virtually no timeout - responses are async/decoupled
        }
      );

      await client.connect(transport);

      this.clients.set(config.id, client);
      this.transports.set(config.id, transport);

      // List available tools
      const toolsResponse = await client.listTools();
      const tools: MCPTool[] = toolsResponse.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema as MCPTool['inputSchema'],
      }));

      this.availableTools.set(config.id, tools);

      logger.info(
        `Connected to ${config.name}, found ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}`
      );
    } catch (error) {
      logger.error(`Failed to connect to ${config.name}:`, error);
      throw error;
    }
  }

  async disconnect(serverId: string): Promise<void> {
    try {
      const client = this.clients.get(serverId);
      if (client) {
        await client.close();
        this.clients.delete(serverId);
      }

      const transport = this.transports.get(serverId);
      if (transport) {
        await transport.close();
        this.transports.delete(serverId);
      }

      this.availableTools.delete(serverId);
      logger.info(`Disconnected from server: ${serverId}`);
    } catch (error) {
      logger.error(`Failed to disconnect from ${serverId}:`, error);
      throw error;
    }
  }

  async disconnectAll(): Promise<void> {
    const serverIds = Array.from(this.clients.keys());
    await Promise.all(serverIds.map((id) => this.disconnect(id)));
  }

  getAllTools(): MCPTool[] {
    const allTools: MCPTool[] = [];
    for (const tools of this.availableTools.values()) {
      allTools.push(...tools);
    }
    return allTools;
  }

  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
  }

  async executeTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    logger.info(`Executing tool: ${toolName} with args:`, args);

    // Find which server has this tool
    let targetServerId: string | undefined;
    for (const [serverId, tools] of this.availableTools.entries()) {
      if (tools.some((t) => t.name === toolName)) {
        targetServerId = serverId;
        break;
      }
    }

    if (!targetServerId) {
      throw new Error(`Tool ${toolName} not found in any connected server`);
    }

    const client = this.clients.get(targetServerId);
    if (!client) {
      throw new Error(`Client for server ${targetServerId} not found`);
    }

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: args,
      });

      logger.info(`Tool ${toolName} executed successfully`);
      return result;
    } catch (error) {
      logger.error(`Failed to execute tool ${toolName}:`, error);
      throw error;
    }
  }

  async listResources(serverId: string) {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not connected`);
    }

    return await client.listResources();
  }

  async readResource(serverId: string, uri: string) {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not connected`);
    }

    return await client.readResource({ uri });
  }
}
