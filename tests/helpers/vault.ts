import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { CONFIG } from '../../src/config.js';
import { buildIndex } from '../../src/vault/search.js';
import { initFts } from '../../src/vault/fts-index.js';

export async function setupTestVault(): Promise<{ tmpDir: string; originalVaultPath: string }> {
  const originalVaultPath = CONFIG.VAULT_PATH;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-test-'));

  // @ts-expect-error - mutating config for test
  CONFIG.VAULT_PATH = tmpDir;

  for (const folder of CONFIG.PARA_FOLDERS) {
    await fs.mkdir(path.join(tmpDir, folder), { recursive: true });
  }
  await fs.mkdir(path.join(tmpDir, CONFIG.DAILY_FOLDER), { recursive: true });

  // Initialize FTS5 so tests run the production search path (not the degraded fallback)
  initFts(new Database(':memory:'));

  await buildIndex();

  return { tmpDir, originalVaultPath };
}

export async function teardownTestVault(tmpDir: string, originalVaultPath: string): Promise<void> {
  // @ts-expect-error - restoring config
  CONFIG.VAULT_PATH = originalVaultPath;
  await fs.rm(tmpDir, { recursive: true, force: true });
}
