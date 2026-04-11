import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SearchInputSchema } from '../schemas/tools.js';
import { searchMemories, updateLastAccessed } from '../vault/search.js';
import { logger } from '../shared/logger.js';

export const searchToolDefinition = {
  name: 'memory_search',
  description:
    'Search memories by content, tags, or PARA category. Supports full-text search with relevance scoring.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Full-text search query (searches title, content, tags)' },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags (AND logic)',
      },
      para: {
        type: 'string',
        enum: ['projects', 'areas', 'resources', 'archives'],
        description: 'Filter by PARA category',
      },
      status: {
        type: 'string',
        enum: ['active', 'stale', 'archived'],
        description: 'Filter by status',
      },
      freshness: {
        type: 'string',
        enum: ['all', 'fresh', 'stale'],
        description: 'Filter by freshness based on TTL (default: all)',
      },
      limit: { type: 'number', description: 'Max results (default: 10, max: 50)' },
    },
  },
};

export async function handleSearch(args: unknown): Promise<CallToolResult> {
  try {
    const input = SearchInputSchema.parse(args);
    const results = await searchMemories({
      query: input.query,
      tags: input.tags,
      para: input.para,
      status: input.status,
      freshness: input.freshness,
      limit: input.limit,
    });

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: 'No memories found matching your search criteria.' }],
      };
    }

    // Update last_accessed for top results (fire-and-forget)
    for (const r of results.slice(0, 5)) {
      void updateLastAccessed(r.entry.frontmatter.id);
    }

    const lines = results.map((r, i) => {
      const fm = r.entry.frontmatter;
      const freshness = r.stale ? 'STALE' : 'Fresh';
      let line = `${i + 1}. **${fm.title}** (${fm.para}) [${freshness}]`;
      line += `\n   ID: ${fm.id}`;
      line += `\n   Tags: ${fm.tags.join(', ') || 'none'} | Status: ${fm.status} | Score: ${r.score}`;
      if (r.snippet) {
        line += `\n   > ${r.snippet}`;
      }
      return line;
    });

    return {
      content: [
        {
          type: 'text',
          text: `Found ${results.length} memor${results.length === 1 ? 'y' : 'ies'}:\n\n${lines.join('\n\n')}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search memories', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error searching memories: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
