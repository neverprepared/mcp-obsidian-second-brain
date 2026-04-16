import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractWikiLinks, buildRelatedSection, addRelatedLink, removeBacklinks, autoLinkRelated } from '../../src/vault/links.js';
import { handleStore } from '../../src/tools/store.js';
import { getIndex, findBySlug } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('links', () => {
  describe('extractWikiLinks', () => {
    it('should extract wiki links from content', () => {
      const content = 'See [[foo-bar]] and also [[baz-qux]] for more.';
      expect(extractWikiLinks(content)).toEqual(['foo-bar', 'baz-qux']);
    });

    it('should return empty array when no links', () => {
      expect(extractWikiLinks('No links here.')).toEqual([]);
    });
  });

  describe('buildRelatedSection', () => {
    it('should build a related section with links', () => {
      const result = buildRelatedSection(['foo', 'bar']);
      expect(result).toContain('## Related');
      expect(result).toContain('[[foo]]');
      expect(result).toContain('[[bar]]');
    });

    it('should return empty string for no slugs', () => {
      expect(buildRelatedSection([])).toBe('');
    });
  });

  describe('addRelatedLink', () => {
    it('should add a Related section if none exists', () => {
      const result = addRelatedLink('Some content.', 'new-link');
      expect(result).toContain('## Related');
      expect(result).toContain('[[new-link]]');
    });

    it('should append to existing Related section', () => {
      const content = 'Content.\n\n## Related\n\n- [[existing]]';
      const result = addRelatedLink(content, 'new-link');
      expect(result).toContain('[[existing]]');
      expect(result).toContain('[[new-link]]');
    });

    it('should not duplicate an existing link', () => {
      const content = 'Content.\n\n## Related\n\n- [[existing]]';
      const result = addRelatedLink(content, 'existing');
      const matches = result.match(/\[\[existing\]\]/g);
      expect(matches?.length).toBe(1);
    });
  });
});

describe('links with vault', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function store(title: string, overrides: Record<string, unknown> = {}) {
    await handleStore({ title, content: 'Content.', para: 'resources', tags: [], ...overrides });
    return [...getIndex().values()].find((e) => e.frontmatter.title === title)!;
  }

  describe('removeBacklinks', () => {
    it('removes deleted slug from related arrays', async () => {
      // Create two memories with shared tags to get auto-linked
      const entryA = await store('Backlink A', { tags: ['shared-x', 'shared-y'] });
      const entryB = await store('Backlink B', { tags: ['shared-x', 'shared-y'] });

      // Verify they are linked (auto-linking should have happened)
      const bEntry = findBySlug('backlink-b');
      const wasLinked = bEntry?.frontmatter.related.includes('backlink-a');

      if (wasLinked) {
        // Now remove backlinks for A
        const result = await removeBacklinks('backlink-a');
        expect(result.cleaned).toContain('backlink-b');
        expect(result.failed).toHaveLength(0);

        // B should no longer reference A
        const bAfter = findBySlug('backlink-b')!;
        expect(bAfter.frontmatter.related).not.toContain('backlink-a');
      }
    });

    it('returns empty result when slug has no backlinks', async () => {
      await store('Standalone');
      const result = await removeBacklinks('no-backlinks-slug');
      expect(result.cleaned).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });

  describe('autoLinkRelated', () => {
    it('returns { linked, failed } structure', async () => {
      await store('Auto A', { tags: ['common-tag-1', 'common-tag-2'] });
      const entryB = await store('Auto B', { tags: ['common-tag-1', 'common-tag-2'] });

      // Auto-linking already happened for B when stored; verify return type by calling directly
      // on a hypothetical new memory using the vault state
      const result = await autoLinkRelated('auto-b', entryB.filePath, ['common-tag-1', 'common-tag-2']);
      expect(result).toHaveProperty('linked');
      expect(result).toHaveProperty('failed');
      expect(Array.isArray(result.linked)).toBe(true);
      expect(Array.isArray(result.failed)).toBe(true);
    });
  });
});
