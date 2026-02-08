# Telegram MCP Client

A Model Context Protocol (MCP) client with Telegram UI, allowing you to interact with MCP servers through a Telegram bot powered by AI.

## 🚀 Quick Start

**New here?** Check out the [**Quick Start Guide**](./QUICK_START.md) for a 5-minute setup!

**Need to handle large files (> 20MB)?** See [**Telegram Local API Setup**](./TELEGRAM_LOCAL_API_SETUP.md) to enable up to 2GB file support.

## Features

- 🤖 **Model Agnostic**: Supports multiple LLM providers (Google AI, Anthropic Claude, OpenAI) via Vercel AI SDK
- 📱 **Telegram Interface**: Natural conversation interface via Telegram
- 🔧 **MCP Protocol**: Connect to any MCP server and use their tools
- 💬 **Conversation Context**: Maintains conversation history per user
- 🔌 **Multi-Server Support**: Connect to multiple MCP servers simultaneously
- 📝 **Logging**: Comprehensive logging with Winston

## Architecture

```
User (Telegram) → Telegraf Bot → Session Manager → LLM Orchestrator → MCP Client → MCP Servers
                                                          ↓
                                                    AI Model (Google/Claude/OpenAI)
```

The bot receives messages from users, maintains conversation context, queries the AI model with available tools from connected MCP servers, and executes tool calls as needed.

## Prerequisites

- Node.js 18+ (for ES Modules support)
- npm or yarn
- A Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- API key for your chosen AI provider:
  - Google AI: Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
  - Anthropic: Get from [Anthropic Console](https://console.anthropic.com/)
  - OpenAI: Get from [OpenAI Platform](https://platform.openai.com/)

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd telegram-mcp
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Configure environment variables in `.env`:
```env
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GOOGLE_API_KEY=your_google_api_key_here

# Optional - Choose your provider
AI_PROVIDER=google  # google, anthropic, or openai
GOOGLE_MODEL=gemini-1.5-pro
```

5. Create servers configuration:
```bash
cp servers.example.json servers.json
```

6. Edit `servers.json` to configure your MCP servers:
```json
{
  "servers": [
    {
      "id": "filesystem",
      "name": "File System Server",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "autoConnect": false
    }
  ]
}
```

## Usage

### Development Mode

```bash
npm run dev
```

### Production Build

```bash
npm run build
npm start
```

## Telegram Bot Commands

- `/start` - Welcome message and introduction
- `/help` - Show available commands
- `/connect <server_id>` - Connect to an MCP server
- `/disconnect <server_id>` - Disconnect from a server
- `/servers` - List all connected servers and available tools
- `/reset` - Clear conversation history

## Example Conversation

```
You: /connect filesystem
Bot: ✅ Connected to File System Server!
     Available tools (3):
     • read_file: Read contents of a file
     • write_file: Write contents to a file
     • list_directory: List files in a directory

You: What files are in /tmp?
Bot: Let me check that for you...
     [Bot uses list_directory tool]
     The /tmp directory contains:
     • file1.txt
     • file2.log
     • data.json

You: Read the contents of file1.txt
Bot: [Bot uses read_file tool]
     Here's the content of file1.txt:
     ...
```

## Available MCP Servers

You can use any MCP-compatible server. Popular ones include:

- `@modelcontextprotocol/server-filesystem` - File system operations
- `@modelcontextprotocol/server-memory` - Key-value memory store
- `@modelcontextprotocol/server-postgres` - PostgreSQL database access
- `@modelcontextprotocol/server-slack` - Slack integration
- Custom servers you build yourself!

## Configuration

### Supported AI Providers

#### Google AI (Default)
```env
AI_PROVIDER=google
GOOGLE_API_KEY=your_key
GOOGLE_MODEL=gemini-1.5-pro
```

#### Anthropic Claude
```bash
npm install @ai-sdk/anthropic
```
```env
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
```

#### OpenAI
```bash
npm install @ai-sdk/openai
```
```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_key
OPENAI_MODEL=gpt-4-turbo
```

### Server Configuration

Each server in `servers.json` has:

- `id`: Unique identifier for the server
- `name`: Human-readable name
- `command`: Command to run the server (usually `npx` or `node`)
- `args`: Array of arguments to pass to the command
- `env`: (Optional) Environment variables for the server
- `autoConnect`: (Optional) Auto-connect on bot startup

## Project Structure

```
telegram-mcp/
├── src/
│   ├── bot/              # Telegram bot implementation
│   │   └── telegram-bot.ts
│   ├── mcp/              # MCP client core
│   │   ├── client.ts     # MCP protocol client
│   │   └── llm-orchestrator.ts  # AI model integration
│   ├── session/          # Session management
│   │   └── manager.ts
│   ├── config/           # Configuration loading
│   │   └── index.ts
│   ├── types/            # TypeScript type definitions
│   │   └── index.ts
│   ├── utils/            # Utilities
│   │   └── logger.ts
│   └── index.ts          # Application entry point
├── servers.json          # MCP servers configuration
├── .env                  # Environment variables
├── package.json
└── tsconfig.json
```

## Development

### Adding a New AI Provider

To add support for a new AI provider:

1. Install the provider's SDK: `npm install @ai-sdk/provider-name`
2. Update `src/types/index.ts` to add the provider type
3. Update `src/mcp/llm-orchestrator.ts` to handle the new provider
4. Update `.env.example` with the new provider's configuration

### Adding Custom MCP Servers

1. Create your MCP server following the [MCP specification](https://modelcontextprotocol.io/)
2. Add server configuration to `servers.json`
3. Connect via `/connect <server_id>` command

## Troubleshooting

### Bot doesn't respond
- Check that `TELEGRAM_BOT_TOKEN` is correct
- Verify the bot is running (`npm run dev`)
- Check logs in `combined.log` and `error.log`

### Tools not working
- Verify MCP server is properly configured in `servers.json`
- Check server is connected: `/servers`
- Try disconnecting and reconnecting: `/disconnect <id>` then `/connect <id>`

### AI not using tools
- Ensure you're connected to at least one MCP server
- Check that your query is relevant to available tools
- Verify API key is valid for your chosen AI provider

## Future Enhancements

- [ ] Multi-user session persistence (Redis/database)
- [ ] File upload/download via Telegram
- [ ] Inline keyboards for tool selection
- [ ] Resource streaming for large responses
- [ ] Admin commands and monitoring
- [ ] Usage analytics and rate limiting
- [ ] Docker deployment
- [ ] Web dashboard for monitoring

## License

ISC

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.
