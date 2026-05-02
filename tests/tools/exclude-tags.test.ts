import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleSearch } from '../../src/tools/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('exclude_tags filter', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function store(title: string, tags: string[]) {
    return handleStore({ title, content: `Content about ${title}`, para: 'resources', tags });
  }

  describe('memory_search with query', () => {
    it('excludes memories with specified tags', async () => {
      await store('Keep me', ['python', 'tutorial']);
      await store('Exclude me', ['python', 'draft']);

      const result = await handleSearch({ query: 'python', exclude_tags: ['draft'] });
      const text = result.content[0]!.text;
      expect(text).toContain('Keep me');
      expect(text).not.toContain('Exclude me');
    });

    it('excludes memories matching any excluded tag', async () => {
      await store('A', ['python']);
      await store('B', ['draft']);
      await store('C', ['archived-import']);

      const result = await handleSearch({ query: 'Content', exclude_tags: ['draft', 'archived-import'] });
      const text = result.content[0]!.text;
      expect(text).toContain('A');
      expect(text).not.toContain('"B"');
      expect(text).not.toContain('"C"');
    });

    it('works with include and exclude tags together', async () => {
      await store('Python tutorial', ['python', 'tutorial']);
      await store('Python draft', ['python', 'draft']);
      await store('Rust tutorial', ['rust', 'tutorial']);

      const result = await handleSearch({ query: 'tutorial', tags: ['python'], tag_mode: 'or', exclude_tags: ['draft'] });
      const text = result.content[0]!.text;
      expect(text).toContain('Python tutorial');
      expect(text).not.toContain('Python draft');
    });
  });

  describe('memory_search listing mode (no query)', () => {
    it('excludes memories with specified tags', async () => {
      await store('Visible', ['important']);
      await store('Hidden', ['noise']);

      const result = await handleSearch({ exclude_tags: ['noise'] });
      const text = result.content[0]!.text;
      expect(text).toContain('Visible');
      expect(text).not.toContain('Hidden');
    });
  });
});
