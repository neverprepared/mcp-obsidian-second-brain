import { formatError } from '../shared/errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CONFIG } from '../config.js';
import { getVectorDiagnostics } from '../vault/vector-index.js';
import { isEmbeddingAvailable } from '../vault/embeddings.js';
import { logger } from '../shared/logger.js';

export const vectorStatsToolDefinition = {
  name: 'memory_vector_stats',
  description:
    'Get diagnostics for the vector and FTS index layer: embedding coverage, storage size, database config (WAL mode, busy_timeout), sync lock status, Ollama connectivity, and unembedded note IDs.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export async function handleVectorStats(_args: unknown): Promise<CallToolResult> {
  try {
    const diag = getVectorDiagnostics();
    const ollamaAvailable = await isEmbeddingAvailable();

    const coveragePct = diag.embeddingCount + diag.unembeddedIds.length > 0
      ? Math.round((diag.embeddingCount / (diag.embeddingCount + diag.unembeddedIds.length)) * 100)
      : 0;

    const sizeMB = (diag.dbSizeBytes / (1024 * 1024)).toFixed(2);

    const sections: string[] = [
      '## Vector & FTS Index Diagnostics',
      '',
      '### Database',
      `- Path: \`${diag.dbPath}\``,
      `- Size: ${sizeMB} MiB (${diag.dbSizeBytes.toLocaleString()} bytes)`,
      `- Journal mode: ${diag.journalMode}`,
      `- Busy timeout: ${diag.busyTimeout}ms`,
      '',
      '### Embedding Coverage',
      `- Embedded: ${diag.embeddingCount} / ${diag.embeddingCount + diag.unembeddedIds.length} (${coveragePct}%)`,
      `- Vector index: ${diag.vectorReady ? 'active' : 'disabled'}`,
    ];

    if (diag.unembeddedIds.length > 0) {
      const displayIds = diag.unembeddedIds.slice(0, 20);
      sections.push(`- Unembedded (${diag.unembeddedIds.length}): ${displayIds.join(', ')}${diag.unembeddedIds.length > 20 ? ` ... and ${diag.unembeddedIds.length - 20} more` : ''}`);
    }

    sections.push(
      '',
      '### FTS5 Index',
      `- Status: ${diag.ftsReady ? 'active' : 'disabled'}`,
      `- Indexed rows: ${diag.ftsRowCount}`,
      '',
      '### Embedding Sync',
      `- Lock held: ${diag.syncLockHeld ? `yes (PID ${diag.syncLockPid})` : 'no'}`,
      '',
      '### Ollama',
      `- Reachable: ${ollamaAvailable ? 'yes' : 'no'}`,
      `- Base URL: \`${CONFIG.OLLAMA_BASE_URL}\``,
      `- Model: ${CONFIG.EMBEDDING_MODEL}`,
      `- Dimensions: ${CONFIG.EMBEDDING_DIMS}`,
      `- Batch size: ${CONFIG.EMBEDDING_BATCH_SIZE}`,
    );

    return { content: [{ type: 'text', text: sections.join('\n') }] };
  } catch (error) {
    logger.error('Failed to get vector stats', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error getting vector stats: ${formatError(error)}` }],
      isError: true,
    };
  }
}
