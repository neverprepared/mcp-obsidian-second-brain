import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import {
  readWikiFile,
  listWiki,
  searchWiki,
  writeWikiFile,
  deleteWikiFile,
  moveWikiFile,
} from '../wiki/filesystem.js';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const WikiKindSchema = z.enum(['howto', 'runbook', 'reference', 'scratch']);

const WikiWriteInputSchema = z.object({
  rel_path: z.string().min(1),
  mode: z.enum(['create', 'update']),
  content: z.string().min(1),
  title: z.string().min(1).max(200),
  kind: WikiKindSchema,
  tags: z.array(z.string().max(50)).max(50).optional(),
  sources: z.array(z.string()).max(50).optional(),
});

const WikiReadInputSchema = z.object({
  rel_path: z.string().min(1),
});

const WikiListInputSchema = z.object({
  subfolder: z.string().optional(),
});

const WikiSearchInputSchema = z.object({
  query: z.string().min(1),
});

const WikiDeleteInputSchema = z.object({
  rel_path: z.string().min(1),
});

const WikiMoveInputSchema = z.object({
  from_rel_path: z.string().min(1),
  to_rel_path: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const wikiWriteToolDefinition = {
  name: 'wiki_write',
  description:
    'Create or update a Wiki page. Wiki pages are durable human-readable documents (how-tos, runbooks, references, scratch notes) stored in Wiki/<subfolder>/<slug>.md. Use mode="create" for new pages and mode="update" to modify existing ones.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Path relative to Wiki/ folder, e.g. "HowTos/oauth-setup.md". Must include subfolder and .md extension.',
      },
      mode: {
        type: 'string',
        enum: ['create', 'update'],
        description: '"create" rejects if file already exists. "update" rejects if file does NOT exist.',
      },
      content: {
        type: 'string',
        description: 'Markdown body content (without frontmatter).',
      },
      title: {
        type: 'string',
        description: 'Human-readable page title (1-200 chars).',
      },
      kind: {
        type: 'string',
        enum: ['howto', 'runbook', 'reference', 'scratch'],
        description: 'Page type for categorization.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization.',
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Atom slugs or Input/ paths cited by this page.',
      },
    },
    required: ['rel_path', 'mode', 'content', 'title', 'kind'],
  },
};

export const wikiReadToolDefinition = {
  name: 'wiki_read',
  description: 'Read a Wiki page by its relative path. Returns the frontmatter metadata and markdown body.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Path relative to Wiki/ folder, e.g. "HowTos/oauth-setup.md".',
      },
    },
    required: ['rel_path'],
  },
};

export const wikiListToolDefinition = {
  name: 'wiki_list',
  description: 'List Wiki pages. Optionally filter to a single subfolder (e.g. "HowTos"). Returns metadata for each page.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      subfolder: {
        type: 'string',
        description: 'Optional subfolder to filter by, e.g. "Runbooks". Omit to list all Wiki pages.',
      },
    },
    required: [],
  },
};

export const wikiSearchToolDefinition = {
  name: 'wiki_search',
  description: 'Search Wiki pages by title (filename + frontmatter title match). Returns matching relative paths. Does NOT search page body content.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'Search query matched against page titles and filenames.',
      },
    },
    required: ['query'],
  },
};

export const wikiDeleteToolDefinition = {
  name: 'wiki_delete',
  description: 'Delete a Wiki page and remove it from the index.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Path relative to Wiki/ folder, e.g. "HowTos/oauth-setup.md".',
      },
    },
    required: ['rel_path'],
  },
};

