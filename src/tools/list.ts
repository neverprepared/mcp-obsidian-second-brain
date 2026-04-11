import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ListInputSchema } from '../schemas/tools.js';
import { getIndex } from '../vault/search.js';
import type { IndexEntry } from '../vault/search.js';
import { logger } from '../shared/logger.js';

export const listToolDefinition = {
  name: 'memory_list',
  description:
    'List memories with optional filtering by PARA category, tags, or status. Returns titles, IDs, and metadata summaries.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      para: {
        type: 'string',
        enum: ['projects', 'areas', 'resources', 'archives'],
        description: 'Filter by PARA category',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags (AND logic)',
      },
      status: {
        type: 'string',
        enum: ['active', 'stale', 'archived'],
        description: 'Filter by status',
      },
      sort_by: {
        type: 'string',
        enum: ['created', 'updated', 'title'],
        description: 'Sort field (default: updated)',
      },
      limit: { type: 'number', description: 'Max results (default: 20, max: 100)' },
    },
  },
};

export async function handleList(args: unknown): Promise<CallToolResult> {
  try {
    const input = ListInputSchema.parse(args);
    const index = getIndex();
    let entries = Array.from(index.values());

    // Apply filters
    if (input.para) {
      entries = entries.filter((e) => e.frontmatter.para === input.para);
    }
    if (input.status) {
      entries = entries.filter((e) => e.frontmatter.status === input.status);
    }
    if (input.tags && input.tags.length > 0) {
      entries = entries.filter((e) =>
        input.tags!.every((t) =>
          e.frontmatter.tags.some((ft) => ft.toLowerCase() === t.toLowerCase())
        )
      );
    }

    // Sort
    const sortFn: Record<string, (a: IndexEntry, b: IndexEntry) => number> = {
      created: (a, b) => b.frontmatter.created.localeCompare(a.frontmatter.created),
      updated: (a, b) => b.frontmatter.updated.localeCompare(a.frontmatter.updated),
      title: (a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title),
    };
    entries.sort(sortFn[input.sort_by] || sortFn['updated']!);

    entries = entries.slice(0, input.limit);

    if (entries.length === 0) {
      return {
        content: [{ type: 'text', text: 'No memories found matching your criteria.' }],
      };
    }

    const lines = entries.map((e) => {
      const fm = e.frontmatter;
      return `- **${fm.title}** [${fm.para}] — ${fm.tags.join(', ') || 'no tags'} (${fm.status})\n  ID: ${fm.id}`;
    });

    return {
      content: [
        {
          type: 'text',
          text: `${entries.length} memor${entries.length === 1 ? 'y' : 'ies'}:\n\n${lines.join('\n')}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to list memories', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error listing memories: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
