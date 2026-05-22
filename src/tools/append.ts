import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatError } from '../shared/errors.js';
import { findById } from '../vault/search.js';
import { readMemoryFile, writeMemoryFile, withFileLock } from '../vault/filesystem.js';
import { parseMemoryFile, serializeMemory } from '../vault/frontmatter.js';
import { nowISO } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

const AppendInputSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1),
  section_title: z.string().optional(), // e.g. "Update 2026-05-21" — defaults to today's date
});

export const memoryAppendToolDefinition = {
  name: 'memory_append',
  description: 'Append a dated section to an existing atom by ID. Use this instead of memory_update when you want to ADD new information without replacing existing content. Explicit by ID — no search guessing.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'Exact memory ID to append to' },
      content: { type: 'string', description: 'Content to append as a new section' },
      section_title: { type: 'string', description: 'Section heading (default: today\'s date)' },
    },
    required: ['id', 'content'],
  },
};

export async function handleMemoryAppend(args: unknown): Promise<CallToolResult> {
  try {
    const input = AppendInputSchema.parse(args);
    const entry = findById(input.id);
    if (!entry) {
      return { content: [{ type: 'text', text: `Memory not found: ${input.id}` }], isError: true };
    }

    const sectionTitle = input.section_title ?? nowISO().split('T')[0]!;

    await withFileLock(entry.filePath, async () => {
      const raw = await readMemoryFile(entry.filePath);
      const parsed = parseMemoryFile(raw, entry.filePath);
      parsed.frontmatter.updated = nowISO();
      const updatedContent = `${parsed.content.trimEnd()}\n\n## ${sectionTitle}\n\n${input.content.trim()}\n`;
      await writeMemoryFile(entry.filePath, serializeMemory(parsed.frontmatter, updatedContent));
    });

    logger.info('Appended to memory', { id: input.id, slug: entry.slug });
    return {
      content: [{ type: 'text', text: `Appended to memory: "${entry.frontmatter.title}"\nID: ${input.id}\nSection: ## ${sectionTitle}` }],
    };
  } catch (error) {
    logger.error('Failed to append to memory', { error: String(error) });
    return { content: [{ type: 'text', text: `Error: ${formatError(error)}` }], isError: true };
  }
}
