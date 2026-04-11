import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { handleStore } from '../../src/tools/store.js';
import { buildIndex, getIndex } from '../../src/vault/search.js';
import { CONFIG } from '../../src/config.js';

describe('memory_store tool', () => {
  let originalVaultPath: string;
  let tmpDir: string;

  beforeEach(async () => {
    originalVaultPath = CONFIG.VAULT_PATH;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-test-'));
    // @ts-expect-error - mutating config for test
    CONFIG.VAULT_PATH = tmpDir;

    // Create PARA folders
    for (const folder of CONFIG.PARA_FOLDERS) {
      await fs.mkdir(path.join(tmpDir, folder), { recursive: true });
    }
    await fs.mkdir(path.join(tmpDir, CONFIG.DAILY_FOLDER), { recursive: true });

    await buildIndex();
  });

  afterEach(async () => {
    // @ts-expect-error - restoring config
    CONFIG.VAULT_PATH = originalVaultPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should store a memory and return success', async () => {
    const result = await handleStore({
      title: 'Test Memory',
      content: 'This is a test.',
      para: 'resources',
      tags: ['test'],
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Test Memory');
    expect(result.content[0]!.text).toContain('Resources/');

    // Verify file exists
    const files = await fs.readdir(path.join(tmpDir, 'Resources'));
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
      para: 'resources',
    });
    await handleStore({
      title: 'Duplicate',
      content: 'Second.',
      para: 'resources',
    });

    const files = await fs.readdir(path.join(tmpDir, 'Resources'));
    expect(files.length).toBe(2);
    expect(files.sort()).toEqual(['duplicate-2.md', 'duplicate.md']);
  });

  it('should reject missing required fields', async () => {
    const result = await handleStore({
      title: 'No Content',
      para: 'resources',
    });

    expect(result.isError).toBe(true);
  });

  it('should append to daily note', async () => {
    await handleStore({
      title: 'Daily Test',
      content: 'Content.',
      para: 'areas',
      tags: ['daily'],
    });

    const today = new Date().toISOString().split('T')[0]!;
    const dailyPath = path.join(tmpDir, CONFIG.DAILY_FOLDER, `${today}.md`);
    const dailyContent = await fs.readFile(dailyPath, 'utf-8');
    expect(dailyContent).toContain('[[daily-test]]');
  });
});
