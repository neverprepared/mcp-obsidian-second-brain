import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleProject } from '../../src/tools/project.js';
import { getIndex } from '../../src/vault/search.js';
import { setupTestVault, teardownTestVault } from '../helpers/vault.js';

describe('memory_project tool', () => {
  let tmpDir: string;
  let originalVaultPath: string;

  beforeEach(async () => {
    ({ tmpDir, originalVaultPath } = await setupTestVault());
  });

  afterEach(async () => {
    await teardownTestVault(tmpDir, originalVaultPath);
  });

  function getProjectId(title: string) {
    return [...getIndex().values()].find((e) => e.frontmatter.title === title)!.frontmatter.id;
  }

  it('creates a project in the projects PARA', async () => {
    const result = await handleProject({
      action: 'create',
      title: 'My Project',
      deadline: '2099-12-31',
    });

    expect(result.isError).toBeUndefined();

    const entry = [...getIndex().values()].find((e) => e.frontmatter.title === 'My Project');
    expect(entry).toBeDefined();
    expect(entry!.frontmatter.para).toBe('projects');
    expect(entry!.frontmatter.tags).toContain('project');
  });

  it('creates project with deadline in frontmatter', async () => {
    await handleProject({
      action: 'create',
      title: 'Deadline Project',
      deadline: '2099-06-30',
    });

    const entry = [...getIndex().values()].find((e) => e.frontmatter.title === 'Deadline Project')!;
    // TTL should be set (calculated from deadline)
    expect(entry.frontmatter.ttl_days).toBeGreaterThan(0);
  });

  it('requires title for create', async () => {
    const result = await handleProject({ action: 'create', deadline: '2099-01-01' });
    expect(result.isError).toBe(true);
  });

  it('requires deadline for create', async () => {
    const result = await handleProject({ action: 'create', title: 'No Deadline' });
    expect(result.isError).toBe(true);
  });

  it('completes a project (archives it)', async () => {
    await handleProject({ action: 'create', title: 'Complete Me', deadline: '2099-01-01' });
    const id = getProjectId('Complete Me');

    const result = await handleProject({ action: 'complete', id });
    expect(result.isError).toBeUndefined();

    const entry = [...getIndex().values()].find((e) => e.frontmatter.id === id)!;
    expect(entry.frontmatter.status).toBe('archived');
  });

  it('requires id for complete', async () => {
    const result = await handleProject({ action: 'complete' });
    expect(result.isError).toBe(true);
  });

  it('lists active projects only', async () => {
    await handleProject({ action: 'create', title: 'Active Project', deadline: '2099-01-01' });
    await handleProject({ action: 'create', title: 'Completed Project', deadline: '2099-02-01' });

    const completedId = getProjectId('Completed Project');
    await handleProject({ action: 'complete', id: completedId });

    const result = await handleProject({ action: 'list' });
    expect(result.content[0]!.text).toContain('Active Project');
    expect(result.content[0]!.text).not.toContain('Completed Project');
  });

  it('returns "no active projects" when all completed', async () => {
    await handleProject({ action: 'create', title: 'Only Project', deadline: '2099-01-01' });
    const id = getProjectId('Only Project');
    await handleProject({ action: 'complete', id });

    const result = await handleProject({ action: 'list' });
    expect(result.content[0]!.text).toBe('No active projects.');
  });

  it('marks overdue projects in list', async () => {
    await handleProject({ action: 'create', title: 'Overdue Project', deadline: '2020-01-01' });

    const result = await handleProject({ action: 'list' });
    expect(result.content[0]!.text).toContain('OVERDUE');
  });
});
