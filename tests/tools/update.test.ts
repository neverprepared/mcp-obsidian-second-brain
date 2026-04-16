import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { handleStore } from '../../src/tools/store.js';
import { handleUpdate } from '../../src/tools/update.js';
import { getIndex, findBySlug } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';
import { CONFIG } from '../../src/config.js';

describe('memory_update tool', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function storeAndGetId(title = 'Update Test', overrides: Record<string, unknown> = {}) {
    await handleStore({ title, content: 'Original content.', para: 'resources', tags: ['original'], ...overrides });
    return [...getIndex().values()].find((e) => e.frontmatter.title === title)!.frontmatter.id;
  }

  it('updates content (replace mode)', async () => {
    const id = await storeAndGetId();
    const result = await handleUpdate({ id, content: 'New content.' });
    expect(result.isError).toBeUndefined();

    const entry = [...getIndex().values()].find((e) => e.frontmatter.id === id)!;
    expect(entry.body).toContain('New content.');
  });

  it('updates content (append mode)', async () => {
    const id = await storeAndGetId();
    await handleUpdate({ id, content: 'Appended.', append: true });

    const entry = [...getIndex().values()].find((e) => e.frontmatter.id === id)!;
    expect(entry.body).toContain('Original content.');
    expect(entry.body).toContain('Appended.');
  });

  it('replaces tags', async () => {
    const id = await storeAndGetId();
    await handleUpdate({ id, tags: ['new-tag'] });

    const entry = [...getIndex().values()].find((e) => e.frontmatter.id === id)!;
    expect(entry.frontmatter.tags).toEqual(['new-tag']);
  });

  it('merges add_tags with existing tags', async () => {
    const id = await storeAndGetId();
    await handleUpdate({ id, add_tags: ['extra'] });

    const entry = [...getIndex().values()].find((e) => e.frontmatter.id === id)!;
    expect(entry.frontmatter.tags).toContain('original');
    expect(entry.frontmatter.tags).toContain('extra');
  });

  it('moves file when para changes', async () => {
    const id = await storeAndGetId();
    await handleUpdate({ id, para: 'areas' });

    const entry = [...getIndex().values()].find((e) => e.frontmatter.id === id)!;
    expect(entry.frontmatter.para).toBe('areas');
    expect(entry.filePath).toContain('Areas');

    // Old file should be gone
    const resourcesFiles = await fs.readdir(path.join(tmpDir, 'Resources'));
    expect(resourcesFiles.length).toBe(0);
  });

  it('renames file when title changes', async () => {
    const id = await storeAndGetId('Original Title');
    await handleUpdate({ id, title: 'Renamed Title' });

    expect(findBySlug('renamed-title')).toBeDefined();
    expect(findBySlug('original-title')).toBeUndefined();
  });

  it('sets status to archived', async () => {
    const id = await storeAndGetId();
    await handleUpdate({ id, status: 'archived' });

    const entry = [...getIndex().values()].find((e) => e.frontmatter.id === id)!;
    expect(entry.frontmatter.status).toBe('archived');
  });

  it('returns error for unknown id', async () => {
    const result = await handleUpdate({ id: 'mem_0_notexist', content: 'x' });
    expect(result.isError).toBe(true);
  });
});
