import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleArchive } from '../../src/tools/archive.js';
import { handleList } from '../../src/tools/list.js';
import { getIndex } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('memory_archive tool', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function storeAndGetId(title = 'Archive Me') {
    await handleStore({ title, content: 'Content.', para: 'resources', tags: [] });
    return [...getIndex().values()].find((e) => e.frontmatter.title === title)!.frontmatter.id;
  }

  it('sets status to archived', async () => {
    const id = await storeAndGetId();
    const result = await handleArchive({ id });
    expect(result.isError).toBeUndefined();

    const entry = [...getIndex().values()].find((e) => e.frontmatter.id === id)!;
    expect(entry.frontmatter.status).toBe('archived');
  });

  it('returns error for unknown id', async () => {
    const result = await handleArchive({ id: 'mem_0_notexist' });
    expect(result.isError).toBe(true);
  });

  it('archived memory excluded from default list', async () => {
    const id = await storeAndGetId('Will Be Archived');
    await handleArchive({ id });

    const result = await handleList({});
    expect(result.content[0]!.text).not.toContain('Will Be Archived');
  });
});
