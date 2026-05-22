import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';
import {
  ingestInput,
  readInputFile,
  listInput,
  supersededInput,
} from '../input/filesystem.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const KindSchema = z.enum(['article', 'doc', 'transcript', 'note']);

const InputIngestSchema = z.object({
  rel_path: z.string().min(1),
  content: z.string().min(1),
  kind: KindSchema,
  source_url: z.string().url().optional(),
  description: z.string().max(500).optional(),
});

const InputReadSchema = z.object({
  rel_path: z.string().min(1),
});

const InputListSchema = z.object({
  subfolder: z.enum(['articles', 'docs', 'transcripts', 'notes']).optional(),
});

const InputSupersedeSchema = z.object({
  rel_path: z.string().min(1),
  superseded_by: z.string().min(1),
  reason: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const inputIngestToolDefinition = {
  name: 'input_ingest',
  description:
    'Ingest a new source file into the Input layer. Rejects if the file already exists (immutability contract). Updates Input/_index.md and appends to the provenance log.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Relative path within Input/, e.g. "articles/oauth-rfc.md"',
      },
      content: {
        type: 'string',
        description: 'File content (markdown or plain text)',
      },
      kind: {
        type: 'string',
        enum: ['article', 'doc', 'transcript', 'note'],
        description: 'Type of input source',
      },
      source_url: {
        type: 'string',
        description: 'Original URL of the source, if applicable',
      },
      description: {
        type: 'string',
        description: 'One-line summary of the content',
      },
    },
    required: ['rel_path', 'content', 'kind'],
  },
};

export const inputReadToolDefinition = {
  name: 'input_read',
  description: 'Read an Input source file by its relative path. Returns content and metadata.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Relative path within Input/, e.g. "articles/oauth-rfc.md"',
      },
    },
    required: ['rel_path'],
  },
};

export const inputListToolDefinition = {
  name: 'input_list',
  description:
    'List all files in the Input layer, optionally filtered to a specific subfolder (articles, docs, transcripts, notes).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      subfolder: {
        type: 'string',
        enum: ['articles', 'docs', 'transcripts', 'notes'],
        description: 'Optional subfolder to filter by',
      },
    },
    required: [],
  },
};

export const inputSupersedeToolDefinition = {
  name: 'input_supersede',
  description:
    'Mark an Input source file as superseded by a newer version. Writes superseded_by frontmatter. Never deletes the original.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      rel_path: {
        type: 'string',
        description: 'Relative path of the file to mark as superseded',
      },
      superseded_by: {
        type: 'string',
        description: 'Relative path of the newer version that supersedes it',
      },
      reason: {
        type: 'string',
        description: 'Optional reason for supersession (logged but not stored in file)',
      },
    },
    required: ['rel_path', 'superseded_by'],
  },
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export async function handleInputIngest(args: unknown): Promise<CallToolResult> {
  try {
    const input = InputIngestSchema.parse(args);
    await ingestInput({
      relPath: input.rel_path,
      content: input.content,
      kind: input.kind,
      sourceUrl: input.source_url,
      description: input.description,
    });
    logger.info('input_ingest succeeded', { relPath: input.rel_path });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            rel_path: input.rel_path,
            kind: input.kind,
            message: `Ingested: ${input.rel_path}`,
          }),
        },
      ],
    };
  } catch (error) {
    logger.error('input_ingest failed', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleInputRead(args: unknown): Promise<CallToolResult> {
  try {
    const input = InputReadSchema.parse(args);
    const result = await readInputFile(input.rel_path);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            rel_path: input.rel_path,
            metadata: result.metadata,
            content: result.content,
          }),
        },
      ],
    };
  } catch (error) {
    logger.error('input_read failed', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleInputList(args: unknown): Promise<CallToolResult> {
  try {
    const input = InputListSchema.parse(args);
    const entries = await listInput(input.subfolder);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ count: entries.length, entries }),
        },
      ],
    };
  } catch (error) {
    logger.error('input_list failed', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error: ${formatError(error)}` }],
      isError: true,
    };
  }
}

export async function handleInputSupersede(args: unknown): Promise<CallToolResult> {
  try {
    const input = InputSupersedeSchema.parse(args);
    await supersededInput(input.rel_path, input.superseded_by);
    logger.info('input_supersede succeeded', { relPath: input.rel_path, supersededBy: input.superseded_by });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            rel_path: input.rel_path,
            superseded_by: input.superseded_by,
            message: `Marked ${input.rel_path} as superseded by ${input.superseded_by}`,
          }),
        },
      ],
    };
  } catch (error) {
    logger.error('input_supersede failed', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error: ${formatError(error)}` }],
      isError: true,
    };
  }
}
