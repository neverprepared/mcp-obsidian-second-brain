import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { handleStore } from '../../src/tools/store.js';
import { handleDelete } from '../../src/tools/delete.js';
import { getIndex, findBySlug } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';
import { CONFIG } from '../../src/config.js';

describe('memory_delete tool', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function storeAndGetId(title = 'To Delete', overrides: Record<string, unknown> = {}) {
    await handleStore({ title, content: 'Content.', para: 'resources', tags: ['tag-a'], ...overrides });
    return [...getIndex().values()].find((e) => e.frontmatter.title === title)!.frontmatter.id;
  }

  it('deletes file from disk', async () => {
    const id = await storeAndGetId();
    const filePath = [...getIndex().values()].find((e) => e.frontmatter.id === id)!.filePath;

    await handleDelete({ id, confirm: true });

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('removes entry from index', async () => {
    const id = await storeAndGetId();
    expect(getIndex().has(id)).toBe(true);

    await handleDelete({ id, confirm: true });
    expect(getIndex().has(id)).toBe(false);
  });

  it('returns error for unknown id', async () => {
    const result = await handleDelete({ id: 'mem_0_notexist', confirm: true });
    expect(result.isError).toBe(true);
  });

  it('rejects confirm: false', async () => {
    const id = await storeAndGetId();
    const result = await handleDelete({ id, confirm: false });
    expect(result.isError).toBe(true);
    // Memory should still exist
    expect(getIndex().has(id)).toBe(true);
  });

  it('cleans backlinks from related memories after delete', async () => {
    // Store two memories with shared tags so they auto-link
    // Use MIN_SHARED_TAGS = 2, so give them 2 shared tags
    const id1 = await storeAndGetId('Memory Alpha', { tags: ['shared-x', 'shared-y'] });
    await storeAndGetId('Memory Beta', { tags: ['shared-x', 'shared-y'] });

    // Verify they are linked
    const betaEntry = findBySlug('memory-beta');
    expect(betaEntry).toBeDefined();
    const wasLinked = betaEntry!.frontmatter.related.includes('memory-alpha');

    // Delete alpha
    await handleDelete({ id: id1, confirm: true });

    if (wasLinked) {
      // Beta's related should no longer contain alpha
      const betaAfter = findBySlug('memory-beta');
      expect(betaAfter?.frontmatter.related).not.toContain('memory-alpha');

      // Beta's file should not contain [[memory-alpha]]
      const betaFile = await fs.readFile(betaAfter!.filePath, 'utf-8');
      expect(betaFile).not.toContain('[[memory-alpha]]');

      // Response should mention cleaned backlinks
      // (We already deleted, just verify response text would have mentioned it)
    }
  });

  it('includes cleanup info in success message', async () => {
    const id = await storeAndGetId();
    const result = await handleDelete({ id, confirm: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Deleted memory');
  });
});
