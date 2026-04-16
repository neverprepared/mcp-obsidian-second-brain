import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleRecall } from '../../src/tools/recall.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';
import { getIndex } from '../../src/vault/search.js';

describe('memory_recall tool', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function storeAndGetId(title: string, content = 'Test content.') {
    await handleStore({ title, content, para: 'resources', tags: ['test'] });
    const index = getIndex();
    return [...index.values()].find((e) => e.frontmatter.title === title)!.frontmatter.id;
  }

  it('recalls memory by ID', async () => {
    const id = await storeAndGetId('Recall By ID');
    const result = await handleRecall({ id });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Recall By ID');
    expect(result.content[0]!.text).toContain(id);
  });

  it('recalls memory by exact title', async () => {
    await storeAndGetId('Exact Title Match');
    const result = await handleRecall({ title: 'Exact Title Match' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Exact Title Match');
  });

  it('recalls memory by partial title', async () => {
    await storeAndGetId('Partial Search Title');
    const result = await handleRecall({ title: 'Partial Search' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Partial Search Title');
  });

  it('returns error for unknown ID', async () => {
    const result = await handleRecall({ id: 'mem_0_nonexistent' });
    expect(result.isError).toBe(true);
  });

  it('returns error for unknown title', async () => {
    const result = await handleRecall({ title: 'Absolutely Not Here' });
    expect(result.isError).toBe(true);
  });

  it('requires either id or title', async () => {
    const result = await handleRecall({});
    expect(result.isError).toBe(true);
  });

  it('includes content in recall response', async () => {
    const id = await storeAndGetId('Content Check', 'Special unique content here.');
    const result = await handleRecall({ id });
    expect(result.content[0]!.text).toContain('Special unique content here.');
  });
});
