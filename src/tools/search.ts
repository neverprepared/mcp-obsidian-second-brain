import { formatError } from '../shared/errors.js';
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
        description: 'Filter by tags',
      },
      tag_mode: {
        type: 'string',
        enum: ['and', 'or'],
        description: 'Tag filter logic: "and" (all tags required, default) or "or" (any tag matches)',
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
      search_mode: {
        type: 'string',
        enum: ['auto', 'keyword', 'vector'],
        description: 'Search mode: "auto" uses vector+keyword hybrid when Ollama is available (default), "keyword" forces full-text only, "vector" forces semantic only',
      },
      limit: { type: 'number', description: 'Max results (default: 10, max: 50)' },
      created_after: { type: 'string', description: 'Filter by created date (ISO 8601, inclusive)' },
      created_before: { type: 'string', description: 'Filter by created date (ISO 8601, inclusive)' },
      updated_after: { type: 'string', description: 'Filter by updated date (ISO 8601, inclusive)' },
      updated_before: { type: 'string', description: 'Filter by updated date (ISO 8601, inclusive)' },
    },
  },
};

export async function handleSearch(args: unknown): Promise<CallToolResult> {
  try {
    const input = SearchInputSchema.parse(args);
    const results = await searchMemories({
      query: input.query,
      tags: input.tags,
      tag_mode: input.tag_mode,
      para: input.para,
      status: input.status,
      freshness: input.freshness,
      limit: input.limit,
      search_mode: input.search_mode,
      created_after: input.created_after,
      created_before: input.created_before,
      updated_after: input.updated_after,
      updated_before: input.updated_before,
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
          text: `Error searching memories: ${formatError(error)}`,
        },
      ],
      isError: true,
    };
  }
}
