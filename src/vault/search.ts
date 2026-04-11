import type { Frontmatter, ParaCategory, Status } from '../schemas/frontmatter.js';
import { listAllMemoryFiles, readMemoryFile, writeMemoryFile } from './filesystem.js';
import { parseMemoryFile, serializeMemory } from './frontmatter.js';
import { nowISO, isStale } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

export interface IndexEntry {
  frontmatter: Frontmatter;
  filePath: string;
  slug: string;
}

let memoryIndex: Map<string, IndexEntry> = new Map();

export async function buildIndex(): Promise<void> {
  const newIndex = new Map<string, IndexEntry>();
  const files = await listAllMemoryFiles();

  for (const entry of files) {
    try {
      const raw = await readMemoryFile(entry.filePath);
      const parsed = parseMemoryFile(raw);
      newIndex.set(parsed.frontmatter.id, {
        frontmatter: parsed.frontmatter,
        filePath: entry.filePath,
        slug: entry.slug,
      });
    } catch (err) {
      logger.warn('Failed to index memory file', {
        path: entry.filePath,
        error: String(err),
      });
    }
  }

  memoryIndex = newIndex;
  logger.info('Memory index built', { count: newIndex.size });
}

export function getIndex(): Map<string, IndexEntry> {
  return memoryIndex;
}

export function indexEntry(id: string, entry: IndexEntry): void {
  memoryIndex.set(id, entry);
}

export function removeFromIndex(id: string): void {
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
  for (const entry of memoryIndex.values()) {
    if (entry.slug === slug) {
      return entry;
    }
  }
  return undefined;
}

export interface SearchOptions {
  query?: string;
  tags?: string[];
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

export async function searchMemories(options: SearchOptions): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  for (const entry of memoryIndex.values()) {
    const fm = entry.frontmatter;

    // Apply filters
    if (options.para && fm.para !== options.para) continue;
    if (options.status && fm.status !== options.status) continue;
    if (options.tags && options.tags.length > 0) {
      const hasAllTags = options.tags.every((t) =>
        fm.tags.some((ft) => ft.toLowerCase() === t.toLowerCase())
      );
      if (!hasAllTags) continue;
    }

    // Freshness filter
    const entryStale = isStale(fm.updated, fm.ttl_days, fm.para);
    if (options.freshness && options.freshness !== 'all') {
      if (options.freshness === 'fresh' && entryStale) continue;
      if (options.freshness === 'stale' && !entryStale) continue;
    }

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

      // Content match
      try {
        const raw = await readMemoryFile(entry.filePath);
        const contentLower = raw.toLowerCase();
        const idx = contentLower.indexOf(queryLower);
        if (idx !== -1) {
          score += 1;
          // Extract snippet around match
          const start = Math.max(0, idx - 50);
          const end = Math.min(raw.length, idx + options.query.length + 50);
          snippet = (start > 0 ? '...' : '') + raw.slice(start, end).trim() + (end < raw.length ? '...' : '');
        }
      } catch {
        // Skip content search on read failure
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
