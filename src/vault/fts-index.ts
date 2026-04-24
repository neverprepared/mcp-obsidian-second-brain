import { logger } from '../shared/logger.js';
import type Database from 'better-sqlite3';

let db: Database.Database | null = null;

/**
 * Initialize FTS5 virtual table in the given SQLite database.
 * Reuses the same DB instance as the vector index.
 */
export function initFts(sqliteDb: Database.Database): void {
  db = sqliteDb;
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_memories
      USING fts5(id UNINDEXED, title, tags, body, tokenize='porter unicode61');
    `);
    logger.info('FTS5 index initialized');
  } catch (err) {
    logger.warn('FTS5 init failed — full-text search disabled', { error: String(err) });
    db = null;
  }
}

export function isFtsReady(): boolean {
  return db !== null;
}

/** Insert or replace an FTS entry. Tags are stored as space-separated for tokenization. */
export function upsertFts(id: string, title: string, tags: string[], body: string): void {
  if (!db) return;
  const tagStr = tags.join(' ');
  // FTS5 doesn't support UPSERT — delete then insert
  db.prepare('DELETE FROM fts_memories WHERE id = ?').run(id);
  db.prepare(
    'INSERT INTO fts_memories (id, title, tags, body) VALUES (?, ?, ?, ?)'
  ).run(id, title, tagStr, body);
}

/** Remove an FTS entry by memory id. */
export function deleteFts(id: string): void {
  if (!db) return;
  db.prepare('DELETE FROM fts_memories WHERE id = ?').run(id);
}

export interface FtsResult {
  id: string;
  rank: number;
  snippet: string;
}

/**
 * Search FTS5 index. Returns scored results sorted by relevance.
 * Uses FTS5 rank (BM25) and snippet extraction.
 */
export function searchFts(query: string, limit: number): FtsResult[] {
  if (!db) return [];

  // Sanitize query for FTS5: escape double quotes, wrap terms for prefix matching
  const sanitized = sanitizeFtsQuery(query);
  if (!sanitized) return [];

  try {
    const stmt = db.prepare(`
      SELECT id, rank,
        snippet(fts_memories, 3, '>>>', '<<<', '...', 32) as snippet
      FROM fts_memories
      WHERE fts_memories MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    const rows = stmt.all(sanitized, limit) as Array<{
      id: string;
      rank: number;
      snippet: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      rank: -r.rank, // FTS5 rank is negative (closer to 0 = better), flip for intuitive scoring
      snippet: r.snippet,
    }));
  } catch (err) {
    logger.warn('FTS5 search failed, falling back', { query, error: String(err) });
    return [];
  }
}

/** Rebuild the entire FTS index from scratch. Called during buildIndex(). */
export function rebuildFts(
  entries: Array<{ id: string; title: string; tags: string[]; body: string }>
): void {
  if (!db) return;

  const tx = db.transaction(() => {
    db!.prepare('DELETE FROM fts_memories').run();
    const insert = db!.prepare(
      'INSERT INTO fts_memories (id, title, tags, body) VALUES (?, ?, ?, ?)'
    );
    for (const e of entries) {
      insert.run(e.id, e.title, e.tags.join(' '), e.body);
    }
  });

  tx();
  logger.info('FTS5 index rebuilt', { count: entries.length });
}

/**
 * Sanitize a user query for FTS5 MATCH syntax.
 * Wraps each word as a prefix token (word*) and joins with implicit AND.
 * Strips FTS5 special characters to prevent syntax errors.
 */
function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 operators and special chars
  const cleaned = query.replace(/[":(){}[\]^~*+\-!/\\]/g, ' ').trim();
  if (!cleaned) return '';

  const terms = cleaned
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`); // prefix match with quoting for safety

  return terms.join(' ');
}
