import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initWorkingDb } from '../../src/working/db.js';
import { handleTaskStart, handleTaskUpdate, handleTaskComplete, handleTaskGet } from '../../src/tools/task.js';
import { buildIndex } from '../../src/vault/search.js';
import { CONFIG } from '../../src/config.js';

let tmpDir: string;
let originalVaultPath: string;

beforeEach(async () => {
  initWorkingDb();

  originalVaultPath = CONFIG.VAULT_PATH;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-tools-test-'));
  // @ts-expect-error - mutating config for test
  CONFIG.VAULT_PATH = tmpDir;

  for (const folder of CONFIG.PARA_FOLDERS) {
    await fs.mkdir(path.join(tmpDir, folder), { recursive: true });
  }
  await fs.mkdir(path.join(tmpDir, CONFIG.DAILY_FOLDER), { recursive: true });
  await buildIndex();
});

afterEach(async () => {
  // @ts-expect-error - restoring config
  CONFIG.VAULT_PATH = originalVaultPath;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('task_start', () => {
  it('creates a task and returns task_id', async () => {
    const result = await handleTaskStart({ goal: 'Deploy the new service' });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text as string;
    expect(text).toContain('Task started: task_');
    expect(text).toContain('Deploy the new service');
  });

  it('records constraints and plan', async () => {
    const result = await handleTaskStart({
      goal: 'Refactor auth module',
      constraints: ['no breaking changes'],
      plan: ['read existing code', 'write tests', 'refactor'],
    });
    const text = result.content[0]!.text as string;
    expect(text).toContain('Constraints: no breaking changes');
    expect(text).toContain('Plan: 3 steps');
  });

  it('requires goal', async () => {
    const result = await handleTaskStart({});
    expect(result.isError).toBe(true);
  });

  it('seeds from vault if relevant memories exist', async () => {
    // Pre-populate vault with a relevant note
    const { handleStore } = await import('../../src/tools/store.js');
    await handleStore({
      title: 'Deployment checklist',
      content: 'Run migrations before deploying',
      para: 'resources',
      tags: ['deploy', 'checklist'],
    });

    const result = await handleTaskStart({ goal: 'deploy the application' });
    const text = result.content[0]!.text as string;
    // Should have found the deployment note
    expect(text).toContain('Seeded');
  });
});

describe('task_update', () => {
  it('updates current_step', async () => {
    const start = await handleTaskStart({ goal: 'Test task' });
    const task_id = extractTaskId(start.content[0]!.text as string);

    const result = await handleTaskUpdate({ task_id, current_step: 'Running analysis' });
    expect(result.content[0]!.text).toContain('Current step: Running analysis');
  });

  it('adds a finding', async () => {
    const start = await handleTaskStart({ goal: 'Test task' });
    const task_id = extractTaskId(start.content[0]!.text as string);

    const result = await handleTaskUpdate({
      task_id,
      add_finding: { content: 'Found a bug in auth', importance: 'high', memory_type: 'episodic' },
    });
    expect(result.content[0]!.text).toContain('Finding recorded (high, episodic)');
  });

  it('adds and completes a step', async () => {
    const start = await handleTaskStart({ goal: 'Test task' });
    const task_id = extractTaskId(start.content[0]!.text as string);

    const addResult = await handleTaskUpdate({ task_id, add_step: 'Run migrations' });
    const stepIdMatch = (addResult.content[0]!.text as string).match(/Step #(\d+) added/);
    expect(stepIdMatch).not.toBeNull();

    const stepId = Number(stepIdMatch![1]);
    const completeResult = await handleTaskUpdate({ task_id, complete_step: stepId });
    expect(completeResult.content[0]!.text).toContain(`Step #${stepId} completed`);
  });

  it('adds an artifact', async () => {
    const start = await handleTaskStart({ goal: 'Test task' });
    const task_id = extractTaskId(start.content[0]!.text as string);

    const result = await handleTaskUpdate({
      task_id,
      add_artifact: { name: 'output', reference: 'dist/bundle.js' },
    });
    expect(result.content[0]!.text).toContain('Artifact');
    expect(result.content[0]!.text).toContain('output');
  });

  it('adds and resolves a question', async () => {
    const start = await handleTaskStart({ goal: 'Test task' });
    const task_id = extractTaskId(start.content[0]!.text as string);

    const qResult = await handleTaskUpdate({ task_id, add_question: 'Why is it slow?' });
    const qIdMatch = (qResult.content[0]!.text as string).match(/Question #(\d+)/);
    const qId = Number(qIdMatch![1]);

    const resolveResult = await handleTaskUpdate({
      task_id,
      resolve_question: { id: qId, resolution: 'Missing DB index' },
    });
    expect(resolveResult.content[0]!.text).toContain(`Question #${qId} resolved`);
  });

  it('returns error for unknown task_id', async () => {
    const result = await handleTaskUpdate({ task_id: 'task_bad_id' });
    expect(result.isError).toBe(true);
  });
});

describe('task_complete', () => {
  it('completes a task and reports promotion counts', async () => {
    const start = await handleTaskStart({ goal: 'Finish feature X' });
    const task_id = extractTaskId(start.content[0]!.text as string);

    await handleTaskUpdate({
      task_id,
      add_finding: { content: 'Feature X requires a new DB table', importance: 'high', memory_type: 'semantic' },
    });

    const result = await handleTaskComplete({ task_id });
    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text as string;
    expect(text).toContain('completed');
    expect(text).toContain('Promoted to Obsidian');
    expect(text).toContain('Working memory cleared');
  });

  it('promotes a final_finding before completing', async () => {
    const start = await handleTaskStart({ goal: 'Deploy v2' });
    const task_id = extractTaskId(start.content[0]!.text as string);

    const result = await handleTaskComplete({
      task_id,
      final_finding: 'Deployment succeeded with zero downtime',
    });
    const text = result.content[0]!.text as string;
    expect(text).toContain('Promoted to Obsidian');
  });

  it('clears task from working memory after completion', async () => {
    const start = await handleTaskStart({ goal: 'Short task' });
    const task_id = extractTaskId(start.content[0]!.text as string);
    await handleTaskComplete({ task_id });

    const getResult = await handleTaskGet({ task_id });
    expect(getResult.isError).toBe(true);
  });

  it('returns error for unknown task_id', async () => {
    const result = await handleTaskComplete({ task_id: 'task_unknown' });
    expect(result.isError).toBe(true);
  });
});

describe('task_get', () => {
  it('returns task state', async () => {
    const start = await handleTaskStart({ goal: 'Inspect me' });
    const task_id = extractTaskId(start.content[0]!.text as string);

    await handleTaskUpdate({
      task_id,
      add_finding: { content: 'Some insight', importance: 'medium', memory_type: 'episodic' },
    });

    const result = await handleTaskGet({ task_id });
    const text = result.content[0]!.text as string;
    expect(text).toContain('Inspect me');
    expect(text).toContain('Findings: 1');
  });

  it('lists active tasks when no task_id given', async () => {
    await handleTaskStart({ goal: 'Task Alpha' });
    await handleTaskStart({ goal: 'Task Beta' });

    const result = await handleTaskGet({});
    const text = result.content[0]!.text as string;
    expect(text).toContain('Active tasks');
    expect(text).toContain('Task Alpha');
    expect(text).toContain('Task Beta');
  });

  it('returns "No active tasks" when none exist', async () => {
    const result = await handleTaskGet({});
    expect(result.content[0]!.text).toContain('No active tasks');
  });

  it('returns error for unknown task_id', async () => {
    const result = await handleTaskGet({ task_id: 'task_nope' });
    expect(result.isError).toBe(true);
  });
});

// Helper: extract task_id from task_start response text
function extractTaskId(text: string): string {
  const match = text.match(/Task started: (task_[^\n]+)/);
  if (!match) throw new Error(`Could not extract task_id from: ${text}`);
  return match[1]!.trim();
}
