import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getIndex } from '../vault/search.js';
import { buildIncomingLinkCount } from '../vault/links.js';
import { isStale } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

export const statsToolDefinition = {
  name: 'memory_stats',
  description:
    'Get a health summary of the vault: total count, breakdown by PARA category and status, stale memory count, orphaned memories (no links), and top tags.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export async function handleStats(_args: unknown): Promise<CallToolResult> {
  try {
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

    const text = [
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
      ``,
      `### Top Tags`,
      topTags.length > 0 ? topTags.join(', ') : 'none',
    ].join('\n');

    return { content: [{ type: 'text', text }] };
  } catch (error) {
    logger.error('Failed to get vault stats', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error getting vault stats: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
