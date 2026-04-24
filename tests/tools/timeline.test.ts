import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleStore } from '../../src/tools/store.js';
import { handleTimeline } from '../../src/tools/timeline.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('memory_timeline tool', () => {
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

  it('returns empty message when no memories exist', async () => {
    const result = await handleTimeline({});
    expect(result.content[0]!.text).toContain('No activity found');
  });

  it('lists stored memories ordered by updated time', async () => {
    await store('First memory');
    await store('Second memory');
    await store('Third memory');

    const result = await handleTimeline({});
    const text = result.content[0]!.text;
    expect(text).toContain('First memory');
    expect(text).toContain('Second memory');
    expect(text).toContain('Third memory');
    expect(text).toContain('3 of 3 entries');
  });

  it('filters by PARA category', async () => {
    await store('Resource item', { para: 'resources' });
    await store('Project item', { para: 'projects' });

    const result = await handleTimeline({ para: 'projects' });
    const text = result.content[0]!.text;
    expect(text).toContain('Project item');
    expect(text).not.toContain('Resource item');
  });

  it('filters by tags', async () => {
    await store('Tagged one', { tags: ['python'] });
    await store('Tagged two', { tags: ['rust'] });

    const result = await handleTimeline({ tags: ['python'] });
    const text = result.content[0]!.text;
    expect(text).toContain('Tagged one');
    expect(text).not.toContain('Tagged two');
  });

  it('respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      await store(`Memory ${i}`);
    }

    const result = await handleTimeline({ limit: 3 });
    const text = result.content[0]!.text;
    expect(text).toContain('3 of 10 entries');
  });

  it('supports group_by none', async () => {
    await store('Flat item');

    const result = await handleTimeline({ group_by: 'none' });
    const text = result.content[0]!.text;
    // Flat format uses pipe separators
    expect(text).toContain('|');
    expect(text).toContain('Flat item');
  });

  it('supports group_by day (default)', async () => {
    await store('Day item');

    const result = await handleTimeline({});
    const text = result.content[0]!.text;
    // Day format uses ## headers
    expect(text).toContain('##');
    expect(text).toContain('Day item');
  });

  it('supports group_by week', async () => {
    await store('Week item');

    const result = await handleTimeline({ group_by: 'week' });
    const text = result.content[0]!.text;
    expect(text).toContain('Week of');
    expect(text).toContain('Week item');
  });

  it('filters by date range (after)', async () => {
    await store('Old memory');

    // Use a date far in the future to exclude everything
    const result = await handleTimeline({ after: '2099-01-01' });
    expect(result.content[0]!.text).toContain('No activity found');
  });

  it('filters by date range (before)', async () => {
    await store('Recent memory');

    // Use a date far in the past to exclude everything
    const result = await handleTimeline({ before: '2000-01-01' });
    expect(result.content[0]!.text).toContain('No activity found');
  });

  it('shows stale indicator', async () => {
    await store('Stale memory', { ttl_days: 0 });

    const result = await handleTimeline({ group_by: 'none' });
    const text = result.content[0]!.text;
    expect(text).toContain('[stale]');
  });

  it('shows tags in output', async () => {
    await store('Tagged memory', { tags: ['important', 'review'] });

    const result = await handleTimeline({ group_by: 'none' });
    const text = result.content[0]!.text;
    expect(text).toContain('important');
    expect(text).toContain('review');
  });

  it('supports activity type created', async () => {
    await store('Created item');

    const result = await handleTimeline({ activity: 'created' });
    const text = result.content[0]!.text;
    expect(text).toContain('created');
    expect(text).toContain('Created item');
  });
});
