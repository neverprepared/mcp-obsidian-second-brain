import type { Frontmatter, ParaCategory, Status } from '../schemas/frontmatter.js';
import { listAllMemoryFiles, readMemoryFile, writeMemoryFile } from './filesystem.js';
import { parseMemoryFile, serializeMemory } from './frontmatter.js';
import { nowISO, isStale } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

export interface IndexEntry {
  frontmatter: Frontmatter;
  filePath: string;
  slug: string;
  body?: string; // cached markdown body (without frontmatter)
}

let memoryIndex: Map<string, IndexEntry> = new Map();
let slugIndex: Map<string, string> = new Map(); // slug -> id

export async function buildIndex(): Promise<void> {
  const newIndex = new Map<string, IndexEntry>();
  const newSlugIndex = new Map<string, string>();
  const files = await listAllMemoryFiles();

  for (const entry of files) {
    try {
      const raw = await readMemoryFile(entry.filePath);
      const parsed = parseMemoryFile(raw);
      const id = parsed.frontmatter.id;
      newIndex.set(id, {
        frontmatter: parsed.frontmatter,
        filePath: entry.filePath,
        slug: entry.slug,
        body: parsed.content,
      });
      newSlugIndex.set(entry.slug, id);
    } catch (err) {
      logger.warn('Failed to index memory file', {
        path: entry.filePath,
        error: String(err),
      });
    }
  }

  memoryIndex = newIndex;
  slugIndex = newSlugIndex;
  logger.info('Memory index built', { count: newIndex.size });
}

export function getIndex(): Map<string, IndexEntry> {
  return memoryIndex;
}

export function indexEntry(id: string, entry: IndexEntry): void {
  // Clean up old slug from reverse index if slug changed
  const existing = memoryIndex.get(id);
  if (existing && existing.slug !== entry.slug) {
    slugIndex.delete(existing.slug);
  }
  memoryIndex.set(id, entry);
  slugIndex.set(entry.slug, id);
}

export function removeFromIndex(id: string): void {
  const entry = memoryIndex.get(id);
  if (entry) {
    slugIndex.delete(entry.slug);
  }
  memoryIndex.delete(id);
}

export function findById(id: string): IndexEntry | undefined {
  return memoryIndex.get(id);
}

export function findByTitle(title: string): IndexEntry | undefined {
  const lower = title.toLowerCase();
  for (const entry of memoryIndex.values()) {
    if (entry.frontmatter.title.toLowerCase() === lower) {
      return entry;
    }
  }
  // Partial match fallback
  for (const entry of memoryIndex.values()) {
    if (entry.frontmatter.title.toLowerCase().includes(lower)) {
      return entry;
    }
  }
  return undefined;
}

export function findBySlug(slug: string): IndexEntry | undefined {
  const id = slugIndex.get(slug);
  return id ? memoryIndex.get(id) : undefined;
}

export interface DateFilters {
  created_after?: string;
  created_before?: string;
  updated_after?: string;
  updated_before?: string;
}

export interface SearchOptions extends DateFilters {
  query?: string;
  tags?: string[];
  tag_mode?: 'and' | 'or';
  para?: ParaCategory;
  status?: Status;
  freshness?: 'all' | 'fresh' | 'stale';
  limit: number;
}

export interface SearchResult {
  entry: IndexEntry;
  score: number;
  snippet?: string;
  stale: boolean;
}

/** Returns false if the entry is excluded by filters, true if it passes. */
export function passesFilters(entry: IndexEntry, options: Omit<SearchOptions, 'query' | 'limit'>): boolean {
  const fm = entry.frontmatter;

  if (options.para && fm.para !== options.para) return false;
  if (options.status && fm.status !== options.status) return false;

  if (options.tags && options.tags.length > 0) {
    const mode = options.tag_mode ?? 'and';
    const entryTagsLower = fm.tags.map((t) => t.toLowerCase());
    const filterTagsLower = options.tags.map((t) => t.toLowerCase());

    if (mode === 'and') {
      if (!filterTagsLower.every((t) => entryTagsLower.includes(t))) return false;
    } else {
      if (!filterTagsLower.some((t) => entryTagsLower.includes(t))) return false;
    }
  }

  const entryStale = isStale(fm.updated, fm.ttl_days, fm.para);
  if (options.freshness && options.freshness !== 'all') {
    if (options.freshness === 'fresh' && entryStale) return false;
    if (options.freshness === 'stale' && !entryStale) return false;
  }

  if (options.created_after && fm.created < options.created_after) return false;
  if (options.created_before && fm.created > options.created_before) return false;
  if (options.updated_after && fm.updated < options.updated_after) return false;
  if (options.updated_before && fm.updated > options.updated_before) return false;

  return true;
}

export async function searchMemories(options: SearchOptions): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (const entry of memoryIndex.values()) {
    const fm = entry.frontmatter;

    if (!passesFilters(entry, options)) continue;

    const entryStale = isStale(fm.updated, fm.ttl_days, fm.para);
    let score = 0;
    let snippet: string | undefined;

    if (options.query) {
      const queryLower = options.query.toLowerCase();

      // Title match
      if (fm.title.toLowerCase().includes(queryLower)) {
        score += 10;
      }

      // Tag match
      if (fm.tags.some((t) => t.toLowerCase().includes(queryLower))) {
        score += 5;
      }

      // Content match — use cached body if available
      const bodyText = entry.body ?? '';
      const bodyLower = bodyText.toLowerCase();
      const idx = bodyLower.indexOf(queryLower);
      if (idx !== -1) {
        score += 1;
        const start = Math.max(0, idx - 50);
        const end = Math.min(bodyText.length, idx + options.query.length + 50);
        snippet =
          (start > 0 ? '...' : '') +
          bodyText.slice(start, end).trim() +
          (end < bodyText.length ? '...' : '');
      }

      // Skip if no match at all
      if (score === 0) continue;
    } else {
      score = 1; // All pass when no query
    }

    results.push({ entry, score, snippet, stale: entryStale });
  }

  // Sort by score descending, then by updated descending
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.frontmatter.updated.localeCompare(a.entry.frontmatter.updated);
  });

  return results.slice(0, options.limit);
}

export async function updateLastAccessed(id: string): Promise<void> {
  try {
    const entry = memoryIndex.get(id);
    if (!entry) return;

    const raw = await readMemoryFile(entry.filePath);
    const parsed = parseMemoryFile(raw);
    parsed.frontmatter.last_accessed = nowISO();

    const fileContent = serializeMemory(parsed.frontmatter, parsed.content);
    await writeMemoryFile(entry.filePath, fileContent);

    entry.frontmatter.last_accessed = parsed.frontmatter.last_accessed;
  } catch (err) {
    logger.warn('Failed to update last_accessed', { id, error: String(err) });
  }
}
