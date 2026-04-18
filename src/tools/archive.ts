import { formatError } from '../shared/errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ArchiveInputSchema } from '../schemas/tools.js';
import { handleUpdate } from './update.js';
import { logger } from '../shared/logger.js';

export const archiveToolDefinition = {
  name: 'memory_archive',
  description:
    'Archive a memory in place. Sets status to archived without moving the file, preserving graph links and searchability.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'Memory ID to archive' },
    },
    required: ['id'],
  },
};

export async function handleArchive(args: unknown): Promise<CallToolResult> {
  try {
    const input = ArchiveInputSchema.parse(args);
    // Archive in place: only change status, don't move to Archives folder
    return handleUpdate({
      id: input.id,
      status: 'archived',
    });
  } catch (error) {
    logger.error('Failed to archive memory', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error archiving memory: ${formatError(error)}`,
        },
      ],
      isError: true,
    };
  }
}
