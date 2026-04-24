import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleLink } from '../../src/tools/link.js';
import { getIndex } from '../../src/vault/search.js';
import { traverseGraph } from '../../src/vault/links.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('graph traversal (BFS)', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function store(title: string) {
    return handleStore({ title, content: 'Content.', para: 'resources', tags: [] });
  }

  function getId(title: string) {
    return [...getIndex().values()].find((e) => e.frontmatter.title === title)!.frontmatter.id;
  }

  function getSlug(title: string) {
    return [...getIndex().values()].find((e) => e.frontmatter.title === title)!.slug;
  }

  it('returns empty for unlinked memory', async () => {
    await store('Lonely');
    const result = traverseGraph(getSlug('Lonely'), 2);
    expect(result).toHaveLength(0);
  });

  it('finds direct neighbors (depth 1)', async () => {
    await store('A');
    await store('B');
    await store('C');

    await handleLink({ source_id: getId('A'), target_id: getId('B') });

    const result = traverseGraph(getSlug('A'), 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe(getSlug('B'));
    expect(result[0]!.depth).toBe(1);
  });

  it('traverses 2 hops: A->B->C', async () => {
    await store('A');
    await store('B');
    await store('C');

    await handleLink({ source_id: getId('A'), target_id: getId('B') });
    await handleLink({ source_id: getId('B'), target_id: getId('C') });

    const result = traverseGraph(getSlug('A'), 2);
    expect(result).toHaveLength(2);

    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain(getSlug('B'));
    expect(slugs).toContain(getSlug('C'));

    const cNode = result.find((r) => r.slug === getSlug('C'))!;
    expect(cNode.depth).toBe(2);
  });

  it('respects maxDepth limit', async () => {
    await store('A');
    await store('B');
    await store('C');

    await handleLink({ source_id: getId('A'), target_id: getId('B') });
    await handleLink({ source_id: getId('B'), target_id: getId('C') });

    // Only 1 hop — should not include C
    const result = traverseGraph(getSlug('A'), 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe(getSlug('B'));
  });

  it('does not include start node in results', async () => {
    await store('Start');
    await store('Neighbor');

    await handleLink({ source_id: getId('Start'), target_id: getId('Neighbor') });

    const result = traverseGraph(getSlug('Start'), 2);
    const slugs = result.map((r) => r.slug);
    expect(slugs).not.toContain(getSlug('Start'));
  });

  it('handles cycles without infinite loop', async () => {
    await store('X');
    await store('Y');
    await store('Z');

    await handleLink({ source_id: getId('X'), target_id: getId('Y') });
    await handleLink({ source_id: getId('Y'), target_id: getId('Z') });
    await handleLink({ source_id: getId('Z'), target_id: getId('X') });

    const result = traverseGraph(getSlug('X'), 5);
    // Should find Y and Z but not revisit X
    expect(result).toHaveLength(2);
    const slugs = result.map((r) => r.slug);
    expect(slugs).toContain(getSlug('Y'));
    expect(slugs).toContain(getSlug('Z'));
  });

  it('works via link tool with depth parameter', async () => {
    await store('Root');
    await store('Child');
    await store('Grandchild');

    await handleLink({ source_id: getId('Root'), target_id: getId('Child') });
    await handleLink({ source_id: getId('Child'), target_id: getId('Grandchild') });

    const result = await handleLink({ source_id: getId('Root'), discover: true, depth: 2 });
    const text = result.content[0]!.text;
    expect(text).toContain('Depth 1');
    expect(text).toContain('Depth 2');
    expect(text).toContain('Child');
    expect(text).toContain('Grandchild');
  });
});
