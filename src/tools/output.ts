import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import {
  writeOutputFile,
  readOutputFile,
  updateOutputFile,
  deleteOutputFile,
  listOutput,
} from '../output/filesystem.js';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const OutputWriteInputSchema = z.object({
  rel_path: z.string().min(1),
  content: z.string(),
  title: z.string().min(1),
  kind: z.enum(['article', 'report', 'deck']),
  tags: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  format: z.enum(['markdown', 'pdf', 'slides']).default('markdown'),
});

const OutputReadInputSchema = z.object({
  rel_path: z.string().min(1),
});

const OutputUpdateInputSchema = z.object({
  rel_path: z.string().min(1),
  content: z.string().optional(),
  title: z.string().min(1).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  tags: z.array(z.string()).optional(),
});

const OutputDeleteInputSchema = z.object({
  rel_path: z.string().min(1),
});

const OutputListInputSchema = z.object({
  subfolder: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const outputWriteToolDefinition = {
  name: 'output_write',
  description:
    'Create a new deliverable in the Output layer (articles, reports, or decks). The rel_path must be <subfolder>/<slug>.md where subfolder is one of: articles, reports, decks.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Relative path within Output/, e.g. "articles/oauth-guide.md"',
      },
      content: {
        type: 'string',
        description: 'Markdown body content',
      },
      title: {
        type: 'string',
        description: 'Document title',
      },
      kind: {
        type: 'string',
        enum: ['article', 'report', 'deck'],
        description: 'Document kind',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization',
      },
      sources: {
        type: 'array',
        items: { type: 'string' },
        description: 'Atom slugs and Wiki/ paths cited as sources',
      },
      format: {
        type: 'string',
        enum: ['markdown', 'pdf', 'slides'],
        description: 'Output format (default: markdown)',
      },
    },
    required: ['rel_path', 'content', 'title', 'kind'],
  },
};

export const outputReadToolDefinition = {
  name: 'output_read',
  description: 'Read an existing deliverable from the Output layer.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Relative path within Output/, e.g. "articles/oauth-guide.md"',
      },
    },
    required: ['rel_path'],
  },
};

export const outputUpdateToolDefinition = {
  name: 'output_update',
  description: 'Update an existing deliverable in the Output layer. Only provided fields are changed.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Relative path within Output/, e.g. "articles/oauth-guide.md"',
      },
      content: {
        type: 'string',
        description: 'New markdown body content (replaces existing)',
      },
      title: {
        type: 'string',
        description: 'New title',
      },
      status: {
        type: 'string',
        enum: ['draft', 'published', 'archived'],
        description: 'New status',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Replacement tag list',
      },
    },
    required: ['rel_path'],
  },
};

export const outputDeleteToolDefinition = {
  name: 'output_delete',
  description: 'Delete a deliverable from the Output layer and update indexes.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Relative path within Output/, e.g. "articles/oauth-guide.md"',
      },
    },
    required: ['rel_path'],
  },
};

export const outputListToolDefinition = {
  name: 'output_list',
  description:
    'List deliverables in the Output layer. Optionally filter by subfolder (articles, reports, decks).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      subfolder: {
        type: 'string',
        enum: ['articles', 'reports', 'decks'],
        description: 'Filter by subfolder (omit for all)',
      },
    },
    required: [],
  },
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleOutputWrite(args: unknown): Promise<CallToolResult> {
  try {
    const input = OutputWriteInputSchema.parse(args);

    await writeOutputFile({
      relPath: input.rel_path,
      content: input.content,
      frontmatter: {
        title: input.title,
        kind: input.kind,
        tags: input.tags,
        sources: input.sources,
        format: input.format,
        status: 'draft',
        attachments: [],
      },
    });

    logger.info('Created output file', { relPath: input.rel_path, kind: input.kind });

    return {
      content: [
        {
          type: 'text',
          text: `Created output: "${input.title}"\nPath: Output/${input.rel_path}\nKind: ${input.kind}\nFormat: ${input.format}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to create output file', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error creating output: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleOutputRead(args: unknown): Promise<CallToolResult> {
  try {
    const input = OutputReadInputSchema.parse(args);
    const { content, frontmatter } = await readOutputFile(input.rel_path);

    const fmDisplay = [
      `Title: ${frontmatter.title}`,
      `Kind: ${frontmatter.kind}`,
      `Status: ${frontmatter.status}`,
      `Format: ${frontmatter.format}`,
      `Tags: ${frontmatter.tags.join(', ') || 'none'}`,
      `Created: ${frontmatter.created}`,
      `Updated: ${frontmatter.updated}`,
      ...(frontmatter.published_at ? [`Published: ${frontmatter.published_at}`] : []),
      ...(frontmatter.sources.length > 0 ? [`Sources: ${frontmatter.sources.join(', ')}`] : []),
      ...(frontmatter.attachments.length > 0
        ? [`Attachments: ${frontmatter.attachments.join(', ')}`]
        : []),
    ].join('\n');

    return {
      content: [
        {
          type: 'text',
          text: `${fmDisplay}\n\n---\n\n${content}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to read output file', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error reading output: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleOutputUpdate(args: unknown): Promise<CallToolResult> {
  try {
    const input = OutputUpdateInputSchema.parse(args);

    const fmUpdates: Record<string, unknown> = {};
    if (input.title !== undefined) fmUpdates['title'] = input.title;
    if (input.status !== undefined) fmUpdates['status'] = input.status;
    if (input.tags !== undefined) fmUpdates['tags'] = input.tags;

    await updateOutputFile(input.rel_path, {
      content: input.content,
      frontmatter: fmUpdates,
    });

    logger.info('Updated output file', { relPath: input.rel_path });

    return {
      content: [
        {
          type: 'text',
          text: `Updated output: Output/${input.rel_path}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to update output file', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error updating output: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleOutputDelete(args: unknown): Promise<CallToolResult> {
  try {
    const input = OutputDeleteInputSchema.parse(args);
    await deleteOutputFile(input.rel_path);

    logger.info('Deleted output file', { relPath: input.rel_path });

    return {
      content: [
        {
          type: 'text',
          text: `Deleted output: Output/${input.rel_path}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to delete output file', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error deleting output: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleOutputList(args: unknown): Promise<CallToolResult> {
  try {
    const input = OutputListInputSchema.parse(args);
    const entries = await listOutput(input.subfolder);

    if (entries.length === 0) {
      const scope = input.subfolder ? `Output/${input.subfolder}` : 'Output';
      return {
        content: [{ type: 'text', text: `No deliverables found in ${scope}.` }],
      };
    }

    const lines = entries.map((e) => {
      const date = e.frontmatter.updated.split('T')[0] ?? e.frontmatter.updated;
      return `- [[${e.relPath.replace(/\.md$/, '')}]] — ${e.frontmatter.title} (${e.frontmatter.kind}, ${e.frontmatter.status}, ${date})`;
    });

    const scope = input.subfolder ? `Output/${input.subfolder}` : 'Output';
    return {
      content: [
        {
          type: 'text',
          text: `${entries.length} deliverable(s) in ${scope}:\n\n${lines.join('\n')}`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to list output files', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error listing output: ${formatError(error)}` }],
      isError: true,
    };
  }
}