export const wikiMoveToolDefinition = {
  name: 'wiki_move',
  description: 'Move or rename a Wiki page within the Wiki/ folder. Updates both subfolder and root indexes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      from_rel_path: {
        type: 'string',
        description: 'Current path relative to Wiki/ folder.',
      },
      to_rel_path: {
        type: 'string',
        description: 'New path relative to Wiki/ folder.',
      },
    },
    required: ['from_rel_path', 'to_rel_path'],
  },
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleWikiWrite(args: unknown): Promise<CallToolResult> {
  try {
    const input = WikiWriteInputSchema.parse(args);
    await writeWikiFile({
      relPath: input.rel_path,
      mode: input.mode,
      content: input.content,
      title: input.title,
      kind: input.kind,
      tags: input.tags,
      sources: input.sources,
    });

    logger.info('Wiki file written', { relPath: input.rel_path, mode: input.mode });

    return {
      content: [
        {
          type: 'text',
          text: `Wiki page ${input.mode === 'create' ? 'created' : 'updated'}: "${input.title}"\nPath: Wiki/${input.rel_path}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to write wiki file', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error writing wiki page: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleWikiRead(args: unknown): Promise<CallToolResult> {
  try {
    const input = WikiReadInputSchema.parse(args);
    const { content, entry } = await readWikiFile(input.rel_path);

    const meta = [
      `Title: ${entry.title ?? '(unknown)'}`,
      `Kind: ${entry.kind ?? '(unknown)'}`,
      `Tags: ${(entry.tags ?? []).join(', ') || 'none'}`,
      `Created: ${entry.created ?? ''}`,
      `Updated: ${entry.updated ?? ''}`,
      `Sources: ${(entry.sources ?? []).join(', ') || 'none'}`,
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `# ${entry.title ?? input.rel_path}\n\n${meta}\n\n---\n\n${content}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to read wiki file', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error reading wiki page: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleWikiList(args: unknown): Promise<CallToolResult> {
  try {
    const input = WikiListInputSchema.parse(args);
    const entries = await listWiki(input.subfolder);

    if (entries.length === 0) {
      const scope = input.subfolder ? `Wiki/${input.subfolder}` : 'Wiki';
      return {
        content: [{ type: 'text', text: `No wiki pages found in ${scope}.` }],
      };
    }

    const lines = entries.map(
      (e) => `- [[Wiki/${e.relPath.replace(/\.md$/, '')}]] (${e.kind}) — ${e.title}`,
    );

    const scope = input.subfolder ? `Wiki/${input.subfolder}` : 'Wiki';
    return {
      content: [
        {
          type: 'text',
          text: `Wiki pages in ${scope} (${entries.length}):\n\n${lines.join('\n')}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to list wiki files', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error listing wiki pages: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleWikiSearch(args: unknown): Promise<CallToolResult> {
  try {
    const input = WikiSearchInputSchema.parse(args);
    const results = await searchWiki(input.query);

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No wiki pages found matching "${input.query}".` }],
      };
    }

    const lines = results.map((r) => `- Wiki/${r}`);
    return {
      content: [
        {
          type: 'text',
          text: `Wiki search results for "${input.query}" (${results.length}):\n\n${lines.join('\n')}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to search wiki', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error searching wiki: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleWikiDelete(args: unknown): Promise<CallToolResult> {
  try {
    const input = WikiDeleteInputSchema.parse(args);
    await deleteWikiFile(input.rel_path);

    logger.info('Wiki file deleted', { relPath: input.rel_path });

    return {
      content: [{ type: 'text', text: `Deleted wiki page: Wiki/${input.rel_path}` }],
    };
  } catch (error) {
    logger.error('Failed to delete wiki file', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error deleting wiki page: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleWikiMove(args: unknown): Promise<CallToolResult> {
  try {
    const input = WikiMoveInputSchema.parse(args);
    await moveWikiFile(input.from_rel_path, input.to_rel_path);

    logger.info('Wiki file moved', { from: input.from_rel_path, to: input.to_rel_path });

    return {
      content: [
        {
          type: 'text',
          text: `Moved wiki page:\n  From: Wiki/${input.from_rel_path}\n  To:   Wiki/${input.to_rel_path}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to move wiki file', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error moving wiki page: ${formatError(error)}` }],
      isError: true,
    };
  }
}
