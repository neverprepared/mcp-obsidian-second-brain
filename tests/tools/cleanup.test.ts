import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleCleanup } from '../../src/tools/cleanup.js';
import { getIndex } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('memory_cleanup tool', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  async function store(title: string, overrides: Record<string, unknown> = {}) {
    return handleStore({ title, content: 'Content.', para: 'resources', tags: [], ...overrides });
  }

  it('dry_run: true lists candidates without acting (default)', async () => {
    await store('Stale One', { ttl_days: 0 });
    const sizeBefore = getIndex().size;

    const result = await handleCleanup({ action: 'archive', target: 'stale', dry_run: true });
    expect(result.content[0]!.text).toContain('DRY RUN');
    expect(getIndex().size).toBe(sizeBefore); // No change
  });

  it('action: list shows candidates', async () => {
    await store('Stale Memory', { ttl_days: 0 });

    const result = await handleCleanup({ action: 'list', target: 'stale' });
    expect(result.content[0]!.text).toContain('Stale Memory');
    expect(result.content[0]!.text).not.toContain('DRY RUN');
  });

  it('archives stale memories when dry_run: false', async () => {
    await store('Will Be Archived', { ttl_days: 0 });
    await store('Fresh', { ttl_days: 9999 });

    const result = await handleCleanup({ action: 'archive', target: 'stale', dry_run: false });
    expect(result.content[0]!.text).toContain('1 archived');

    const archived = [...getIndex().values()].find((e) => e.frontmatter.title === 'Will Be Archived')!;
    expect(archived.frontmatter.status).toBe('archived');
  });

  it('deletes stale memories when dry_run: false and confirm: true', async () => {
    await store('To Delete', { ttl_days: 0 });
    const sizeBefore = getIndex().size;

    const result = await handleCleanup({ action: 'delete', target: 'stale', dry_run: false, confirm: true });
    expect(result.content[0]!.text).toContain('1 deleted');
    expect(getIndex().size).toBe(sizeBefore - 1);
  });

  it('rejects delete without confirm: true', async () => {
    await store('Safe', { ttl_days: 0 });
    const result = await handleCleanup({ action: 'delete', target: 'stale', dry_run: false, confirm: false });
    expect(result.isError).toBe(true);
  });

  it('targets archived memories', async () => {
    await store('Active');
    await store('Archived One');
    const archivedId = [...getIndex().values()].find((e) => e.frontmatter.title === 'Archived One')!.frontmatter.id;
    // Manually update status
    await (await import('../../src/tools/update.js')).handleUpdate({ id: archivedId, status: 'archived' });

    const result = await handleCleanup({ action: 'list', target: 'archived' });
    expect(result.content[0]!.text).toContain('Archived One');
    expect(result.content[0]!.text).not.toContain('Active');
  });

  it('targets orphan memories (no links)', async () => {
    await store('Orphan');
    await store('Not Orphan A', { tags: ['shared-a', 'shared-b'] });
    await store('Not Orphan B', { tags: ['shared-a', 'shared-b'] }); // auto-linked to A

    const result = await handleCleanup({ action: 'list', target: 'orphan' });
    expect(result.content[0]!.text).toContain('Orphan');
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store(`Stale ${i}`, { ttl_days: 0 });
    }

    const result = await handleCleanup({ action: 'list', target: 'stale', limit: 2 });
    const count = (result.content[0]!.text.match(/^- \*\*/gm) || []).length;
    expect(count).toBe(2);
  });

  it('returns message when no candidates found', async () => {
    await store('Fresh Memory', { ttl_days: 9999 });
    const result = await handleCleanup({ action: 'list', target: 'stale' });
    expect(result.content[0]!.text).toContain('No stale memories found');
  });
});
