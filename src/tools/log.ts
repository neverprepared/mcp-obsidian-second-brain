import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { formatError } from '../shared/errors.js';
import { CONFIG } from '../config.js';

const logDir = () => path.join(CONFIG.VAULT_PATH, CONFIG.LOG_FOLDER);

const LogReadInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format'),
});

const LogListInputSchema = z.object({
  limit: z.number().min(1).max(90).default(30),
});

export const logReadToolDefinition = {
  name: 'log_read',
  description: 'Read the provenance log for a specific date (YYYY-MM-DD). Shows all vault mutations that day.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
    },
    required: ['date'],
  },
};

export async function handleLogRead(args: unknown): Promise<CallToolResult> {
  try {
    const { date } = LogReadInputSchema.parse(args);
    const logPath = path.join(logDir(), `${date}.md`);
    const content = await fs.readFile(logPath, 'utf-8');
    return { content: [{ type: 'text', text: content }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `No log found: ${formatError(error)}` }], isError: true };
  }
}

export const logListToolDefinition = {
  name: 'log_list',
  description: 'List available provenance log dates, most recent first.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      limit: { type: 'number', description: 'Max dates to return (default 30)' },
    },
  },
};

export async function handleLogList(args: unknown): Promise<CallToolResult> {
  try {
    const { limit } = LogListInputSchema.parse(args);
    let files: string[] = [];
    try {
      const all = await fs.readdir(logDir());
      files = all.filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse().slice(0, limit);
    } catch { /* log dir doesn't exist yet */ }
    const dates = files.map((f) => f.replace('.md', ''));
    return { content: [{ type: 'text', text: JSON.stringify({ dates }) }] };
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${formatError(error)}` }], isError: true };
  }
}
