/**
 * Core API surface — stable entry point for non-MCP callers (CLI, scripts, tests).
 *
 * The MCP server (src/server.ts) and the CLI (src/cli.ts) both consume this module.
 * Tool handlers are re-exported as-is from src/tools/* so a single call site exists
 * for the lifecycle (initialize → handler → shutdown) regardless of transport.
 */

import { ensureVaultStructure } from '../para/structure.js';
import { buildIndex } from '../vault/search.js';
import { initVectorIndex, syncVectorIndex } from '../vault/vector-index.js';
import { ensureWorkingDb, cleanupSnapshot } from '../working/db.js';

export { CONFIG, DEFAULT_TTL_DAYS, paraFolderFromCategory } from '../config.js';
export type { ParaFolder } from '../config.js';

export { handleStore } from '../tools/store.js';
export { handleRecall } from '../tools/recall.js';
export { handleSearch } from '../tools/search.js';
export { handleUpdate } from '../tools/update.js';
export { handleDelete } from '../tools/delete.js';
export { handleLink } from '../tools/link.js';
export { handleProject } from '../tools/project.js';
export { handleStats } from '../tools/stats.js';
export { handleCleanup } from '../tools/cleanup.js';
export { handleTimeline } from '../tools/timeline.js';
export {
  handleTaskStart,
  handleTaskUpdate,
  handleTaskComplete,
  handleTaskGet,
} from '../tools/task.js';

export { logger } from '../shared/logger.js';

/**
 * Bring the second brain online: vault folders exist, vector + FTS indexes loaded,
 * working-memory DB ready, embeddings sync started in the background.
 *
 * Idempotent at the module level (init functions guard their own state), but call
 * once per process to be safe. CLI calls this before dispatching a handler;
 * the MCP server calls it inside startServer().
 */
export async function initialize(): Promise<void> {
  await ensureVaultStructure();
  await initVectorIndex();
  await buildIndex();
  ensureWorkingDb();
  syncVectorIndex();
}

/**
 * Snapshot working memory before exit. CLI invokes this in a finally block;
 * the MCP server invokes it in SIGINT/SIGTERM handlers.
 */
export function shutdown(): void {
  cleanupSnapshot();
}
