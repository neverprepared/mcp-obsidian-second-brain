import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { CONFIG } from '../config.js';
import { getIndex } from './search.js';
import { embedBatch, buildEmbedText, isEmbeddingAvailable } from './embeddings.js';
import { logger } from '../shared/logger.js';
import { initFts, isFtsReady } from './fts-index.js';

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

    // Enable WAL mode for concurrent read/write access across multiple
    // MCP server instances sharing the same database file.
    vecDb.pragma('journal_mode = WAL');
    // Wait up to 5 seconds when another process holds a write lock
    // instead of failing immediately with SQLITE_BUSY.
    vecDb.pragma('busy_timeout = 5000');

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

/** Returns detailed vector index diagnostics for observability. */
export function getVectorDiagnostics(): {
  dbPath: string;
  dbSizeBytes: number;
  journalMode: string;
  busyTimeout: number;
  embeddingCount: number;
  ftsRowCount: number;
  ftsReady: boolean;
  vectorReady: boolean;
  unembeddedIds: string[];
  syncLockHeld: boolean;
  syncLockPid: number | null;
} {
  const dbPath = vectorDbPath();
  let dbSizeBytes = 0;
  try {
    const stat = fsSync.statSync(dbPath);
    dbSizeBytes = stat.size;
    // Include WAL and SHM files if they exist
    try { dbSizeBytes += fsSync.statSync(dbPath + '-wal').size; } catch { /* no WAL file */ }
    try { dbSizeBytes += fsSync.statSync(dbPath + '-shm').size; } catch { /* no SHM file */ }
  } catch { /* DB file doesn't exist yet */ }

  let journalMode = 'unknown';
  let busyTimeout = 0;
  let embeddingCount = 0;
  let ftsRowCount = 0;

  if (vecDb) {
    try {
      journalMode = (vecDb.pragma('journal_mode') as Array<{ journal_mode: string }>)[0]?.journal_mode ?? 'unknown';
    } catch { /* */ }
    try {
      busyTimeout = (vecDb.pragma('busy_timeout') as Array<{ busy_timeout: number }>)[0]?.busy_timeout ?? 0;
    } catch { /* */ }
    try {
      embeddingCount = (vecDb.prepare('SELECT COUNT(*) as n FROM embeddings').get() as { n: number }).n;
    } catch { /* */ }
    try {
      ftsRowCount = (vecDb.prepare('SELECT COUNT(*) as n FROM fts_memories').get() as { n: number }).n;
    } catch { /* */ }
  }

  // Find unembedded notes
  const index = getIndex();
  const embeddedIds = getEmbeddedIds();
  const unembeddedIds = [...index.keys()].filter((id) => !embeddedIds.has(id));

  // Check sync lock state
  let syncLockHeld = false;
  let syncLockPid: number | null = null;
  const lockPath = syncLockPath();
  try {
    if (fsSync.existsSync(lockPath)) {
      const content = fsSync.readFileSync(lockPath, 'utf-8').trim();
      const [pidStr, tsStr] = content.split(':');
      const lockPidVal = parseInt(pidStr ?? '', 10);
      const lockTime = parseInt(tsStr ?? '', 10);
      const staleMs = 5 * 60 * 1000;
      const isStaleVal = Date.now() - lockTime > staleMs;
      let isAlive = false;
      if (!isNaN(lockPidVal)) {
        try { process.kill(lockPidVal, 0); isAlive = true; } catch { isAlive = false; }
      }
      syncLockHeld = !isStaleVal && isAlive;
      syncLockPid = syncLockHeld ? lockPidVal : null;
    }
  } catch { /* no lock file */ }

  return {
    dbPath,
    dbSizeBytes,
    journalMode,
    busyTimeout,
    embeddingCount,
    ftsRowCount,
    ftsReady: isFtsReady(),
    vectorReady: vecDb !== null,
    unembeddedIds,
    syncLockHeld,
    syncLockPid,
  };
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

/** Lock file path for coordinating sync across multiple instances. */
function syncLockPath(): string {
  return path.join(CONFIG.VAULT_PATH, CONFIG.INDEX_FOLDER, 'sync.lock');
}

/**
 * Try to acquire an exclusive sync lock. Returns true if acquired.
 * Uses a PID-based lock file with stale detection (5 min timeout).
 */
function acquireSyncLock(): boolean {
  const lockPath = syncLockPath();
  try {
    // Check for existing lock
    if (fsSync.existsSync(lockPath)) {
      const content = fsSync.readFileSync(lockPath, 'utf-8').trim();
      const [pidStr, tsStr] = content.split(':');
      const lockPid = parseInt(pidStr ?? '', 10);
      const lockTime = parseInt(tsStr ?? '', 10);

      // Check if lock is stale (> 5 minutes old or owning process is dead)
      const staleMs = 5 * 60 * 1000;
      const isStale = Date.now() - lockTime > staleMs;
      let isAlive = false;
      if (!isNaN(lockPid)) {
        try {
          process.kill(lockPid, 0); // signal 0 = check existence
          isAlive = true;
        } catch {
          isAlive = false;
        }
      }

      if (!isStale && isAlive) {
        return false; // lock held by a live process
      }
      // Stale or dead — remove and claim
    }

    // Write our PID and timestamp atomically via rename
    const tmpPath = lockPath + `.${process.pid}.tmp`;
    fsSync.writeFileSync(tmpPath, `${process.pid}:${Date.now()}`);
    fsSync.renameSync(tmpPath, lockPath);
    return true;
  } catch {
    return false;
  }
}

/** Release the sync lock if we own it. */
function releaseSyncLock(): void {
  const lockPath = syncLockPath();
  try {
    const content = fsSync.readFileSync(lockPath, 'utf-8').trim();
    const [pidStr] = content.split(':');
    if (parseInt(pidStr ?? '', 10) === process.pid) {
      fsSync.unlinkSync(lockPath);
    }
  } catch {
    // Lock already gone or not ours — fine
  }
}

/**
 * Background sync: find vault notes missing embeddings and batch-embed them.
 * Non-blocking — caller does not await. Progress logged to stderr.
 * Uses a lock file so only one instance syncs at a time.
 */
export function syncVectorIndex(): void {
  if (!vecDb) return;

  // Run async in background — don't block server startup
  void (async () => {
    try {
      if (!(await isEmbeddingAvailable())) return;

      if (!acquireSyncLock()) {
        logger.info('Vector sync skipped — another instance is syncing');
        return;
      }

      try {
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

        // Batch upserts in a single transaction for performance and atomicity
        const upsertStmt = vecDb!.prepare(`
          INSERT OR REPLACE INTO embeddings (id, embedding, dims, updated)
          VALUES (?, ?, ?, datetime('now'))
        `);

        let synced = 0;
        const tx = vecDb!.transaction(() => {
          for (let i = 0; i < missing.length; i++) {
            const [id] = missing[i]!;
            const embedding = embeddings[i];
            if (embedding) {
              const buf = Buffer.from(new Float32Array(embedding).buffer);
              upsertStmt.run(id, buf, embedding.length);
              synced++;
            }
          }
        });
        tx();

        logger.info('Vector index sync complete', { synced, failed: missing.length - synced });
      } finally {
        releaseSyncLock();
      }
    } catch (err) {
      logger.warn('Vector index sync failed', { error: String(err) });
      releaseSyncLock();
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
