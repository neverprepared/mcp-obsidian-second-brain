import { formatError } from '../shared/errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getIndex } from '../vault/search.js';
import { handleStore } from './store.js';
import { handleUpdate } from './update.js';
import { logger } from '../shared/logger.js';
import { isStale } from '../shared/utils.js';

const ProjectInputSchema = z.object({
  action: z.enum(['create', 'complete', 'list']),
  title: z.string().min(1).max(200).optional(),
  deadline: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).default([]),
  id: z.string().optional(),
});

export const projectToolDefinition = {
  name: 'memory_project',
  description:
    'Manage projects in the second brain. Create projects with deadlines, complete them (archives in place), or list active projects.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'complete', 'list'],
        description: 'Action to perform',
      },
      title: {
        type: 'string',
        description: 'Project title (required for create)',
      },
      deadline: {
        type: 'string',
        description: 'Project deadline as YYYY-MM-DD (required for create)',
      },
      content: {
        type: 'string',
        description: 'Project description, goals, and context',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for categorization and linking to related research',
      },
      id: {
        type: 'string',
        description: 'Project memory ID (required for complete)',
      },
    },
    required: ['action'],
  },
};

async function createProject(input: z.infer<typeof ProjectInputSchema>): Promise<CallToolResult> {
  if (!input.title) {
    return {
      content: [{ type: 'text', text: 'Error: title is required for create' }],
      isError: true,
    };
  }
  if (!input.deadline) {
    return {
      content: [{ type: 'text', text: 'Error: deadline is required for create (YYYY-MM-DD)' }],
      isError: true,
    };
  }

  // Build project content with structure
  const projectContent = [
    input.content || '',
    '',
    '## Goals',
    '',
    '- [ ] Define goals',
    '',
    '## Status',
    '',
    `- **Deadline:** ${input.deadline}`,
    '- **Status:** Active',
  ].join('\n');

  // Calculate TTL from deadline (project expires when deadline passes)
  const deadlineMs = new Date(input.deadline).getTime();
  const nowMs = Date.now();
  const ttlDays = Math.max(7, Math.ceil((deadlineMs - nowMs) / 86_400_000) + 30); // deadline + 30 day buffer

  return handleStore({
    title: input.title,
    content: projectContent,
    para: 'projects',
    tags: ['project', ...input.tags],
    confidence: 'high',
    source: 'conversation',
    ttl_days: ttlDays,
    deadline: input.deadline,
  });
}

async function completeProject(input: z.infer<typeof ProjectInputSchema>): Promise<CallToolResult> {
  if (!input.id) {
    return {
      content: [{ type: 'text', text: 'Error: id is required for complete' }],
      isError: true,
    };
  }

  // Archive in place — don't move the file
  return handleUpdate({
    id: input.id,
    status: 'archived',
    content: `\n\n---\n**Completed:** ${new Date().toISOString().split('T')[0]}`,
    append: true,
  });
}

async function listProjects(): Promise<CallToolResult> {
  const index = getIndex();
  const projects = Array.from(index.values())
    .filter((e) => e.frontmatter.para === 'projects' && e.frontmatter.status !== 'archived');

  if (projects.length === 0) {
    return {
      content: [{ type: 'text', text: 'No active projects.' }],
    };
  }

  // Sort by deadline (earliest first), missing deadlines last
  projects.sort((a, b) => {
    const da = a.frontmatter.deadline || '9999';
    const db = b.frontmatter.deadline || '9999';
    return da.localeCompare(db);
  });

  const today = new Date().toISOString().split('T')[0]!;
  const lines = projects.map((e) => {
    const fm = e.frontmatter;
    const deadline = fm.deadline || 'no deadline';
    const overdue = fm.deadline && fm.deadline < today ? ' ⚠ OVERDUE' : '';
    const stale = isStale(fm.updated, fm.ttl_days, fm.para) ? ' [STALE]' : '';
    return `- **${fm.title}**${overdue}${stale}\n  Deadline: ${deadline} | Tags: ${fm.tags.join(', ') || 'none'}\n  ID: ${fm.id}`;
  });

  return {
    content: [
      {
        type: 'text',
        text: `${projects.length} active project${projects.length === 1 ? '' : 's'}:\n\n${lines.join('\n\n')}`,
      },
    ],
  };
}

export async function handleProject(args: unknown): Promise<CallToolResult> {
  try {
    const input = ProjectInputSchema.parse(args);

    switch (input.action) {
      case 'create':
        return createProject(input);
      case 'complete':
        return completeProject(input);
      case 'list':
        return listProjects();
      default:
        return {
          content: [{ type: 'text', text: `Unknown action: ${input.action}` }],
          isError: true,
        };
    }
  } catch (error) {
    logger.error('Failed project operation', { error: String(error) });
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${formatError(error)}`,
        },
      ],
      isError: true,
    };
  }
}
