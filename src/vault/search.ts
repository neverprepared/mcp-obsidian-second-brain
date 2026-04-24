import type { Frontmatter, ParaCategory, Status } from '../schemas/frontmatter.js';
import { listAllMemoryFiles, readMemoryFile, writeMemoryFile } from './filesystem.js';
import { parseMemoryFile, serializeMemory } from './frontmatter.js';
import { nowISO, isStale } from '../shared/utils.js';
import { logger } from '../shared/logger.js';
import { embedText } from './embeddings.js';
import { isVectorIndexReady, searchVectors } from './vector-index.js';
import { isFtsReady, rebuildFts, searchFts, upsertFts, deleteFts } from './fts-index.js';

export interface IndexEntry {
  frontmatter: Frontmatter;
  filePath: string;
  slug: string;
  body?: string; // cached markdown body (without frontmatter)
}

let memoryIndex: Map<string, IndexEntry> = new Map();
let slugIndex: Map<string, string> = new Map(); // slug -> id
let titleIndex: Map<string, string> = new Map(); // lowercase title -> id

export async function buildIndex(): Promise<void> {
  const newIndex = new Map<string, IndexEntry>();
  const newSlugIndex = new Map<string, string>();
  const newTitleIndex = new Map<string, string>();
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
      newTitleIndex.set(parsed.frontmatter.title.toLowerCase(), id);
    } catch (err) {
      logger.warn('Failed to index memory file', {
        path: entry.filePath,
        error: String(err),
      });
    }
  }

  memoryIndex = newIndex;
  slugIndex = newSlugIndex;
  titleIndex = newTitleIndex;

  // Populate FTS5 index from loaded entries
  if (isFtsReady()) {
    const ftsEntries = [...newIndex.values()].map((e) => ({
      id: e.frontmatter.id,
      title: e.frontmatter.title,
      tags: e.frontmatter.tags,
      body: e.body ?? '',
    }));
    rebuildFts(ftsEntries);
  }

  logger.info('Memory index built', { count: newIndex.size });
}

export function getIndex(): Map<string, IndexEntry> {
  return memoryIndex;
}

export function indexEntry(id: string, entry: IndexEntry): void {
  // Clean up old slug/title from reverse indexes if changed
  const existing = memoryIndex.get(id);
  if (existing) {
    if (existing.slug !== entry.slug) slugIndex.delete(existing.slug);
    if (existing.frontmatter.title !== entry.frontmatter.title) {
      titleIndex.delete(existing.frontmatter.title.toLowerCase());
    }
  }
  memoryIndex.set(id, entry);
  slugIndex.set(entry.slug, id);
  titleIndex.set(entry.frontmatter.title.toLowerCase(), id);

  // Keep FTS in sync
  upsertFts(id, entry.frontmatter.title, entry.frontmatter.tags, entry.body ?? '');
}

export function removeFromIndex(id: string): void {
  const entry = memoryIndex.get(id);
  if (entry) {
    slugIndex.delete(entry.slug);
    titleIndex.delete(entry.frontmatter.title.toLowerCase());
  }
  memoryIndex.delete(id);
  deleteFts(id);
}

export function findById(id: string): IndexEntry | undefined {
  return memoryIndex.get(id);
}

