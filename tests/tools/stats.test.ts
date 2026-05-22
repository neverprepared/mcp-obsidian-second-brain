import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleStats } from '../../src/tools/stats.js';
import { handleLink } from '../../src/tools/link.js';
import { getIndex } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('memory_stats tool', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function store(title: string, overrides: Record<string, unknown> = {}) {
    return handleStore({ title, content: 'Content.', lifecycle_status: 'reference', tags: [], ...overrides });
  }

  function getId(title: string) {
    return [...getIndex().values()].find((e) => e.frontmatter.title === title)!.frontmatter.id;
  }

  it('returns correct total count', async () => {
    await store('One');
    await store('Two', { lifecycle_status: 'active' });
    await store('Three', { lifecycle_status: 'archive' });

    const result = await handleStats({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Total memories:** 3');
  });

  it('counts by lifecycle status', async () => {
    await store('R1', { lifecycle_status: 'reference' });
    await store('A1', { lifecycle_status: 'active' });
    await store('P1', { lifecycle_status: 'active' });
    await store('P2', { lifecycle_status: 'archive' });

    const text = (await handleStats({})).content[0]!.text;
    expect(text).toContain('Active: 2');
    expect(text).toContain('Reference: 1');
    expect(text).toContain('Archive: 1');
  });

  it('counts stale memories', async () => {
    await store('Stale One', { ttl_days: 0 });
    await store('Fresh One', { ttl_days: 9999 });

    const text = (await handleStats({})).content[0]!.text;
    expect(text).toContain('Stale memories: 1');
  });

  it('detects orphan memories (no links)', async () => {
    await store('Linked A');
    await store('Linked B');
    await store('Orphan');

    const aId = getId('Linked A');
    const bId = getId('Linked B');
    await handleLink({ source_id: aId, target_id: bId });

    const text = (await handleStats({})).content[0]!.text;
    // Orphan should be counted; A and B are linked to each other
    expect(text).toContain('Orphaned memories (no links): 1');
  });

  it('shows top tags', async () => {
    await store('T1', { tags: ['popular', 'rare'] });
    await store('T2', { tags: ['popular'] });
    await store('T3', { tags: ['popular'] });

    const text = (await handleStats({})).content[0]!.text;
    expect(text).toContain('popular (3)');
  });

  it('handles empty vault', async () => {
    const result = await handleStats({});
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('Total memories:** 0');
  });
});
