import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleSearch } from '../../src/tools/search.js';
import { handleUpdate } from '../../src/tools/update.js';
import { getIndex } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('memory_search listing mode (no query)', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function store(title: string, overrides: Record<string, unknown> = {}) {
    return handleStore({ title, content: 'Content.', para: 'resources', tags: ['tag-a'], ...overrides });
  }

  it('lists all non-archived memories by default', async () => {
    await store('Alpha');
    await store('Beta', { para: 'areas', tags: [] });

    const result = await handleSearch({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Alpha');
    expect(result.content[0]!.text).toContain('Beta');
  });

  it('excludes archived memories by default', async () => {
    await store('Active One');
    await store('To Archive');
    const archivedId = [...getIndex().values()].find((e) => e.frontmatter.title === 'To Archive')!.frontmatter.id;
    await handleUpdate({ id: archivedId, status: 'archived' });

    const result = await handleSearch({});
    expect(result.content[0]!.text).toContain('Active One');
    expect(result.content[0]!.text).not.toContain('To Archive');
  });

  it('includes archived when include_archived: true', async () => {
    await store('Active');
    await store('Archived One');
    const id = [...getIndex().values()].find((e) => e.frontmatter.title === 'Archived One')!.frontmatter.id;
    await handleUpdate({ id, status: 'archived' });

    const result = await handleSearch({ include_archived: true });
    expect(result.content[0]!.text).toContain('Archived One');
  });

  it('filters by para', async () => {
    await store('In Resources', { para: 'resources' });
    await store('In Areas', { para: 'areas', tags: [] });

    const result = await handleSearch({ para: 'resources' });
    expect(result.content[0]!.text).toContain('In Resources');
    expect(result.content[0]!.text).not.toContain('In Areas');
  });

  it('filters by status', async () => {
    await store('Active Memory');
    const id = [...getIndex().values()].find((e) => e.frontmatter.title === 'Active Memory')!.frontmatter.id;
    await handleUpdate({ id, status: 'stale' });

    const activeResult = await handleSearch({ status: 'active' });
    expect(activeResult.content[0]!.text).not.toContain('Active Memory');

    const staleResult = await handleSearch({ status: 'stale' });
    expect(staleResult.content[0]!.text).toContain('Active Memory');
  });

  it('filters by tags AND mode (default)', async () => {
    await store('Both Tags', { tags: ['alpha', 'beta'] });
    await store('Only Alpha', { tags: ['alpha'] });

    const result = await handleSearch({ tags: ['alpha', 'beta'] });
    expect(result.content[0]!.text).toContain('Both Tags');
    expect(result.content[0]!.text).not.toContain('Only Alpha');
  });

  it('filters by tags OR mode', async () => {
    await store('Has Alpha', { tags: ['alpha'] });
    await store('Has Beta', { tags: ['beta'] });
    await store('Has Neither', { tags: ['gamma'] });

    const result = await handleSearch({ tags: ['alpha', 'beta'], tag_mode: 'or' });
    expect(result.content[0]!.text).toContain('Has Alpha');
    expect(result.content[0]!.text).toContain('Has Beta');
    expect(result.content[0]!.text).not.toContain('Has Neither');
  });

  it('applies date filters', async () => {
    await store('Old Memory');

    const pastResult = await handleSearch({ updated_before: '2020-01-01' });
    expect(pastResult.content[0]!.text).toBe('No memories found matching your criteria.');
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store(`Memory ${i}`, { tags: [] });
    }
    const result = await handleSearch({ limit: 2 });
    // Count result entries (numbered list: "1. **...", "2. **...")
    const matches = result.content[0]!.text.match(/^\d+\. \*\*/gm) || [];
    expect(matches.length).toBe(2);
  });

  it('returns no-results message when empty', async () => {
    const result = await handleSearch({ para: 'projects' });
    expect(result.content[0]!.text).toBe('No memories found matching your criteria.');
  });
});
