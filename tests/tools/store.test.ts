import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { handleStore } from '../../src/tools/store.js';
import { buildIndex, getIndex } from '../../src/vault/search.js';
import { CONFIG } from '../../src/config.js';
import { cancelClusterRebuild, waitForClusterRebuild } from '../../src/vault/cluster-index.js';

describe('memory_store tool', () => {
  let originalVaultPath: string;
  let tmpDir: string;

  beforeEach(async () => {
    originalVaultPath = CONFIG.VAULT_PATH;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-test-'));
    // @ts-expect-error - mutating config for test
    CONFIG.VAULT_PATH = tmpDir;

    // Create layer folders
    await fs.mkdir(path.join(tmpDir, CONFIG.MEMORY_FOLDER), { recursive: true });
    await fs.mkdir(path.join(tmpDir, CONFIG.DAILY_FOLDER), { recursive: true });
    await fs.mkdir(path.join(tmpDir, CONFIG.INDEX_FOLDER), { recursive: true });

    await buildIndex();
  });

  afterEach(async () => {
    await waitForClusterRebuild();
    cancelClusterRebuild();
    // @ts-expect-error - restoring config
    CONFIG.VAULT_PATH = originalVaultPath;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw err;
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  });

  it('should store a memory and return success', async () => {
    const result = await handleStore({
      title: 'Test Memory',
      content: 'This is a test.',
      lifecycle_status: 'reference',
      tags: ['test'],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Test Memory');
    expect(result.content[0]!.text).toContain('Memory/');

    // Verify file exists
    const files = await fs.readdir(path.join(tmpDir, 'Memory'));
    expect(files.length).toBe(1);
    expect(files[0]).toBe('test-memory.md');

    // Verify index updated
    const index = getIndex();
    expect(index.size).toBe(1);
  });

  it('should deduplicate slug on collision', async () => {
    await handleStore({
      title: 'Duplicate',
      content: 'First.',
      lifecycle_status: 'reference',
    });
    await handleStore({
      title: 'Duplicate',
      content: 'Second.',
      lifecycle_status: 'reference',
    });

    const files = await fs.readdir(path.join(tmpDir, 'Memory'));
    expect(files.length).toBe(2);
    expect(files.sort()).toEqual(['duplicate-2.md', 'duplicate.md']);
  });

  it('should reject missing required fields', async () => {
    const result = await handleStore({
      title: 'No Content',
      lifecycle_status: 'reference',
    });

    expect(result.isError).toBe(true);
  });

  it('should append to daily note', async () => {
    await handleStore({
      title: 'Daily Test',
      content: 'Content.',
      lifecycle_status: 'active',
      tags: ['daily'],
    });

    const today = new Date().toISOString().split('T')[0]!;
    const dailyPath = path.join(tmpDir, CONFIG.DAILY_FOLDER, `${today}.md`);
    const dailyContent = await fs.readFile(dailyPath, 'utf-8');
    expect(dailyContent).toContain('[[daily-test]]');
  });
});
