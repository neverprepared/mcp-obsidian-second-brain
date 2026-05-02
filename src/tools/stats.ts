import { formatError } from '../shared/errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getIndex } from '../vault/search.js';
import { buildIncomingLinkCount } from '../vault/links.js';
import { isStale } from '../shared/utils.js';
import { logger } from '../shared/logger.js';
import { getEmbeddingStats, getVectorDiagnostics, isVectorIndexReady } from '../vault/vector-index.js';
import { isEmbeddingAvailable } from '../vault/embeddings.js';
import { readAllSnapshots } from '../working/db.js';
import { CONFIG } from '../config.js';
import { z } from 'zod';

const StatsInputSchema = z.object({
  include: z.array(z.enum(['vector', 'working'])).optional()
    .describe('Optional sections to include: "vector" for index diagnostics, "working" for active session tasks'),
});

export const statsToolDefinition = {
  name: 'memory_stats',
  description:
    'Get vault health summary: counts by PARA category/status, stale/orphan counts, top tags. Optionally include vector index diagnostics and/or working memory session info via the "include" parameter.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      include: {
        type: 'array',
        items: { type: 'string', enum: ['vector', 'working'] },
        description: 'Optional sections: "vector" for index diagnostics, "working" for active session tasks',
      },
    },
  },
};

export async function handleStats(args: unknown): Promise<CallToolResult> {
  try {
    const input = StatsInputSchema.parse(args);
    const include = new Set(input.include ?? []);
    const index = getIndex();

    const byPara: Record<string, number> = { projects: 0, areas: 0, resources: 0, archives: 0 };
    const byStatus: Record<string, number> = { active: 0, stale: 0, archived: 0 };
    const tagFrequency = new Map<string, number>();
    let total = 0;
    let staleCount = 0;

    for (const entry of index.values()) {
      const fm = entry.frontmatter;
      total++;
      byPara[fm.para] = (byPara[fm.para] ?? 0) + 1;
      byStatus[fm.status] = (byStatus[fm.status] ?? 0) + 1;

      if (isStale(fm.updated, fm.ttl_days, fm.para)) {
        staleCount++;
      }

      for (const tag of fm.tags) {
        const key = tag.toLowerCase();
        tagFrequency.set(key, (tagFrequency.get(key) ?? 0) + 1);
      }
    }

    // Orphan detection: no outgoing AND no incoming links
    const incomingCount = buildIncomingLinkCount(index);
    let orphanCount = 0;
    for (const entry of index.values()) {
      const hasOutgoing = entry.frontmatter.related.length > 0;
      const hasIncoming = (incomingCount.get(entry.slug) ?? 0) > 0;
      if (!hasOutgoing && !hasIncoming) {
        orphanCount++;
      }
    }

    const topTags = [...tagFrequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => `${tag} (${count})`);

    const embeddingInfo = isVectorIndexReady()
      ? (() => {
          const { embedded, total: embTotal } = getEmbeddingStats();
          const pct = embTotal > 0 ? Math.round((embedded / embTotal) * 100) : 0;
          return `- Vector index: ${embedded}/${embTotal} embedded (${pct}%)`;
        })()
      : '- Vector index: disabled (Ollama not available)';

    const sections: string[] = [
      `## Vault Health Summary`,
      ``,
      `**Total memories:** ${total}`,
      ``,
      `### By PARA Category`,
      `- Projects: ${byPara['projects'] ?? 0}`,
      `- Areas: ${byPara['areas'] ?? 0}`,
      `- Resources: ${byPara['resources'] ?? 0}`,
      `- Archives: ${byPara['archives'] ?? 0}`,
      ``,
      `### By Status`,
      `- Active: ${byStatus['active'] ?? 0}`,
      `- Stale: ${byStatus['stale'] ?? 0}`,
      `- Archived: ${byStatus['archived'] ?? 0}`,
      ``,
      `### Health Indicators`,
      `- Stale memories: ${staleCount}`,
      `- Orphaned memories (no links): ${orphanCount}`,
      embeddingInfo,
      ``,
      `### Top Tags`,
      topTags.length > 0 ? topTags.join(', ') : 'none',
    ];

    // --- Optional: vector diagnostics ---
    if (include.has('vector')) {
      const diag = getVectorDiagnostics();
      const ollamaAvailable = await isEmbeddingAvailable();
      const coveragePct = diag.embeddingCount + diag.unembeddedIds.length > 0
        ? Math.round((diag.embeddingCount / (diag.embeddingCount + diag.unembeddedIds.length)) * 100)
        : 0;
      const sizeMB = (diag.dbSizeBytes / (1024 * 1024)).toFixed(2);

      sections.push(
        '',
        '---',
        '',
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
      );

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
    }

    // --- Optional: working memory sessions ---
    if (include.has('working')) {
      const snapshots = readAllSnapshots();

      sections.push('', '---', '', '## Working Memory Sessions', '');

      if (snapshots.length === 0) {
        sections.push('No active sessions with working memory tasks.');
      } else {
        sections.push(`**Active instances:** ${snapshots.length}`);

        for (const snap of snapshots) {
          const isSelf = snap.pid === process.pid;
          sections.push(
            '',
            `### PID ${snap.pid}${isSelf ? ' (this session)' : ''}`,
            `- Started: ${snap.server_start}`,
            `- Last updated: ${snap.updated_at}`,
            `- Active tasks: ${snap.tasks.length}`,
          );

          if (snap.tasks.length === 0) {
            sections.push('- No active tasks');
            continue;
          }

          for (const task of snap.tasks) {
            const stepProgress = task.steps.total > 0
              ? `${task.steps.completed}/${task.steps.total} done`
              : 'no steps';
            const findingSummary = task.findings.total > 0
              ? `${task.findings.total} (${task.findings.high}H/${task.findings.medium}M/${task.findings.low}L)`
              : 'none';
            const questionSummary = task.questions.total > 0
              ? `${task.questions.open} open / ${task.questions.resolved} resolved`
              : 'none';

            sections.push(
              '',
              `#### ${task.task_id}`,
              `- **Goal:** ${task.goal}`,
            );
            if (task.current_step) {
              sections.push(`- **Current step:** ${task.current_step}`);
            }
            sections.push(
              `- **Steps:** ${stepProgress}${task.steps.failed > 0 ? ` (${task.steps.failed} failed)` : ''}`,
              `- **Findings:** ${findingSummary}`,
              `- **Artifacts:** ${task.artifacts}`,
              `- **Questions:** ${questionSummary}`,
              `- **Started:** ${task.created_at}`,
            );
          }
        }
      }
    }

    return { content: [{ type: 'text', text: sections.join('\n') }] };
  } catch (error) {
    logger.error('Failed to get vault stats', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error getting vault stats: ${formatError(error)}`,
        },
      ],
      isError: true,
    };
  }
}
