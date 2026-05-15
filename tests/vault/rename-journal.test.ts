import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { handleStore } from '../../src/tools/store.js';
import { handleUpdate } from '../../src/tools/update.js';
import { handleLink } from '../../src/tools/link.js';
import { getIndex, findById } from '../../src/vault/search.js';
import { renameSlugReferences } from '../../src/vault/links.js';
import {
  writeRenameJournal,
  readRenameJournal,
  deleteRenameJournal,
} from '../../src/vault/rename-journal.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';
import { CONFIG } from '../../src/config.js';

describe('rename journal', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  function journalPath(): string {
    return path.join(tmpDir, CONFIG.INDEX_FOLDER, 'rename-journal.json');
  }

  async function journalExists(): Promise<boolean> {
    try {
      await fs.access(journalPath());
      return true;
    } catch {
      return false;
    }
  }

  describe('CRUD helpers', () => {
    it('writes, reads, and deletes a journal', async () => {
      expect(await readRenameJournal()).toBeNull();

      await writeRenameJournal('old-x', 'new-x');
      const j = await readRenameJournal();
      expect(j).toMatchObject({ from: 'old-x', to: 'new-x' });
      expect(j!.started).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      await deleteRenameJournal();
      expect(await readRenameJournal()).toBeNull();
    });

    it('returns null on missing journal without error', async () => {
      expect(await readRenameJournal()).toBeNull();
    });

    it('returns null on corrupted journal', async () => {
      await fs.mkdir(path.dirname(journalPath()), { recursive: true });
      await fs.writeFile(journalPath(), 'not json {{{', 'utf-8');
      expect(await readRenameJournal()).toBeNull();
    });

    it('returns null on malformed (missing fields) journal', async () => {
      await fs.mkdir(path.dirname(journalPath()), { recursive: true });
      await fs.writeFile(journalPath(), JSON.stringify({ from: 'x' }), 'utf-8');
      expect(await readRenameJournal()).toBeNull();
    });

    it('delete is a no-op on missing journal', async () => {
      await expect(deleteRenameJournal()).resolves.toBeUndefined();
    });
  });

  describe('end-to-end with update tool', () => {
    async function storeAndGetId(title: string): Promise<string> {
      await handleStore({ title, content: 'Body', para: 'resources', tags: [] });
      return [...getIndex().values()].find((e) => e.frontmatter.title === title)!.frontmatter.id;
    }

    it('clears the journal after a successful rename', async () => {
      const id = await storeAndGetId('Original Title');
      await handleUpdate({ id, title: 'New Title' });
      expect(await journalExists()).toBe(false);
    });

    it('recovery is idempotent: re-running rename on already-updated files is a no-op', async () => {
      const idA = await storeAndGetId('Source');
      const idB = await storeAndGetId('Target');
      await handleLink({ source_id: idA, target_id: idB });
      await handleUpdate({ id: idA, title: 'Source Renamed' });

      const bBefore = findById(idB)!;
      const bFileBefore = await fs.readFile(bBefore.filePath, 'utf-8');
      expect(bFileBefore).toContain('[[source-renamed]]');

      // Simulate recovery: re-run with the same args. Should be a no-op.
      const result = await renameSlugReferences('source', 'source-renamed');
      const bFileAfter = await fs.readFile(bBefore.filePath, 'utf-8');
      expect(bFileAfter).toBe(bFileBefore);
      expect(result.updated).not.toContain('target');
    });

    it('resumes a rename when a journal exists from a prior crash', async () => {
      // Set up a vault with a backlink that wasn't yet updated.
      const idA = await storeAndGetId('Crashy Source');
      const idB = await storeAndGetId('Receiver');
      await handleLink({ source_id: idA, target_id: idB });

      // Simulate the crash scenario: source memory file has been moved
      // (slug-renamed in place via direct file rewrite), but the backlink
      // rewrite never ran. Mimic this by manually moving A's file and
      // editing its frontmatter to the new slug, then leaving B untouched.
      const oldFilePath = findById(idA)!.filePath;
      const newSlug = 'rescued-source';
      const newFilePath = path.join(path.dirname(oldFilePath), `${newSlug}.md`);
      let aContent = await fs.readFile(oldFilePath, 'utf-8');
      aContent = aContent.replace(/title: ".*?"/, `title: "Rescued Source"`);
      await fs.writeFile(newFilePath, aContent, 'utf-8');
      await fs.unlink(oldFilePath);

      // Manually write the journal that should trigger recovery.
      await writeRenameJournal('crashy-source', newSlug);
      expect(await journalExists()).toBe(true);

      // B should still reference the OLD slug at this point.
      const bBeforeRecovery = await fs.readFile(findById(idB)!.filePath, 'utf-8');
      expect(bBeforeRecovery).toContain('[[crashy-source]]');

      // Simulate startup recovery via the public surface.
      const recoveryResult = await renameSlugReferences('crashy-source', newSlug);
      await deleteRenameJournal();

      expect(recoveryResult.updated).toContain('receiver');
      const bAfterRecovery = await fs.readFile(findById(idB)!.filePath, 'utf-8');
      expect(bAfterRecovery).toContain('[[rescued-source]]');
      expect(bAfterRecovery).not.toContain('[[crashy-source]]');
      expect(await journalExists()).toBe(false);
    });
  });
});