export function findByTitle(title: string): IndexEntry | undefined {
  const lower = title.toLowerCase();
  // O(1) exact match via title index
  const exactId = titleIndex.get(lower);
  if (exactId) return memoryIndex.get(exactId);
  // O(n) partial match fallback
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
  search_mode?: 'auto' | 'keyword' | 'vector';
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

/** Score an entry against a keyword query. Returns 0 if no match. */
function scoreKeyword(entry: IndexEntry, query: string): { score: number; snippet?: string } {
  const fm = entry.frontmatter;
  const queryLower = query.toLowerCase();
  let score = 0;
  let snippet: string | undefined;

  if (fm.title.toLowerCase().includes(queryLower)) score += 10;
  if (fm.tags.some((t) => t.toLowerCase().includes(queryLower))) score += 5;

  const bodyText = entry.body ?? '';
  const bodyLower = bodyText.toLowerCase();
  const idx = bodyLower.indexOf(queryLower);
  if (idx !== -1) {
    score += 1;
    const start = Math.max(0, idx - 50);
    const end = Math.min(bodyText.length, idx + query.length + 50);
    snippet =
      (start > 0 ? '...' : '') +
      bodyText.slice(start, end).trim() +
      (end < bodyText.length ? '...' : '');
  }

  return { score, snippet };
}

export async function searchMemories(options: SearchOptions): Promise<SearchResult[]> {
  const mode = options.search_mode ?? 'auto';
  const useVector =
    mode !== 'keyword' &&
    Boolean(options.query) &&
    isVectorIndexReady();

  if (useVector && options.query) {
    return hybridSearch(options, options.query);
  }
  return keywordSearch(options);
}

async function hybridSearch(options: SearchOptions, query: string): Promise<SearchResult[]> {
  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) return keywordSearch(options);

  const vectorHits = searchVectors(queryEmbedding, Math.min(options.limit * 5, 200));
  const vectorMap = new Map(vectorHits.map((r) => [r.id, r.distance]));

  // Use FTS5 for keyword scoring when available
  const ftsHits = isFtsReady() ? searchFts(query, options.limit * 5) : [];
  const ftsMap = new Map(ftsHits.map((r) => [r.id, { rank: r.rank, snippet: r.snippet }]));

  const candidates: SearchResult[] = [];

  for (const entry of memoryIndex.values()) {
    if (!passesFilters(entry, options)) continue;

    const id = entry.frontmatter.id;
    const distance = vectorMap.get(id);
    const ftsHit = ftsMap.get(id);

    // Fall back to legacy scoring if FTS unavailable
    let rawKey: number;
    let snippet: string | undefined;
    if (ftsHit) {
      rawKey = ftsHit.rank;
      snippet = ftsHit.snippet || undefined;
    } else if (ftsHits.length === 0) {
      // No FTS available, use legacy scorer
      const legacy = scoreKeyword(entry, query);
      rawKey = legacy.score;
      snippet = legacy.snippet;
    } else {
      // FTS available but this entry didn't match
      rawKey = 0;
    }

    if (rawKey === 0 && distance === undefined) continue;

    const vectorSim = distance !== undefined ? Math.max(0, 1 - distance) : 0;
    // Normalize keyword score: FTS rank can vary widely, cap at reasonable max
    const MAX_KEYWORD = ftsHits.length > 0 ? Math.max(1, ...ftsHits.map((h) => h.rank)) : 16;
    const normKey = rawKey / MAX_KEYWORD;

    let hybridScore: number;
    if (distance !== undefined && rawKey > 0) {
      hybridScore = 0.6 * vectorSim + 0.4 * normKey;
    } else if (distance !== undefined) {
      hybridScore = 0.6 * vectorSim;
    } else {
      hybridScore = 0.4 * normKey;
    }

    const stale = isStale(entry.frontmatter.updated, entry.frontmatter.ttl_days, entry.frontmatter.para);
    candidates.push({ entry, score: Math.round(hybridScore * 1000) / 1000, snippet, stale });
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.frontmatter.updated.localeCompare(a.entry.frontmatter.updated);
  });

  return candidates.slice(0, options.limit);
}

function keywordSearch(options: SearchOptions): SearchResult[] {
  // When FTS is available and a query is provided, use FTS5 for scoring
  if (options.query && isFtsReady()) {
    return ftsKeywordSearch(options, options.query);
  }

  // Fallback: O(n) in-memory scan
  const results: SearchResult[] = [];

  for (const entry of memoryIndex.values()) {
    if (!passesFilters(entry, options)) continue;

    const entryStale = isStale(entry.frontmatter.updated, entry.frontmatter.ttl_days, entry.frontmatter.para);
    let score = 0;
    let snippet: string | undefined;

    if (options.query) {
      const result = scoreKeyword(entry, options.query);
      score = result.score;
      snippet = result.snippet;
      if (score === 0) continue;
    } else {
      score = 1;
    }

    results.push({ entry, score, snippet, stale: entryStale });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.frontmatter.updated.localeCompare(a.entry.frontmatter.updated);
  });

  return results.slice(0, options.limit);
}

/**
 * FTS5-backed keyword search. Uses BM25 ranking from SQLite FTS5,
 * then applies in-memory filters (PARA, tags, status, freshness, dates).
 */
function ftsKeywordSearch(options: SearchOptions, query: string): SearchResult[] {
  // Fetch more than limit to allow for post-filtering
  const ftsHits = searchFts(query, options.limit * 5);
  const results: SearchResult[] = [];

  for (const hit of ftsHits) {
    const entry = memoryIndex.get(hit.id);
    if (!entry) continue;
    if (!passesFilters(entry, options)) continue;

    const stale = isStale(entry.frontmatter.updated, entry.frontmatter.ttl_days, entry.frontmatter.para);
    results.push({
      entry,
      score: hit.rank,
      snippet: hit.snippet || undefined,
      stale,
    });

    if (results.length >= options.limit) break;
  }

  return results;
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
