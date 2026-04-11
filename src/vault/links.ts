import { readMemoryFile, writeMemoryFile } from './filesystem.js';
import { getIndex, findBySlug } from './search.js';
import { parseMemoryFile, serializeMemory } from './frontmatter.js';
import { logger } from '../shared/logger.js';

const MIN_SHARED_TAGS = 2;

const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

export function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  let match;
  while ((match = WIKI_LINK_RE.exec(content)) !== null) {
    const link = match[1];
    if (link) {
      links.push(link);
    }
  }
  return links;
}

export function buildRelatedSection(slugs: string[]): string {
  if (slugs.length === 0) return '';
  const links = slugs.map((s) => `- [[${s}]]`).join('\n');
  return `\n\n## Related\n\n${links}`;
}

export interface LinkGraph {
  outgoing: string[]; // Slugs this memory links to
  incoming: string[]; // Slugs that link to this memory
}

export async function discoverLinks(slug: string): Promise<LinkGraph> {
  const index = getIndex();
  const outgoing: string[] = [];
  const incoming: string[] = [];

  // Find outgoing links from this memory
  const entry = findBySlug(slug);
  if (entry) {
    try {
      const raw = await readMemoryFile(entry.filePath);
      outgoing.push(...extractWikiLinks(raw));
    } catch {
      // Skip on read failure
    }
  }

  // Find incoming links (backlinks) from all other memories
  for (const other of index.values()) {
    if (other.slug === slug) continue;
    try {
      const raw = await readMemoryFile(other.filePath);
      const links = extractWikiLinks(raw);
      if (links.includes(slug)) {
        incoming.push(other.slug);
      }
    } catch {
      // Skip on read failure
    }
  }

  return { outgoing, incoming };
}

export function addRelatedLink(content: string, targetSlug: string): string {
  const relatedHeader = '## Related';
  const newLink = `- [[${targetSlug}]]`;

  if (content.includes(relatedHeader)) {
    // Check if link already exists
    if (content.includes(`[[${targetSlug}]]`)) {
      return content;
    }
    // Append to existing Related section
    return content.replace(relatedHeader, `${relatedHeader}\n${newLink}`);
  }

  // Add new Related section
  return content.trimEnd() + `\n\n${relatedHeader}\n\n${newLink}\n`;
}

/**
 * Find existing memories that share >= MIN_SHARED_TAGS tags with the given tag set.
 * Returns their slugs, sorted by number of shared tags (most related first).
 */
export function findRelatedByTags(tags: string[], excludeSlug?: string): string[] {
  const index = getIndex();
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));

  const matches: Array<{ slug: string; shared: number }> = [];

  for (const entry of index.values()) {
    if (entry.slug === excludeSlug) continue;
    const entryTags = entry.frontmatter.tags.map((t) => t.toLowerCase());
    const shared = entryTags.filter((t) => tagSet.has(t)).length;
    if (shared >= MIN_SHARED_TAGS) {
      matches.push({ slug: entry.slug, shared });
    }
  }

  return matches
    .sort((a, b) => b.shared - a.shared)
    .map((m) => m.slug);
}

/**
 * Auto-link a newly stored memory to related memories (bidirectional).
 * - Adds [[wiki-links]] from the new memory to related ones
 * - Adds backlinks from related memories back to the new one
 * - Updates frontmatter `related` arrays on both sides
 *
 * Fire-and-forget: errors are logged but don't fail the store.
 */
export async function autoLinkRelated(
  newSlug: string,
  newFilePath: string,
  tags: string[],
): Promise<string[]> {
  try {
    const relatedSlugs = findRelatedByTags(tags, newSlug);
    if (relatedSlugs.length === 0) return [];

    // 1. Update the new memory file: add outgoing links
    const newRaw = await readMemoryFile(newFilePath);
    const newParsed = parseMemoryFile(newRaw);

    const existingRelated = new Set(newParsed.frontmatter.related);
    for (const slug of relatedSlugs) {
      existingRelated.add(slug);
    }
    newParsed.frontmatter.related = [...existingRelated];

    let newContent = newParsed.content;
    for (const slug of relatedSlugs) {
      newContent = addRelatedLink(newContent, slug);
    }

    await writeMemoryFile(newFilePath, serializeMemory(newParsed.frontmatter, newContent));

    // 2. Update each related memory: add backlink to the new memory
    for (const slug of relatedSlugs) {
      try {
        const entry = findBySlug(slug);
        if (!entry) continue;

        const raw = await readMemoryFile(entry.filePath);
        const parsed = parseMemoryFile(raw);

        // Skip if already linked
        if (parsed.frontmatter.related.includes(newSlug)) continue;

        parsed.frontmatter.related.push(newSlug);
        const updatedContent = addRelatedLink(parsed.content, newSlug);

        await writeMemoryFile(entry.filePath, serializeMemory(parsed.frontmatter, updatedContent));

        // Update in-memory index
        entry.frontmatter.related = parsed.frontmatter.related;
      } catch (err) {
        logger.warn('Failed to add backlink', { slug, newSlug, error: String(err) });
      }
    }

    logger.info('Auto-linked related memories', { newSlug, linkedCount: relatedSlugs.length });
    return relatedSlugs;
  } catch (err) {
    logger.warn('Auto-linking failed', { newSlug, error: String(err) });
    return [];
  }
}
