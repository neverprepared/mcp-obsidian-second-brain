import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { main } from '../../src/cli.js';
import { CONFIG } from '../../src/config.js';

/**
 * CLI integration tests.
 *
 * These exercise the same code paths the MCP server uses, just driven by argv
 * instead of JSON-RPC. The handlers are byte-identical — these tests confirm
 * the CLI plumbing (parseArgs → builder → handler → stdout) is wired correctly.
 */

describe('cli', () => {
  let originalVaultPath: string;
  let tmpDir: string;
  let stdoutCapture: string[];
  let stderrCapture: string[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalVaultPath = CONFIG.VAULT_PATH;
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-test-'));
    // @ts-expect-error - mutating config for test
    CONFIG.VAULT_PATH = tmpDir;

    for (const folder of CONFIG.PARA_FOLDERS) {
      await fs.mkdir(path.join(tmpDir, folder), { recursive: true });
    }
    await fs.mkdir(path.join(tmpDir, CONFIG.DAILY_FOLDER), { recursive: true });
    await fs.mkdir(path.join(tmpDir, CONFIG.INDEX_FOLDER), { recursive: true });

    stdoutCapture = [];
    stderrCapture = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutCapture.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrCapture.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    });
  });

  afterEach(async () => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    // @ts-expect-error - restoring config
    CONFIG.VAULT_PATH = originalVaultPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const stdout = (): string => stdoutCapture.join('');
  const stderr = (): string => stderrCapture.join('');

  it('prints usage and exits 1 with no command', async () => {
    const code = await main([]);
    expect(code).toBe(1);
    expect(stderr()).toContain('Usage: obsidian-mem');
    expect(stderr()).toContain('store');
    expect(stderr()).toContain('task-start');
  });

  it('prints usage and exits 0 with --help', async () => {
    const code = await main(['--help']);
    expect(code).toBe(0);
    expect(stderr()).toContain('Usage: obsidian-mem');
  });

  it('rejects unknown commands with exit 1', async () => {
    const code = await main(['nope']);
    expect(code).toBe(1);
    expect(stderr()).toContain('Unknown command: nope');
  });

  it('rejects unknown flags with exit 1', async () => {
    const code = await main(['stats', '--bogus', 'value']);
    expect(code).toBe(1);
    expect(stderr()).toContain('Argument error');
  });

  it('store → search round-trip', async () => {
    const storeCode = await main([
      'store',
      '--title', 'CLI Round Trip',
      '--content', 'A memory created via the CLI.',
      '--para', 'resources',
      '--tags', 'cli,roundtrip',
    ]);
    expect(storeCode).toBe(0);
    expect(stdout()).toContain('CLI Round Trip');
    expect(stdout()).toContain('Resources/');

    // File written
    const files = await fs.readdir(path.join(tmpDir, 'Resources'));
    expect(files).toContain('cli-round-trip.md');

    // Reset capture for next call
    stdoutCapture.length = 0;

    const searchCode = await main(['search', '--query', 'roundtrip', '--limit', '5']);
    expect(searchCode).toBe(0);
    expect(stdout()).toContain('CLI Round Trip');
  });

  it('task-start returns a task_id and seeds findings', async () => {
    const code = await main(['task-start', '--goal', 'Test the CLI task lifecycle']);
    expect(code).toBe(0);
    expect(stdout()).toMatch(/Task started: task_\d+_/);
    expect(stdout()).toContain('Test the CLI task lifecycle');
  });

  it('task lifecycle: start → update → complete', async () => {
    // Start
    let code = await main(['task-start', '--goal', 'Lifecycle test']);
    expect(code).toBe(0);
    const startMatch = stdout().match(/task_\d+_[a-z0-9-]+/);
    expect(startMatch).not.toBeNull();
    const taskId = startMatch![0];

    stdoutCapture.length = 0;

    // Update with a finding
    code = await main([
      'task-update',
      '--task-id', taskId,
      '--add-finding', JSON.stringify({
        content: 'Verified the round trip works',
        importance: 'high',
        memory_type: 'episodic',
      }),
    ]);
    expect(code).toBe(0);

    stdoutCapture.length = 0;

    // Complete
    code = await main(['task-complete', '--task-id', taskId]);
    expect(code).toBe(0);
    expect(stdout()).toContain('completed');
  });

  it('stats command runs against an empty vault', async () => {
    const code = await main(['stats']);
    expect(code).toBe(0);
    expect(stdout()).toContain('Total memories');
  });

  it('reports build errors for malformed --add-finding JSON', async () => {
    const code = await main(['task-update', '--task-id', 'fake', '--add-finding', '{not valid}']);
    expect(code).toBe(1);
    expect(stderr()).toContain('Failed to build args');
  });
});
