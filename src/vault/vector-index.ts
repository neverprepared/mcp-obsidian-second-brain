import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'node:path';
import fs from 'node:fs/promises';
import { CONFIG } from '../config.js';
import { getIndex } from './search.js';
import { embedBatch, buildEmbedText, isEmbeddingAvailable } from './embeddings.js';
import { logger } from '../shared/logger.js';
import { initFts } from './fts-index.js';

let vecDb: Database.Database | null = null;

function vectorDbPath(): string {
  return path.join(CONFIG.VAULT_PATH, CONFIG.INDEX_FOLDER, 'vectors.db');
}

export async function initVectorIndex(): Promise<void> {
  try {
    const dbPath = vectorDbPath();
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    vecDb = new Database(dbPath);
    sqliteVec.load(vecDb);

    vecDb.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id        TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        dims      INTEGER NOT NULL,
        updated   TEXT NOT NULL
      );
    `);

    // Initialize FTS5 in the same database
    initFts(vecDb);

    logger.info('Vector index initialized', { path: dbPath });
  } catch (err) {
    logger.warn('Vector index init failed — vector search disabled', { error: String(err) });
    vecDb = null;
  }
}

export function isVectorIndexReady(): boolean {
  return vecDb !== null;
}

/** Upsert a single embedding (float32 array stored as BLOB). */
export function upsertVector(id: string, embedding: number[]): void {
  if (!vecDb) return;
  const buf = Buffer.from(new Float32Array(embedding).buffer);
  vecDb.prepare(`
    INSERT OR REPLACE INTO embeddings (id, embedding, dims, updated)
    VALUES (?, ?, ?, datetime('now'))
  `).run(id, buf, embedding.length);
}

/** Remove a vector by memory id. */
export function deleteVector(id: string): void {
  if (!vecDb) return;
  vecDb.prepare('DELETE FROM embeddings WHERE id = ?').run(id);
}

/** Returns the set of memory ids that already have embeddings. */
export function getEmbeddedIds(): Set<string> {
  if (!vecDb) return new Set();
  const rows = vecDb.prepare('SELECT id FROM embeddings').all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Returns embedding coverage stats. */
export function getEmbeddingStats(): { embedded: number; total: number } {
  const total = getIndex().size;
  const embedded = vecDb
    ? (vecDb.prepare('SELECT COUNT(*) as n FROM embeddings').get() as { n: number }).n
    : 0;
  return { embedded, total };
}

/**
 * Search for the top-k nearest embeddings to a query vector.
 * Returns { id, distance } pairs sorted by ascending distance (closest first).
 */
export function searchVectors(queryEmbedding: number[], k: number): Array<{ id: string; distance: number }> {
  if (!vecDb) return [];

  // Manual cosine similarity — sqlite-vec vec0 requires different setup
  // Use dot-product over pre-normalized float32 blobs instead
  const rows = vecDb.prepare('SELECT id, embedding, dims FROM embeddings').all() as {
    id: string;
    embedding: Buffer;
    dims: number;
  }[];

  if (rows.length === 0) return [];

  const query = new Float32Array(queryEmbedding);
  const queryMag = magnitude(query);

  const scored = rows.map((row) => {
    const vec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.dims);
    const sim = cosineSimilarity(query, vec, queryMag);
    return { id: row.id, distance: 1 - sim }; // distance = 1 - similarity
  });

  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);
}

/**
 * Background sync: find vault notes missing embeddings and batch-embed them.
 * Non-blocking — caller does not await. Progress logged to stderr.
 */
export function syncVectorIndex(): void {
  if (!vecDb) return;

  // Run async in background — don't block server startup
  void (async () => {
    try {
      if (!(await isEmbeddingAvailable())) return;

      const index = getIndex();
      const embeddedIds = getEmbeddedIds();
      const missing = [...index.entries()].filter(([id]) => !embeddedIds.has(id));

      if (missing.length === 0) {
        logger.info('Vector index up to date', { count: embeddedIds.size });
        return;
      }

      logger.info('Syncing vector index', { missing: missing.length, total: index.size });

      // Build embed texts for all missing notes
      const texts = missing.map(([, entry]) =>
        buildEmbedText(
          entry.frontmatter.title,
          entry.frontmatter.tags,
          entry.body ?? '',
        )
      );

      const embeddings = await embedBatch(texts);

      let synced = 0;
      for (let i = 0; i < missing.length; i++) {
        const [id] = missing[i]!;
        const embedding = embeddings[i];
        if (embedding) {
          upsertVector(id, embedding);
          synced++;
        }
      }

      logger.info('Vector index sync complete', { synced, failed: missing.length - synced });
    } catch (err) {
      logger.warn('Vector index sync failed', { error: String(err) });
    }
  })();
}

// --- Math helpers ---

function magnitude(v: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += (v[i] ?? 0) ** 2;
  return Math.sqrt(sum);
}

function cosineSimilarity(a: Float32Array, b: Float32Array, aMag?: number): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0);
  const mag = (aMag ?? magnitude(a)) * magnitude(b);
  return mag === 0 ? 0 : dot / mag;
}
