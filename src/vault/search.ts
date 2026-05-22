import type { Frontmatter, LifecycleStatus, Status } from '../schemas/frontmatter.js';
import { listAllMemoryFiles, readMemoryFile, writeMemoryFile } from './filesystem.js';
import { parseMemoryFile, serializeMemory } from './frontmatter.js';
import { nowISO, isStale } from '../shared/utils.js';
import { logger } from '../shared/logger.js';
import { embedText, buildEmbedText } from './embeddings.js';
import { isVectorIndexReady, searchVectors, upsertVector, deleteVector } from './vector-index.js';
import { isFtsReady, rebuildFts, searchFts, upsertFts, deleteFts } from './fts-index.js';

export interface IndexEntry {
  frontmatter: Frontmatter;
  filePath: string;
  slug: string;
}

let memoryIndex: Map<string, IndexEntry> = new Map();
let slugIndex: Map<string, string> = new Map(); // slug -> id
let titleIndex: Map<string, string> = new Map(); // lowercase title -> id

export async function buildIndex(): Promise<void> {
  const newIndex = new Map<string, IndexEntry>();
  const newSlugIndex = new Map<string, string>();
  const newTitleIndex = new Map<string, string>();
  const files = await listAllMemoryFiles();

  // Collect bodies transiently during the walk to feed FTS, then drop.
  const ftsEntries: Array<{ id: string; title: string; tags: string[]; body: string }> = [];

  for (const entry of files) {
    try {
      const raw = await readMemoryFile(entry.filePath);
      const parsed = parseMemoryFile(raw);
      const id = parsed.frontmatter.id;
      newIndex.set(id, {
        frontmatter: parsed.frontmatter,
        filePath: entry.filePath,
        slug: entry.slug,
      });
      newSlugIndex.set(entry.slug, id);
      newTitleIndex.set(parsed.frontmatter.title.toLowerCase(), id);
      ftsEntries.push({
        id,
        title: parsed.frontmatter.title,
        tags: parsed.frontmatter.tags,
        body: parsed.content,
      });
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

  if (isFtsReady()) {
    rebuildFts(ftsEntries);
  }

  logger.info('Memory index built', { count: newIndex.size });
}

export function getIndex(): Map<string, IndexEntry> {
  return memoryIndex;
}

export function indexEntry(id: string, entry: IndexEntry, body: string): void {
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

  // Keep FTS in sync. Caller must pass the current body (they just wrote it).
  upsertFts(id, entry.frontmatter.title, entry.frontmatter.tags, body);

  // Vector update fire-and-forget so FTS and vectors stay in sync without
  // forcing every caller to remember to embed.
  void embedText(buildEmbedText(entry.frontmatter.title, entry.frontmatter.tags, body)).then((embedding) => {
    if (embedding) upsertVector(id, embedding);
  });
}

export function removeFromIndex(id: string): void {
  const entry = memoryIndex.get(id);
  if (entry) {
    slugIndex.delete(entry.slug);
    titleIndex.delete(entry.frontmatter.title.toLowerCase());
  }
  memoryIndex.delete(id);
  deleteFts(id);
  deleteVector(id);
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
  exclude_tags?: string[];
  lifecycle_status?: LifecycleStatus;
  status?: Status;
  freshness?: 'all' | 'fresh' | 'stale';
  sort_by?: 'relevance' | 'created' | 'updated' | 'title';
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

  if (options.lifecycle_status && fm.lifecycle_status !== options.lifecycle_status) return false;
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

  if (options.exclude_tags && options.exclude_tags.length > 0) {
    const entryTagsLower = fm.tags.map((t) => t.toLowerCase());
    const excludeLower = options.exclude_tags.map((t) => t.toLowerCase());
    if (excludeLower.some((t) => entryTagsLower.includes(t))) return false;
  }

  const entryStale = isStale(fm.updated, fm.ttl_days, fm.lifecycle_status);
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

/**
 * Score an entry against a keyword query. Returns 0 if no match.
 * Only used as a degraded fallback when FTS is unavailable; scores title and tags only
 * (body would require a disk read on every entry during search).
 */
function scoreKeyword(entry: IndexEntry, query: string): { score: number; snippet?: string } {
  const fm = entry.frontmatter;
  const queryLower = query.toLowerCase();
  let score = 0;

  if (fm.title.toLowerCase().includes(queryLower)) score += 10;
  if (fm.tags.some((t) => t.toLowerCase().includes(queryLower))) score += 5;

  return { score };
}

/** Apply sort_by to results. 'relevance' keeps existing score-based order. */
function applySortBy(results: SearchResult[], sortBy: string | undefined): void {
  if (!sortBy || sortBy === 'relevance') {
    // Already sorted by score descending, then updated descending
    return;
  }
  const sortFns: Record<string, (a: SearchResult, b: SearchResult) => number> = {
    created: (a, b) => b.entry.frontmatter.created.localeCompare(a.entry.frontmatter.created),
    updated: (a, b) => b.entry.frontmatter.updated.localeCompare(a.entry.frontmatter.updated),
    title: (a, b) => a.entry.frontmatter.title.localeCompare(b.entry.frontmatter.title),
  };
  const fn = sortFns[sortBy];
  if (fn) results.sort(fn);
}

export async function searchMemories(options: SearchOptions): Promise<SearchResult[]> {
  const mode = options.search_mode ?? 'auto';
  const useVector =
    mode !== 'keyword' &&
    Boolean(options.query) &&
    isVectorIndexReady();

  let results: SearchResult[];
  if (useVector && options.query) {
    results = await hybridSearch(options, options.query);
  } else {
    results = keywordSearch(options);
  }

  applySortBy(results, options.sort_by);
  return results;
}

async function hybridSearch(options: SearchOptions, query: string): Promise<SearchResult[]> {
  const queryEmbedding = await embedText(query);
  if (!queryEmbedding) return keywordSearch(options);

  const WINDOW = Math.max(options.limit * 10, 50);
  const RRF_K = 10;

  const vectorHits = searchVectors(queryEmbedding, WINDOW);
  const ftsHits = isFtsReady() ? searchFts(query, WINDOW) : [];

  // Build rank maps (1-indexed)
  const vectorRank = new Map(vectorHits.map((r, i) => [r.id, i + 1]));
  const ftsRank = new Map(ftsHits.map((r, i) => [r.id, i + 1]));
  const ftsSnippet = new Map(ftsHits.map((r) => [r.id, r.snippet]));

  // Collect all candidate IDs from both rankers
  const candidateIds = new Set<string>([
    ...vectorHits.map((r) => r.id),
    ...ftsHits.map((r) => r.id),
  ]);

  const candidates: SearchResult[] = [];

  for (const id of candidateIds) {
    const entry = memoryIndex.get(id);
    if (!entry) continue;
    if (!passesFilters(entry, options)) continue;

    const vr = vectorRank.get(id);
    const fr = ftsRank.get(id);

    let rrf = 0;
    if (vr) rrf += 1 / (RRF_K + vr);
    if (fr) rrf += 1 / (RRF_K + fr);

    const snippet = ftsSnippet.get(id) || undefined;
    const stale = isStale(entry.frontmatter.updated, entry.frontmatter.ttl_days, entry.frontmatter.lifecycle_status);
    candidates.push({ entry, score: Math.round(rrf * 10000) / 10000, snippet, stale });
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

    const entryStale = isStale(entry.frontmatter.updated, entry.frontmatter.ttl_days, entry.frontmatter.lifecycle_status);
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

    const stale = isStale(entry.frontmatter.updated, entry.frontmatter.ttl_days, entry.frontmatter.lifecycle_status);
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
