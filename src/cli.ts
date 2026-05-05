#!/usr/bin/env node
/**
 * Non-MCP entrypoint for the second brain. Same handlers, same vault,
 * argv-driven instead of JSON-RPC. Useful from shell hooks, scripts, and tests.
 *
 * All handler return values are printed as JSON on stdout. Logger output stays
 * on stderr (see src/shared/logger.ts) so stdout is parseable.
 *
 * Exit code: 0 on success, 1 on error (handler isError flag or thrown exception).
 */

import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  initialize,
  shutdown,
  handleStore,
  handleRecall,
  handleSearch,
  handleUpdate,
  handleDelete,
  handleLink,
  handleProject,
  handleStats,
  handleCleanup,
  handleTimeline,
  handleTaskStart,
  handleTaskUpdate,
  handleTaskComplete,
  handleTaskGet,
  logger,
} from './core/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type Handler = (args: unknown) => Promise<CallToolResult>;
type ArgShape = Record<string, unknown>;
type ParsedValues = Record<string, string | boolean | undefined>;
type Builder = (p: ParsedValues) => ArgShape;

interface Command {
  handler: Handler;
  options: ParseArgsConfig['options'];
  build: Builder;
  help: string;
}

// ---- Argv → typed value helpers ----

function str(p: ParsedValues, key: string): string | undefined {
  const v = p[key];
  return typeof v === 'string' ? v : undefined;
}

function flag(p: ParsedValues, key: string): boolean | undefined {
  const v = p[key];
  return typeof v === 'boolean' ? v : undefined;
}

function num(p: ParsedValues, key: string): number | undefined {
  const v = str(p, key);
  return v === undefined ? undefined : Number(v);
}

function csv(p: ParsedValues, key: string): string[] | undefined {
  const v = str(p, key);
  return v === undefined ? undefined : v.split(',').map((s) => s.trim()).filter(Boolean);
}

function json(p: ParsedValues, key: string): unknown {
  const v = str(p, key);
  return v === undefined ? undefined : JSON.parse(v);
}

