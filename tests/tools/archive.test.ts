import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleUpdate } from '../../src/tools/update.js';
import { handleSearch } from '../../src/tools/search.js';
import { getIndex } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('archive via memory_update', () => {
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

  it('sets status to archived via update', async () => {
    const id = await storeAndGetId();
    const result = await handleUpdate({ id, status: 'archived' });
    expect(result.isError).toBeUndefined();

    const entry = [...getIndex().values()].find((e) => e.frontmatter.id === id)!;
    expect(entry.frontmatter.status).toBe('archived');
  });

  it('returns error for unknown id', async () => {
    const result = await handleUpdate({ id: 'mem_0_notexist', status: 'archived' });
    expect(result.isError).toBe(true);
  });

  it('archived memory excluded from default search', async () => {
    const id = await storeAndGetId('Will Be Archived');
    await handleUpdate({ id, status: 'archived' });

    const result = await handleSearch({});
    expect(result.content[0]!.text).not.toContain('Will Be Archived');
  });
});
