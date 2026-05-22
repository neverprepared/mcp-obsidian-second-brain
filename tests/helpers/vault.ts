import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { CONFIG } from '../../src/config.js';
import { buildIndex } from '../../src/vault/search.js';
import { initFts } from '../../src/vault/fts-index.js';
import { cancelClusterRebuild, waitForClusterRebuild } from '../../src/vault/cluster-index.js';

export async function setupTestVault(): Promise<{ tmpDir: string; originalVaultPath: string }> {
  const originalVaultPath = CONFIG.VAULT_PATH;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-test-'));

  // @ts-expect-error - mutating config for test
  CONFIG.VAULT_PATH = tmpDir;

  // Create new layer folders instead of PARA folders
  await fs.mkdir(path.join(tmpDir, CONFIG.MEMORY_FOLDER), { recursive: true });
  await fs.mkdir(path.join(tmpDir, CONFIG.INPUT_FOLDER), { recursive: true });
  await fs.mkdir(path.join(tmpDir, CONFIG.WIKI_FOLDER), { recursive: true });
  await fs.mkdir(path.join(tmpDir, CONFIG.OUTPUT_FOLDER), { recursive: true });
  await fs.mkdir(path.join(tmpDir, CONFIG.DAILY_FOLDER), { recursive: true });
  await fs.mkdir(path.join(tmpDir, CONFIG.INDEX_FOLDER), { recursive: true });

  // Initialize FTS5 so tests run the production search path (not the degraded fallback)
  initFts(new Database(':memory:'));

  await buildIndex();

  return { tmpDir, originalVaultPath };
}

export async function teardownTestVault(tmpDir: string, originalVaultPath: string): Promise<void> {
  // Wait for any in-flight cluster rebuilds to complete, then cancel the debounce timer
  await waitForClusterRebuild();
  cancelClusterRebuild();
  // @ts-expect-error - restoring config
  CONFIG.VAULT_PATH = originalVaultPath;
  // Retry rm to handle fire-and-forget async writes (last_accessed, embeddings) that may
  // still be in-flight. ENOTEMPTY means a concurrent write created a file after we started.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  // Last attempt — let it throw if it still fails
  await fs.rm(tmpDir, { recursive: true, force: true });
}
