import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DeleteInputSchema } from '../schemas/tools.js';
import { findById, removeFromIndex } from '../vault/search.js';
import { deleteMemoryFile } from '../vault/filesystem.js';
import { logger } from '../shared/logger.js';

export const deleteToolDefinition = {
  name: 'memory_delete',
  description:
    'Permanently delete a memory. Removes the file from the vault. Consider archiving instead.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'Memory ID to delete' },
      confirm: { type: 'boolean', description: 'Must be true to confirm deletion' },
    },
    required: ['id', 'confirm'],
  },
};

export async function handleDelete(args: unknown): Promise<CallToolResult> {
  try {
    const input = DeleteInputSchema.parse(args);

    const entry = findById(input.id);
    if (!entry) {
      return {
        content: [{ type: 'text', text: `Memory not found: ${input.id}` }],
        isError: true,
      };
    }

    await deleteMemoryFile(entry.filePath);
    removeFromIndex(input.id);

    logger.info('Deleted memory', { id: input.id, slug: entry.slug });

    return {
      content: [
        {
          type: 'text',
          text: `Deleted memory: "${entry.frontmatter.title}" (${input.id})`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to delete memory', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error deleting memory: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
