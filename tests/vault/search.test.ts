import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import {
  buildIndex,
  findById,
  findBySlug,
  removeFromIndex,
  searchMemories,
  getIndex,
} from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('vault/search', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function storeMemory(overrides: Record<string, unknown> = {}) {
    return handleStore({
      title: 'Test Memory',
      content: 'Some test content here.',
      para: 'resources',
      tags: ['test', 'sample'],
      ...overrides,
    });
  }

  describe('slug reverse index', () => {
    it('findBySlug returns correct entry after store', async () => {
      await storeMemory({ title: 'Slug Test' });
      const entry = findBySlug('slug-test');
      expect(entry).toBeDefined();
      expect(entry!.frontmatter.title).toBe('Slug Test');
    });

    it('findBySlug returns undefined for unknown slug', () => {
      expect(findBySlug('does-not-exist')).toBeUndefined();
    });

    it('removeFromIndex cleans up slug index', async () => {
      await storeMemory({ title: 'Remove Test' });
      const entry = findBySlug('remove-test');
      expect(entry).toBeDefined();
      removeFromIndex(entry!.frontmatter.id);
      expect(findBySlug('remove-test')).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('returns correct entry by ID', async () => {
      await storeMemory({ title: 'By ID' });
      const index = getIndex();
      const [id, entry] = [...index.entries()][0]!;
      expect(findById(id)).toBe(entry);
    });

    it('returns undefined for unknown ID', () => {
      expect(findById('mem_999_unknown')).toBeUndefined();
    });
  });

  describe('searchMemories', () => {
    it('scores title match +10', async () => {
      await storeMemory({ title: 'UniqueTitle Foo' });
      await storeMemory({ title: 'Other Memory', content: 'UniqueTitle in body', tags: ['other'] });

      const results = await searchMemories({ query: 'UniqueTitle', limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      // Title match should be highest scored
      expect(results[0]!.entry.frontmatter.title).toBe('UniqueTitle Foo');
      expect(results[0]!.score).toBeGreaterThanOrEqual(10);
    });

    it('scores tag match +5', async () => {
      await storeMemory({ title: 'Tag Memory', tags: ['specialtag'] });

      const results = await searchMemories({ query: 'specialtag', limit: 10 });
      expect(results.length).toBeGreaterThan(0);
      const tagResult = results.find((r) => r.entry.frontmatter.title === 'Tag Memory');
      expect(tagResult).toBeDefined();
      expect(tagResult!.score).toBeGreaterThanOrEqual(5);
    });

    it('scores content match +1', async () => {
      await storeMemory({ title: 'Content Mem', content: 'unique_body_term here', tags: [] });

      const results = await searchMemories({ query: 'unique_body_term', limit: 10 });
      const match = results.find((r) => r.entry.frontmatter.title === 'Content Mem');
      expect(match).toBeDefined();
      expect(match!.score).toBeGreaterThanOrEqual(1);
      expect(match!.snippet).toContain('unique_body_term');
    });

    it('returns all with score 1 when no query', async () => {
      await storeMemory({ title: 'A' });
      await storeMemory({ title: 'B', tags: ['other'] });

      const results = await searchMemories({ limit: 10 });
      expect(results.length).toBe(2);
      expect(results.every((r) => r.score === 1)).toBe(true);
    });

    it('AND tag filter excludes non-matching', async () => {
      await storeMemory({ title: 'Both', tags: ['alpha', 'beta'] });
      await storeMemory({ title: 'Only Alpha', tags: ['alpha'] });

      const results = await searchMemories({ tags: ['alpha', 'beta'], tag_mode: 'and', limit: 10 });
      expect(results.length).toBe(1);
      expect(results[0]!.entry.frontmatter.title).toBe('Both');
    });

    it('OR tag filter includes any-match', async () => {
      await storeMemory({ title: 'Alpha Only', tags: ['alpha'] });
      await storeMemory({ title: 'Beta Only', tags: ['beta'] });
      await storeMemory({ title: 'Neither', tags: ['gamma'] });

      const results = await searchMemories({ tags: ['alpha', 'beta'], tag_mode: 'or', limit: 10 });
      const titles = results.map((r) => r.entry.frontmatter.title);
      expect(titles).toContain('Alpha Only');
      expect(titles).toContain('Beta Only');
      expect(titles).not.toContain('Neither');
    });

    it('freshness stale filter', async () => {
      // Store with very short TTL so it's immediately stale
      await storeMemory({ title: 'Stale Memory', ttl_days: 0 });
      await storeMemory({ title: 'Fresh Memory', ttl_days: 9999 });

      const staleResults = await searchMemories({ freshness: 'stale', limit: 10 });
      const staleTitles = staleResults.map((r) => r.entry.frontmatter.title);
      expect(staleTitles).toContain('Stale Memory');
      expect(staleTitles).not.toContain('Fresh Memory');
    });

    it('para filter restricts results', async () => {
      await storeMemory({ title: 'In Resources', para: 'resources' });
      await storeMemory({ title: 'In Areas', para: 'areas', tags: [] });

      const results = await searchMemories({ para: 'resources', limit: 10 });
      expect(results.every((r) => r.entry.frontmatter.para === 'resources')).toBe(true);
    });

    it('created_after filter', async () => {
      await storeMemory({ title: 'Recent' });

      // Filter with past date should include it
      const results = await searchMemories({ created_after: '2020-01-01', limit: 10 });
      expect(results.length).toBeGreaterThan(0);

      // Filter with future date should exclude it
      const noResults = await searchMemories({ created_after: '2099-01-01', limit: 10 });
      expect(noResults.length).toBe(0);
    });

    it('updated_before filter', async () => {
      await storeMemory({ title: 'Test Entry' });

      // Should be excluded by future updated_before cutoff that is in the past
      const noResults = await searchMemories({ updated_before: '2020-01-01', limit: 10 });
      expect(noResults.length).toBe(0);

      // Should be included by future updated_before cutoff
      const results = await searchMemories({ updated_before: '2099-01-01', limit: 10 });
      expect(results.length).toBeGreaterThan(0);
    });

    it('results sorted by score descending', async () => {
      await storeMemory({ title: 'MatchWord Title', content: 'no match here', tags: [] });
      await storeMemory({ title: 'Other', content: 'MatchWord in body only', tags: [] });

      const results = await searchMemories({ query: 'MatchWord', limit: 10 });
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    });

    it('limit is respected', async () => {
      for (let i = 0; i < 5; i++) {
        await storeMemory({ title: `Memory ${i}`, tags: [] });
      }
      const results = await searchMemories({ limit: 2 });
      expect(results.length).toBe(2);
    });
  });

  describe('buildIndex', () => {
    it('rebuilds index from disk', async () => {
      await storeMemory({ title: 'Persist Me' });
      expect(getIndex().size).toBe(1);

      await buildIndex();
      expect(getIndex().size).toBe(1);
      expect(findBySlug('persist-me')).toBeDefined();
    });
  });
});
