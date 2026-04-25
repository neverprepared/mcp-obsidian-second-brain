import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { logger } from './shared/logger.js';
import { ensureVaultStructure } from './para/structure.js';
import { buildIndex } from './vault/search.js';
import { initWorkingDb } from './working/db.js';
import { initVectorIndex, syncVectorIndex } from './vault/vector-index.js';
import { getToolDefinitions, handleToolCall } from './tools/index.js';
import { CONFIG } from './config.js';

const SERVER_INFO = {
  name: 'mcp-obsidian-second-brain',
  version: '0.1.0',
};

export async function startServer(): Promise<void> {
  logger.info('Starting Obsidian Second Brain MCP Server', {
    version: SERVER_INFO.version,
    vaultPath: CONFIG.VAULT_PATH,
  });

  // Ensure vault structure exists
  await ensureVaultStructure();

  // Initialize vector + FTS index before building the in-memory index,
  // because buildIndex() calls rebuildFts() which needs the DB connection.
  await initVectorIndex();

  // Build in-memory index (also populates FTS5)
  await buildIndex();

  // Initialize session-scoped working memory
  initWorkingDb();

  // Background sync embeddings for any notes missing vectors
  syncVectorIndex();

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
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down');
    await server.close();
    process.exit(0);
  });
}
