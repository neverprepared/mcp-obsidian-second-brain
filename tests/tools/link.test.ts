import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleLink } from '../../src/tools/link.js';
import { getIndex, findBySlug } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('memory_link tool', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function store(title: string) {
    await handleStore({ title, content: 'Content.', para: 'resources', tags: [] });
    return [...getIndex().values()].find((e) => e.frontmatter.title === title)!.frontmatter.id;
  }

  it('creates bidirectional link between two memories', async () => {
    const idA = await store('Link A');
    const idB = await store('Link B');

    const result = await handleLink({ source_id: idA, target_id: idB });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('link-a');
    expect(result.content[0]!.text).toContain('link-b');

    // Both should have the other in their related array
    const entryA = findBySlug('link-a')!;
    const entryB = findBySlug('link-b')!;
    expect(entryA.frontmatter.related).toContain('link-b');
    expect(entryB.frontmatter.related).toContain('link-a');
  });

  it('discover mode returns link graph', async () => {
    const idA = await store('Discover A');
    const idB = await store('Discover B');
    await handleLink({ source_id: idA, target_id: idB });

    const result = await handleLink({ source_id: idA, discover: true });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('discover-b');
  });

  it('returns error for unknown source_id', async () => {
    await store('Target');
    const result = await handleLink({ source_id: 'mem_0_notexist', target_id: 'whatever' });
    expect(result.isError).toBe(true);
  });

  it('returns error for unknown target_id', async () => {
    const idA = await store('Source A');
    const result = await handleLink({ source_id: idA, target_id: 'mem_0_notexist' });
    expect(result.isError).toBe(true);
  });

  it('does not duplicate link if already linked', async () => {
    const idA = await store('Dedup A');
    const idB = await store('Dedup B');

    await handleLink({ source_id: idA, target_id: idB });
    await handleLink({ source_id: idA, target_id: idB }); // second time

    const entryA = findBySlug('dedup-a')!;
    const relatedToBCount = entryA.frontmatter.related.filter((s) => s === 'dedup-b').length;
    expect(relatedToBCount).toBe(1);
  });
});