// Drop undefined keys so handlers see a clean object
function compact(obj: ArgShape): ArgShape {
  const out: ArgShape = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// ---- Command table ----

const commands: Record<string, Command> = {
  store: {
    handler: handleStore,
    help: 'Store a new memory. Required: --title, --content, --para',
    options: {
      title:         { type: 'string' },
      content:       { type: 'string' },
      para:          { type: 'string' },
      tags:          { type: 'string' },
      related:       { type: 'string' },
      confidence:    { type: 'string' },
      source:        { type: 'string' },
      'source-urls': { type: 'string' },
      'ttl-days':    { type: 'string' },
      deadline:      { type: 'string' },
    },
    build: (p) => compact({
      title:       str(p, 'title'),
      content:     str(p, 'content'),
      para:        str(p, 'para'),
      tags:        csv(p, 'tags'),
      related:     csv(p, 'related'),
      confidence:  str(p, 'confidence'),
      source:      str(p, 'source'),
      source_urls: csv(p, 'source-urls'),
      ttl_days:    num(p, 'ttl-days'),
      deadline:    str(p, 'deadline'),
    }),
  },

  recall: {
    handler: handleRecall,
    help: 'Recall a memory by id or title. One of: --id, --title',
    options: {
      id:    { type: 'string' },
      title: { type: 'string' },
    },
    build: (p) => compact({ id: str(p, 'id'), title: str(p, 'title') }),
  },

  search: {
    handler: handleSearch,
    help: 'Search memories. Common: --query, --tags, --para, --freshness, --limit',
    options: {
      query:              { type: 'string' },
      tags:               { type: 'string' },
      'tag-mode':         { type: 'string' },
      'exclude-tags':     { type: 'string' },
      para:               { type: 'string' },
      status:             { type: 'string' },
      freshness:          { type: 'string' },
      'sort-by':          { type: 'string' },
      limit:              { type: 'string' },
      'include-archived': { type: 'boolean' },
      'search-mode':      { type: 'string' },
      'created-after':    { type: 'string' },
      'created-before':   { type: 'string' },
      'updated-after':    { type: 'string' },
      'updated-before':   { type: 'string' },
    },
    build: (p) => compact({
      query:            str(p, 'query'),
      tags:             csv(p, 'tags'),
      tag_mode:         str(p, 'tag-mode'),
      exclude_tags:     csv(p, 'exclude-tags'),
      para:             str(p, 'para'),
      status:           str(p, 'status'),
      freshness:        str(p, 'freshness'),
      sort_by:          str(p, 'sort-by'),
      limit:            num(p, 'limit'),
      include_archived: flag(p, 'include-archived'),
      search_mode:      str(p, 'search-mode'),
      created_after:    str(p, 'created-after'),
      created_before:   str(p, 'created-before'),
      updated_after:    str(p, 'updated-after'),
      updated_before:   str(p, 'updated-before'),
    }),
  },

  update: {
    handler: handleUpdate,
    help: 'Update a memory. Required: --id. Optional: --content, --append, --tags, etc.',
    options: {
      id:            { type: 'string' },
      title:         { type: 'string' },
      content:       { type: 'string' },
      append:        { type: 'boolean' },
      para:          { type: 'string' },
      tags:          { type: 'string' },
      'add-tags':    { type: 'string' },
      related:       { type: 'string' },
      confidence:    { type: 'string' },
      status:        { type: 'string' },
      'source-urls': { type: 'string' },
      'ttl-days':    { type: 'string' },
    },
    build: (p) => compact({
      id:          str(p, 'id'),
      title:       str(p, 'title'),
      content:     str(p, 'content'),
      append:      flag(p, 'append'),
      para:        str(p, 'para'),
      tags:        csv(p, 'tags'),
      add_tags:    csv(p, 'add-tags'),
      related:     csv(p, 'related'),
      confidence:  str(p, 'confidence'),
      status:      str(p, 'status'),
      source_urls: csv(p, 'source-urls'),
      ttl_days:    num(p, 'ttl-days'),
    }),
  },

  delete: {
    handler: handleDelete,
    help: 'Delete a memory. Required: --id, --confirm',
    options: {
      id:      { type: 'string' },
      confirm: { type: 'boolean' },
    },
    build: (p) => compact({
      id:      str(p, 'id'),
      confirm: flag(p, 'confirm'),
    }),
  },

  link: {
    handler: handleLink,
    help: 'Link memories. Required: --source-id. One of: --target-id, --discover',
    options: {
      'source-id': { type: 'string' },
      'target-id': { type: 'string' },
      discover:    { type: 'boolean' },
      depth:       { type: 'string' },
    },
    build: (p) => compact({
      source_id: str(p, 'source-id'),
      target_id: str(p, 'target-id'),
      discover:  flag(p, 'discover'),
      depth:     num(p, 'depth'),
    }),
  },

  project: {
    handler: handleProject,
    help: 'Project ops. Pass --args as a JSON object matching the project tool schema.',
    options: {
      args: { type: 'string' },
    },
    build: (p) => (json(p, 'args') as ArgShape) ?? {},
  },

  stats: {
    handler: handleStats,
    help: 'Vault statistics. No arguments.',
    options: {},
    build: () => ({}),
  },

  cleanup: {
    handler: handleCleanup,
    help: 'Cleanup stale/archived/orphan memories. --action list|archive|delete, --dry-run',
    options: {
      action:    { type: 'string' },
      target:    { type: 'string' },
      'dry-run': { type: 'boolean' },
      limit:     { type: 'string' },
      confirm:   { type: 'boolean' },
    },
    build: (p) => compact({
      action:  str(p, 'action'),
      target:  str(p, 'target'),
      dry_run: flag(p, 'dry-run'),
      limit:   num(p, 'limit'),
      confirm: flag(p, 'confirm'),
    }),
  },

  timeline: {
    handler: handleTimeline,
    help: 'Activity timeline. --after/--before ISO, --activity, --group-by, --limit',
    options: {
      after:      { type: 'string' },
      before:     { type: 'string' },
      activity:   { type: 'string' },
      para:       { type: 'string' },
      tags:       { type: 'string' },
      'group-by': { type: 'string' },
      limit:      { type: 'string' },
    },
    build: (p) => compact({
      after:    str(p, 'after'),
      before:   str(p, 'before'),
      activity: str(p, 'activity'),
      para:     str(p, 'para'),
      tags:     csv(p, 'tags'),
      group_by: str(p, 'group-by'),
      limit:    num(p, 'limit'),
    }),
  },

  'task-start': {
    handler: handleTaskStart,
    help: 'Start a working-memory task. Required: --goal',
    options: {
      goal:        { type: 'string' },
      constraints: { type: 'string' },
      plan:        { type: 'string' },
    },
    build: (p) => compact({
      goal:        str(p, 'goal'),
      constraints: csv(p, 'constraints'),
      plan:        csv(p, 'plan'),
    }),
  },

  'task-update': {
    handler: handleTaskUpdate,
    help: 'Update a task. Required: --task-id. Pass complex fields as --add-finding/--add-artifact/--resolve-question JSON.',
    options: {
      'task-id':          { type: 'string' },
      'current-step':     { type: 'string' },
      'add-finding':      { type: 'string' },
      'add-step':         { type: 'string' },
      'complete-step':    { type: 'string' },
      'fail-step':        { type: 'string' },
      'add-artifact':     { type: 'string' },
      'add-question':     { type: 'string' },
      'resolve-question': { type: 'string' },
    },
    build: (p) => compact({
      task_id:          str(p, 'task-id'),
      current_step:     str(p, 'current-step'),
      add_finding:      json(p, 'add-finding'),
      add_step:         str(p, 'add-step'),
      complete_step:    num(p, 'complete-step'),
      fail_step:        num(p, 'fail-step'),
      add_artifact:     json(p, 'add-artifact'),
      add_question:     str(p, 'add-question'),
      resolve_question: json(p, 'resolve-question'),
    }),
  },

  'task-complete': {
    handler: handleTaskComplete,
    help: 'Complete a task. Required: --task-id. Optional: --final-finding',
    options: {
      'task-id':       { type: 'string' },
      'final-finding': { type: 'string' },
    },
    build: (p) => compact({
      task_id:       str(p, 'task-id'),
      final_finding: str(p, 'final-finding'),
    }),
  },

  'task-get': {
    handler: handleTaskGet,
    help: 'Get a task by id, or list active tasks if no id.',
    options: {
      'task-id': { type: 'string' },
    },
    build: (p) => compact({
      task_id: str(p, 'task-id'),
    }),
  },
};

function printUsage(): void {
  process.stderr.write('Usage: obsidian-mem <command> [options]\n\nCommands:\n');
  for (const [name, cmd] of Object.entries(commands)) {
    process.stderr.write(`  ${name.padEnd(16)} ${cmd.help}\n`);
  }
  process.stderr.write('\nAll output is JSON on stdout. Logs go to stderr.\n');
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [commandName, ...rest] = argv;

  if (!commandName || commandName === '--help' || commandName === '-h') {
    printUsage();
    return commandName ? 0 : 1;
  }

  const command = commands[commandName];
  if (!command) {
    process.stderr.write(`Unknown command: ${commandName}\n\n`);
    printUsage();
    return 1;
  }

  let parsed: ParsedValues;
  try {
    parsed = parseArgs({
      args: rest,
      options: command.options,
      allowPositionals: false,
      strict: true,
    }).values as ParsedValues;
  } catch (err) {
    process.stderr.write(`Argument error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  let args: ArgShape;
  try {
    args = command.build(parsed);
  } catch (err) {
    process.stderr.write(`Failed to build args: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  try {
    await initialize();
    const result = await command.handler(args);
    const first = result.content?.[0];
    const text = first && first.type === 'text' ? first.text : '';
    process.stdout.write(text + (text.endsWith('\n') ? '' : '\n'));
    return result.isError ? 1 : 0;
  } catch (err) {
    logger.error('CLI command failed', {
      command: commandName,
      error: err instanceof Error ? err.message : String(err),
    });
    return 1;
  } finally {
    shutdown();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().then((code) => process.exit(code));
}
