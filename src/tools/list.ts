import { formatError } from '../shared/errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ListInputSchema } from '../schemas/tools.js';
import { getIndex } from '../vault/search.js';
import { passesFilters } from '../vault/search.js';
import type { IndexEntry } from '../vault/search.js';
import { logger } from '../shared/logger.js';

export const listToolDefinition = {
  name: 'memory_list',
  description:
    'List memories with optional filtering by PARA category, tags, status, or date. Returns titles, IDs, and metadata summaries. Archived memories are excluded by default.',
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
        description: 'Filter by tags',
      },
      tag_mode: {
        type: 'string',
        enum: ['and', 'or'],
        description: 'Tag filter logic: "and" (all tags required, default) or "or" (any tag matches)',
      },
      exclude_tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Exclude memories with any of these tags',
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
      include_archived: {
        type: 'boolean',
        description: 'Include archived memories (default: false)',
      },
      created_after: { type: 'string', description: 'Filter by created date (ISO 8601, inclusive)' },
      created_before: { type: 'string', description: 'Filter by created date (ISO 8601, inclusive)' },
      updated_after: { type: 'string', description: 'Filter by updated date (ISO 8601, inclusive)' },
      updated_before: { type: 'string', description: 'Filter by updated date (ISO 8601, inclusive)' },
    },
  },
};

export async function handleList(args: unknown): Promise<CallToolResult> {
  try {
    const input = ListInputSchema.parse(args);
    const index = getIndex();
    let entries = Array.from(index.values());

    // Exclude archived by default unless explicitly requested
    if (!input.include_archived && !input.status) {
      entries = entries.filter((e) => e.frontmatter.status !== 'archived');
    }

    // Apply shared filters
    entries = entries.filter((e) =>
      passesFilters(e, {
        para: input.para,
        status: input.status,
        tags: input.tags,
        tag_mode: input.tag_mode,
        exclude_tags: input.exclude_tags,
        created_after: input.created_after,
        created_before: input.created_before,
        updated_after: input.updated_after,
        updated_before: input.updated_before,
      })
    );

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
          text: `Error listing memories: ${formatError(error)}`,
        },
      ],
      isError: true,
    };
  }
}
