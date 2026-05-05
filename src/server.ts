import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { initialize, shutdown, logger, CONFIG } from './core/index.js';
import { getToolDefinitions, handleToolCall } from './tools/index.js';

const SERVER_INFO = {
  name: 'mcp-obsidian-second-brain',
  version: '0.1.0',
};

export async function startServer(): Promise<void> {
  logger.info('Starting Obsidian Second Brain MCP Server', {
    version: SERVER_INFO.version,
    vaultPath: CONFIG.VAULT_PATH,
  });

  await initialize();

  const server = new Server(
    {
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = getToolDefinitions();
    logger.debug('Listing tools', { count: tools.length });
    return { tools };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      logger.debug('Tool call received', { tool: request.params.name });
      return handleToolCall(request);
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('Server connected and ready', {
    transport: 'stdio',
    tools: getToolDefinitions().length,
  });

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down');
    shutdown();
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down');
    shutdown();
    await server.close();
    process.exit(0);
  });
}
