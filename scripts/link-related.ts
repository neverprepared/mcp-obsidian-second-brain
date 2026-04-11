#!/usr/bin/env npx tsx
/**
 * Auto-link related memories based on shared tags.
 *
 * Memories sharing >= MIN_SHARED_TAGS tags get bidirectional [[wiki-links]]
 * in their ## Related sections and `related` frontmatter arrays.
 *
 * Usage: npx tsx scripts/link-related.ts [--dry-run] [--min-tags=2]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const VAULT_PATH =
  process.env['OBSIDIAN_VAULT_PATH'] ||
  path.join(process.env['HOME'] || '', 'workspaces/profiles/personal/obsidian/vaults/memory');

const PARA_FOLDERS = ['Projects', 'Areas', 'Resources', 'Archives'];
const dryRun = process.argv.includes('--dry-run');
const minTagsArg = process.argv.find((a) => a.startsWith('--min-tags='));
const MIN_SHARED_TAGS = minTagsArg ? parseInt(minTagsArg.split('=')[1]!, 10) : 2;

interface MemoryFile {
  filePath: string;
  slug: string;
  title: string;
  tags: string[];
  related: string[];
  raw: string;
  data: Record<string, unknown>;
  content: string;
}

async function loadAllMemories(): Promise<MemoryFile[]> {
  const memories: MemoryFile[] = [];

  for (const folder of PARA_FOLDERS) {
    const dirPath = path.join(VAULT_PATH, folder);
    let files: string[];
    try {
      files = (await fs.readdir(dirPath)).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(raw);
      const slug = file.replace(/\.md$/, '');

      memories.push({
        filePath,
        slug,
        title: (parsed.data.title as string) || slug,
        tags: (parsed.data.tags as string[]) || [],
        related: (parsed.data.related as string[]) || [],
        raw,
        data: parsed.data,
        content: parsed.content,
      });
    }
  }

  return memories;
}

function countSharedTags(a: string[], b: string[]): number {
  const setB = new Set(b.map((t) => t.toLowerCase()));
  return a.filter((t) => setB.has(t.toLowerCase())).length;
}

function addRelatedLink(content: string, targetSlug: string): string {
  const relatedHeader = '## Related';
  const newLink = `- [[${targetSlug}]]`;

  if (content.includes(`[[${targetSlug}]]`)) {
    return content; // already linked
  }

  if (content.includes(relatedHeader)) {
    return content.replace(relatedHeader, `${relatedHeader}\n${newLink}`);
  }

  return content.trimEnd() + `\n\n${relatedHeader}\n\n${newLink}\n`;
}

async function linkRelated() {
  const memories = await loadAllMemories();
  console.log(`Loaded ${memories.length} memories (min shared tags: ${MIN_SHARED_TAGS})\n`);

  // Build relationship map: slug -> set of related slugs
  const relationships = new Map<string, Set<string>>();
  for (const mem of memories) {
    relationships.set(mem.slug, new Set(mem.related));
  }

  // Find new relationships based on tag overlap
  let newLinks = 0;
  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const a = memories[i]!;
      const b = memories[j]!;
      const shared = countSharedTags(a.tags, b.tags);

      if (shared >= MIN_SHARED_TAGS) {
        const setA = relationships.get(a.slug)!;
        const setB = relationships.get(b.slug)!;

        if (!setA.has(b.slug)) {
          setA.add(b.slug);
          newLinks++;
        }
        if (!setB.has(a.slug)) {
          setB.add(a.slug);
          newLinks++;
        }
      }
    }
  }

  if (newLinks === 0) {
    console.log('No new links to create.');
    return;
  }

  console.log(`Found ${newLinks} new links to create.\n`);

  // Apply changes to files
  let filesUpdated = 0;
  for (const mem of memories) {
    const newRelated = [...relationships.get(mem.slug)!];
    const existingSet = new Set(mem.related);
    const additions = newRelated.filter((s) => !existingSet.has(s));

    if (additions.length === 0) continue;

    // Update frontmatter related array
    mem.data.related = newRelated;

    // Add wiki-links to content
    let updatedContent = mem.content;
    for (const slug of additions) {
      updatedContent = addRelatedLink(updatedContent, slug);
    }

    const output = matter.stringify(updatedContent, mem.data);

    console.log(
      `${dryRun ? '[DRY RUN] ' : ''}${mem.slug}` +
        `\n  + ${additions.length} new links: ${additions.join(', ')}\n`
    );

    if (!dryRun) {
      await fs.writeFile(mem.filePath, output, 'utf-8');
    }
    filesUpdated++;
  }

  console.log(
    `\n${dryRun ? '[DRY RUN] ' : ''}Complete: ${filesUpdated} files updated, ${newLinks} links created`
  );
}

linkRelated().catch((err) => {
  console.error('Linking failed:', err);
  process.exit(1);
});
