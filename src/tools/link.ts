import { formatError } from '../shared/errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { LinkInputSchema } from '../schemas/tools.js';
import { findById, indexEntry as updateIndex } from '../vault/search.js';
import { readMemoryFile, writeMemoryFile } from '../vault/filesystem.js';
import { parseMemoryFile, serializeMemory } from '../vault/frontmatter.js';
import { discoverLinks, addRelatedLink } from '../vault/links.js';
import { nowISO } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

export const linkToolDefinition = {
  name: 'memory_link',
  description:
    'Create a bidirectional link between two memories, or discover existing connections for a memory.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      source_id: { type: 'string', description: 'Source memory ID' },
      target_id: { type: 'string', description: 'Target memory ID to link to' },
      discover: {
        type: 'boolean',
        description: 'If true, return all links for source_id instead of creating a link',
      },
    },
    required: ['source_id'],
  },
};

export async function handleLink(args: unknown): Promise<CallToolResult> {
  try {
    const input = LinkInputSchema.parse(args);

    const sourceEntry = findById(input.source_id);
    if (!sourceEntry) {
      return {
        content: [{ type: 'text', text: `Source memory not found: ${input.source_id}` }],
        isError: true,
      };
    }

    // Discover mode
    if (input.discover) {
      const links = await discoverLinks(sourceEntry.slug);

      const outgoing = links.outgoing.length > 0
        ? `**Links to:** ${links.outgoing.map((s) => `[[${s}]]`).join(', ')}`
        : 'No outgoing links';
      const incoming = links.incoming.length > 0
        ? `**Linked from:** ${links.incoming.map((s) => `[[${s}]]`).join(', ')}`
        : 'No incoming links (backlinks)';

      return {
        content: [
          {
            type: 'text',
            text: `Links for "${sourceEntry.frontmatter.title}":\n\n${outgoing}\n${incoming}`,
          },
        ],
      };
    }

    // Create link mode
    const targetEntry = findById(input.target_id!);
    if (!targetEntry) {
      return {
        content: [{ type: 'text', text: `Target memory not found: ${input.target_id}` }],
        isError: true,
      };
    }

    // Add link in source -> target
    const sourceRaw = await readMemoryFile(sourceEntry.filePath);
    const sourceParsed = parseMemoryFile(sourceRaw);
    const updatedSourceContent = addRelatedLink(sourceParsed.content, targetEntry.slug);
    if (!sourceParsed.frontmatter.related.includes(targetEntry.slug)) {
      sourceParsed.frontmatter.related.push(targetEntry.slug);
    }
    sourceParsed.frontmatter.updated = nowISO();
    await writeMemoryFile(
      sourceEntry.filePath,
      serializeMemory(sourceParsed.frontmatter, updatedSourceContent)
    );
    updateIndex(sourceParsed.frontmatter.id, {
      ...sourceEntry,
      frontmatter: sourceParsed.frontmatter,
    });

    // Add backlink target -> source
    const targetRaw = await readMemoryFile(targetEntry.filePath);
    const targetParsed = parseMemoryFile(targetRaw);
    const updatedTargetContent = addRelatedLink(targetParsed.content, sourceEntry.slug);
    if (!targetParsed.frontmatter.related.includes(sourceEntry.slug)) {
      targetParsed.frontmatter.related.push(sourceEntry.slug);
    }
    targetParsed.frontmatter.updated = nowISO();
    await writeMemoryFile(
      targetEntry.filePath,
      serializeMemory(targetParsed.frontmatter, updatedTargetContent)
    );
    updateIndex(targetParsed.frontmatter.id, {
      ...targetEntry,
      frontmatter: targetParsed.frontmatter,
    });

    logger.info('Linked memories', {
      source: sourceEntry.slug,
      target: targetEntry.slug,
    });

    return {
      content: [
        {
          type: 'text',
          text: `Linked: [[${sourceEntry.slug}]] <-> [[${targetEntry.slug}]]`,
        },
      ],
    };
  } catch (error) {
    logger.error('Failed to link memories', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error linking memories: ${formatError(error)}`,
        },
      ],
      isError: true,
    };
  }
}
