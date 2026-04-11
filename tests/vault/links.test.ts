import { describe, it, expect } from 'vitest';
import { extractWikiLinks, buildRelatedSection, addRelatedLink } from '../../src/vault/links.js';

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
