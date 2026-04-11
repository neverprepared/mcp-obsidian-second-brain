import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { UpdateInputSchema } from '../schemas/tools.js';
import { findById, indexEntry as updateIndex } from '../vault/search.js';
import { readMemoryFile, writeMemoryFile, memoryFilePath } from '../vault/filesystem.js';
import { parseMemoryFile, serializeMemory } from '../vault/frontmatter.js';
import { slugFromTitle, deduplicateSlug } from '../vault/naming.js';
import { paraFolderFromCategory, CONFIG } from '../config.js';
import { nowISO } from '../shared/utils.js';
import { logger } from '../shared/logger.js';
import path from 'node:path';

export const updateToolDefinition = {
  name: 'memory_update',
  description:
    'Update an existing memory. Can modify content, tags, PARA category, or metadata. Moving PARA category physically relocates the file.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      id: { type: 'string', description: 'Memory ID to update' },
      title: { type: 'string', description: 'New title (also renames file)' },
      content: { type: 'string', description: 'New or appended content' },
      append: { type: 'boolean', description: 'If true, append content instead of replacing (default: false)' },
      para: {
        type: 'string',
        enum: ['projects', 'areas', 'resources', 'archives'],
        description: 'New PARA category (moves the file)',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Replace tags entirely',
      },
      add_tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Add to existing tags',
      },
      related: {
        type: 'array',
        items: { type: 'string' },
        description: 'Replace related links',
      },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      status: { type: 'string', enum: ['active', 'stale', 'archived'] },
      source_urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'Replace source URLs',
      },
      ttl_days: { type: 'number', description: 'Days before considered stale' },
    },
    required: ['id'],
  },
};

export async function handleUpdate(args: unknown): Promise<CallToolResult> {
  try {
    const input = UpdateInputSchema.parse(args);

    const entry = findById(input.id);
    if (!entry) {
      return {
        content: [{ type: 'text', text: `Memory not found: ${input.id}` }],
        isError: true,
      };
    }

    const raw = await readMemoryFile(entry.filePath);
    const parsed = parseMemoryFile(raw);
    const fm = { ...parsed.frontmatter };
    let content = parsed.content;

    // Apply updates
    if (input.title !== undefined) fm.title = input.title;
    if (input.para !== undefined) fm.para = input.para;
    if (input.tags !== undefined) fm.tags = input.tags;
    if (input.add_tags !== undefined) {
      const existing = new Set(fm.tags);
      for (const t of input.add_tags) existing.add(t);
      fm.tags = Array.from(existing);
    }
    if (input.related !== undefined) fm.related = input.related;
    if (input.confidence !== undefined) fm.confidence = input.confidence;
    if (input.status !== undefined) fm.status = input.status;
    if (input.source_urls !== undefined) fm.source_urls = input.source_urls;
    if (input.ttl_days !== undefined) fm.ttl_days = input.ttl_days;

    if (input.content !== undefined) {
      content = input.append ? `${content}\n\n${input.content}` : input.content;
    }

    fm.updated = nowISO();

    const fileContent = serializeMemory(fm, content);

    // Determine if file needs to move
    let newSlug = entry.slug;
    let newFilePath = entry.filePath;

    if (input.title !== undefined) {
      const baseSlug = slugFromTitle(input.title);
      if (baseSlug !== entry.slug) {
        const folder = paraFolderFromCategory(fm.para);
        const dir = path.join(CONFIG.VAULT_PATH, folder);
        newSlug = await deduplicateSlug(dir, baseSlug);
        newFilePath = memoryFilePath(fm.para, newSlug);
      }
    }

    if (input.para !== undefined && input.para !== parsed.frontmatter.para) {
      // PARA category changed, move file
      newFilePath = memoryFilePath(fm.para, newSlug);
    }

    if (newFilePath !== entry.filePath) {
      await writeMemoryFile(newFilePath, fileContent);
      const fs = await import('node:fs/promises');
      await fs.unlink(entry.filePath);
    } else {
      await writeMemoryFile(newFilePath, fileContent);
    }

    // Update index
    updateIndex(fm.id, { frontmatter: fm, filePath: newFilePath, slug: newSlug });

    logger.info('Updated memory', { id: fm.id, slug: newSlug });

    return {
      content: [
        {
          type: 'text',
          text: `Updated memory: "${fm.title}"\nID: ${fm.id}\nPath: ${paraFolderFromCategory(fm.para)}/${newSlug}.md`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to update memory', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error updating memory: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
