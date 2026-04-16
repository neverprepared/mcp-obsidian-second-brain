import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleSearch } from '../../src/tools/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('memory_search tool', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function store(title: string, overrides: Record<string, unknown> = {}) {
    return handleStore({ title, content: 'Generic content.', para: 'resources', tags: ['tag-a'], ...overrides });
  }

  it('finds memory by title query', async () => {
    await store('Findable Title');
    const result = await handleSearch({ query: 'Findable Title' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Findable Title');
  });

  it('finds memory by tag query', async () => {
    await store('Tag Search', { tags: ['unique-tag-xyz'] });
    const result = await handleSearch({ query: 'unique-tag-xyz' });
    expect(result.content[0]!.text).toContain('Tag Search');
  });

  it('finds memory by body content', async () => {
    await store('Body Search', { content: 'special_body_keyword in here' });
    const result = await handleSearch({ query: 'special_body_keyword' });
    expect(result.content[0]!.text).toContain('Body Search');
    expect(result.content[0]!.text).toContain('special_body_keyword');
  });

  it('returns no results message when nothing matches', async () => {
    await store('Unrelated');
    const result = await handleSearch({ query: 'zzz_notexist_zzz' });
    expect(result.content[0]!.text).toContain('No memories found');
  });

  it('AND tag filter (default)', async () => {
    await store('Has Both', { tags: ['alpha', 'beta'] });
    await store('Has One', { tags: ['alpha'] });

    const result = await handleSearch({ tags: ['alpha', 'beta'] });
    expect(result.content[0]!.text).toContain('Has Both');
    expect(result.content[0]!.text).not.toContain('Has One');
  });

  it('OR tag filter', async () => {
    await store('Has Alpha', { tags: ['alpha'] });
    await store('Has Beta', { tags: ['beta'] });
    await store('Has Neither', { tags: ['gamma'] });

    const result = await handleSearch({ tags: ['alpha', 'beta'], tag_mode: 'or' });
    expect(result.content[0]!.text).toContain('Has Alpha');
    expect(result.content[0]!.text).toContain('Has Beta');
    expect(result.content[0]!.text).not.toContain('Has Neither');
  });

  it('created_after date filter', async () => {
    await store('Any Memory');

    const futureFilter = await handleSearch({ created_after: '2099-01-01' });
    expect(futureFilter.content[0]!.text).toContain('No memories found');

    const pastFilter = await handleSearch({ created_after: '2020-01-01' });
    expect(pastFilter.content[0]!.text).toContain('Any Memory');
  });

  it('updated_before date filter', async () => {
    await store('Test Entry');

    const pastCutoff = await handleSearch({ updated_before: '2020-01-01' });
    expect(pastCutoff.content[0]!.text).toContain('No memories found');

    const futureCutoff = await handleSearch({ updated_before: '2099-01-01' });
    expect(futureCutoff.content[0]!.text).toContain('Test Entry');
  });

  it('stale freshness filter', async () => {
    await store('Stale Entry', { ttl_days: 0 });
    await store('Fresh Entry', { ttl_days: 9999 });

    const staleResult = await handleSearch({ freshness: 'stale' });
    expect(staleResult.content[0]!.text).toContain('Stale Entry');
    expect(staleResult.content[0]!.text).not.toContain('Fresh Entry');
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store(`Result ${i}`, { tags: [] });
    }
    const result = await handleSearch({ limit: 2 });
    const count = (result.content[0]!.text.match(/^\d+\. \*\*/gm) || []).length;
    expect(count).toBe(2);
  });
});
