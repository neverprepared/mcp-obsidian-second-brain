import { formatError } from '../shared/errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { RecallInputSchema } from '../schemas/tools.js';
import { findById, findByTitle, updateLastAccessed } from '../vault/search.js';
import { readMemoryFile } from '../vault/filesystem.js';
import { parseMemoryFile } from '../vault/frontmatter.js';
import { discoverLinks } from '../vault/links.js';
import { isStale } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

export const recallToolDefinition = {
  name: 'memory_recall',
  description:
    'Retrieve a specific memory by its ID or title. Returns the full content, metadata, and links.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'The memory ID (e.g., mem_1712764800_cognitive-load)' },
      title: { type: 'string', description: 'Exact or partial title to match' },
    },
  },
};

export async function handleRecall(args: unknown): Promise<CallToolResult> {
  try {
    const input = RecallInputSchema.parse(args);

    const entry = input.id ? findById(input.id) : findByTitle(input.title!);
    if (!entry) {
      return {
        content: [
          {
            type: 'text',
            text: `Memory not found: ${input.id || input.title}`,
          },
        ],
        isError: true,
      };
    }

    const raw = await readMemoryFile(entry.filePath);
    const parsed = parseMemoryFile(raw);
    const links = await discoverLinks(entry.slug);

    // Update last_accessed (fire-and-forget)
    void updateLastAccessed(entry.frontmatter.id);

    const fm = parsed.frontmatter;
    const freshness = isStale(fm.updated, fm.ttl_days, fm.para) ? 'STALE' : 'Fresh';
    const meta = [
      `**ID:** ${fm.id}`,
      `**Title:** ${fm.title}`,
      `**PARA:** ${fm.para}`,
      `**Tags:** ${fm.tags.join(', ') || 'none'}`,
      `**Status:** ${fm.status}`,
      `**Confidence:** ${fm.confidence}`,
      `**Freshness:** ${freshness}`,
      `**Created:** ${fm.created}`,
      `**Updated:** ${fm.updated}`,
      `**Last Accessed:** ${fm.last_accessed || 'never'}`,
      `**Source:** ${fm.source}`,
      fm.source_urls.length > 0 ? `**Source URLs:** ${fm.source_urls.join(', ')}` : '',
      fm.ttl_days !== undefined ? `**TTL:** ${fm.ttl_days} days` : '',
    ].filter(Boolean).join('\n');

    const linkInfo = [
      links.outgoing.length > 0 ? `**Links to:** ${links.outgoing.map((s) => `[[${s}]]`).join(', ')}` : '',
      links.incoming.length > 0 ? `**Linked from:** ${links.incoming.map((s) => `[[${s}]]`).join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const output = [meta, '', '---', '', parsed.content, linkInfo ? `\n---\n${linkInfo}` : '']
      .join('\n')
      .trim();

    return {
      content: [{ type: 'text', text: output }],
    };
  } catch (error) {
    logger.error('Failed to recall memory', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error recalling memory: ${formatError(error)}`,
        },
      ],
      isError: true,
    };
  }
}
