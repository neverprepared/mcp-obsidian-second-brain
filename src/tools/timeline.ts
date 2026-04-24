import { formatError } from '../shared/errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TimelineInputSchema } from '../schemas/tools.js';
import { getIndex, type IndexEntry } from '../vault/search.js';
import { isStale } from '../shared/utils.js';
import { logger } from '../shared/logger.js';

export const timelineToolDefinition = {
  name: 'memory_timeline',
  description:
    'Show a chronological timeline of memory activity. Useful for "what did I work on recently?", "what was stored last week?", or reviewing activity in a date range.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      after: { type: 'string', description: 'ISO date — only show activity after this date (e.g. 2025-01-15)' },
      before: { type: 'string', description: 'ISO date — only show activity before this date' },
      activity: {
        type: 'string',
        enum: ['created', 'updated', 'accessed'],
        description: 'Which timestamp to use for ordering (default: updated)',
      },
      para: {
        type: 'string',
        enum: ['projects', 'areas', 'resources', 'archives'],
        description: 'Filter to a specific PARA category',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter to memories with any of these tags',
      },
      group_by: {
        type: 'string',
        enum: ['day', 'week', 'none'],
        description: 'Group results by time period (default: day)',
      },
      limit: { type: 'number', description: 'Max entries to return (default: 30, max: 100)' },
    },
    required: [],
  },
};

interface TimelineEntry {
  id: string;
  title: string;
  para: string;
  timestamp: string;
  tags: string[];
  stale: boolean;
}

export async function handleTimeline(args: unknown): Promise<CallToolResult> {
  try {
    const input = TimelineInputSchema.parse(args);
    const index = getIndex();
    const entries: TimelineEntry[] = [];

    for (const entry of index.values()) {
      const fm = entry.frontmatter;

      // PARA filter
      if (input.para && fm.para !== input.para) continue;

      // Tag filter (OR mode)
      if (input.tags && input.tags.length > 0) {
        const entryTagsLower = fm.tags.map((t) => t.toLowerCase());
        if (!input.tags.some((t) => entryTagsLower.includes(t.toLowerCase()))) continue;
      }

      // Get the relevant timestamp
      const timestamp = getTimestamp(entry, input.activity);
      if (!timestamp) continue;

      // Date range filter
      if (input.after && timestamp < input.after) continue;
      if (input.before && timestamp > input.before) continue;

      entries.push({
        id: fm.id,
        title: fm.title,
        para: fm.para,
        timestamp,
        tags: fm.tags,
        stale: isStale(fm.updated, fm.ttl_days, fm.para),
      });
    }

    // Sort by timestamp descending (most recent first)
    entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const limited = entries.slice(0, input.limit);

    if (limited.length === 0) {
      return {
        content: [{ type: 'text', text: 'No activity found for the given filters.' }],
      };
    }

    let output: string;
    if (input.group_by === 'none') {
      output = formatFlat(limited, input.activity);
    } else {
      output = formatGrouped(limited, input.activity, input.group_by);
    }

    const header = `Timeline (${input.activity}, ${limited.length} of ${entries.length} entries)\n`;
    return {
      content: [{ type: 'text', text: header + output }],
    };
  } catch (error) {
    logger.error('Failed to generate timeline', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error generating timeline: ${formatError(error)}` }],
      isError: true,
    };
  }
}

function getTimestamp(entry: IndexEntry, activity: string): string | undefined {
  const fm = entry.frontmatter;
  switch (activity) {
    case 'created': return fm.created;
    case 'updated': return fm.updated;
    case 'accessed': return fm.last_accessed || fm.updated;
    default: return fm.updated;
  }
}

function formatFlat(entries: TimelineEntry[], _activity: string): string {
  return entries
    .map((e) => {
      const date = e.timestamp.slice(0, 10);
      const time = e.timestamp.slice(11, 16) || '';
      const staleTag = e.stale ? ' [stale]' : '';
      const tags = e.tags.length > 0 ? ` (${e.tags.join(', ')})` : '';
      return `${date} ${time} | ${e.para} | ${e.title}${tags}${staleTag}`;
    })
    .join('\n');
}

function formatGrouped(entries: TimelineEntry[], _activity: string, groupBy: 'day' | 'week'): string {
  const groups = new Map<string, TimelineEntry[]>();

  for (const e of entries) {
    const key = groupBy === 'day'
      ? e.timestamp.slice(0, 10)
      : getWeekKey(e.timestamp);

    const list = groups.get(key) ?? [];
    list.push(e);
    groups.set(key, list);
  }

  const lines: string[] = [];
  for (const [key, items] of groups) {
    lines.push(`\n## ${key}`);
    for (const e of items) {
      const time = e.timestamp.slice(11, 16) || '';
      const staleTag = e.stale ? ' [stale]' : '';
      const tags = e.tags.length > 0 ? ` (${e.tags.join(', ')})` : '';
      lines.push(`- ${time ? time + ' ' : ''}[${e.para}] ${e.title}${tags}${staleTag}`);
    }
  }

  return lines.join('\n');
}

function getWeekKey(isoDate: string): string {
  const d = new Date(isoDate);
  // Get Monday of the week
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return `Week of ${monday.toISOString().slice(0, 10)}`;
}
