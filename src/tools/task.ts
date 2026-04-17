import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  generateTaskId,
  createTask,
  getTask,
  getTaskState,
  updateTaskMeta,
  deleteTask,
  addStep,
  updateStep,
  addFinding,
  addArtifact,
  addQuestion,
  resolveQuestion,
  listActiveTasks,
  type Importance,
  type MemoryType,
  type StepStatus,
} from '../working/db.js';
import { seedTaskFromVault } from '../working/retrieval.js';
import { promoteTaskToVault } from '../working/promotion.js';
import { logger } from '../shared/logger.js';

// --- Tool definitions ---

export const taskStartToolDefinition = {
  name: 'task_start',
  description:
    'Start a new working-memory task. Creates an in-memory SQLite record, automatically searches Obsidian for relevant context, and seeds findings from long-term memory. Returns a task_id to use with task_update and task_complete.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      goal: { type: 'string', description: 'What this task is trying to accomplish' },
      constraints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional constraints or guardrails for the task',
      },
      plan: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional initial plan steps',
      },
    },
    required: ['goal'],
  },
};

export const taskUpdateToolDefinition = {
  name: 'task_update',
  description:
    'Update working-memory task state. Append findings, add/complete steps, record artifacts, or track open questions.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string', description: 'Task ID returned by task_start' },
      current_step: { type: 'string', description: 'Description of what is happening right now' },
      add_finding: {
        type: 'object',
        description: 'A new finding to record',
        properties: {
          content: { type: 'string' },
          importance: { type: 'string', enum: ['low', 'medium', 'high'] },
          memory_type: { type: 'string', enum: ['semantic', 'episodic', 'procedural'] },
        },
        required: ['content'],
      },
      add_step: { type: 'string', description: 'Add a new pending step' },
      complete_step: { type: 'number', description: 'Mark a step ID as completed' },
      fail_step: { type: 'number', description: 'Mark a step ID as failed' },
      add_artifact: {
        type: 'object',
        description: 'Record a file, URL, or vault reference produced by this task',
        properties: {
          name: { type: 'string' },
          reference: { type: 'string' },
        },
        required: ['name', 'reference'],
      },
      add_question: { type: 'string', description: 'Record an open question' },
      resolve_question: {
        type: 'object',
        description: 'Mark a question as resolved',
        properties: {
          id: { type: 'number' },
          resolution: { type: 'string' },
        },
        required: ['id', 'resolution'],
      },
    },
    required: ['task_id'],
  },
};

export const taskCompleteToolDefinition = {
  name: 'task_complete',
  description:
    'Mark a task as complete. Automatically promotes medium/high-importance findings to Obsidian (creating new notes or appending to existing ones), then clears the task from working memory.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string', description: 'Task ID to complete' },
      final_finding: {
        type: 'string',
        description: 'Optional summary finding to add before promoting (importance: high, type: episodic)',
      },
    },
    required: ['task_id'],
  },
};

export const taskGetToolDefinition = {
  name: 'task_get',
  description: 'Get the current state of a working-memory task, or list all active tasks if no task_id is provided.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string', description: 'Task ID to retrieve (omit to list all active tasks)' },
    },
  },
};

// --- Handlers ---

export async function handleTaskStart(args: unknown): Promise<CallToolResult> {
  try {
    const input = args as { goal: string; constraints?: string[]; plan?: string[] };
    if (!input.goal || typeof input.goal !== 'string') {
      return { content: [{ type: 'text', text: 'goal is required' }], isError: true };
    }

    const task_id = generateTaskId();
    createTask(task_id, input.goal, input.constraints, input.plan);

    if (input.plan) {
      for (const step of input.plan) {
        addStep(task_id, step);
      }
    }

    const seeded = await seedTaskFromVault(task_id, input.goal);

    logger.info('Task started', { task_id, goal: input.goal, seeded });

    return {
      content: [
        {
          type: 'text',
          text: [
            `Task started: ${task_id}`,
            `Goal: ${input.goal}`,
            input.constraints?.length ? `Constraints: ${input.constraints.join(', ')}` : null,
            input.plan?.length ? `Plan: ${input.plan.length} steps` : null,
            seeded > 0 ? `Seeded ${seeded} relevant memories from Obsidian vault` : 'No matching vault memories found',
          ].filter(Boolean).join('\n'),
        },
      ],
    };
  } catch (error) {
    logger.error('task_start failed', { error: String(error) });
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

export async function handleTaskUpdate(args: unknown): Promise<CallToolResult> {
  try {
    const input = args as {
      task_id: string;
      current_step?: string;
      add_finding?: { content: string; importance?: Importance; memory_type?: MemoryType };
      add_step?: string;
      complete_step?: number;
      fail_step?: number;
      add_artifact?: { name: string; reference: string };
      add_question?: string;
      resolve_question?: { id: number; resolution: string };
    };

    const task = getTask(input.task_id);
    if (!task) {
      return { content: [{ type: 'text', text: `Task not found: ${input.task_id}` }], isError: true };
    }

    const changes: string[] = [];

    if (input.current_step !== undefined) {
      updateTaskMeta(input.task_id, { current_step: input.current_step });
      changes.push(`Current step: ${input.current_step}`);
    }

    if (input.add_finding) {
      addFinding(input.task_id, input.add_finding.content, input.add_finding.importance, input.add_finding.memory_type);
      changes.push(`Finding recorded (${input.add_finding.importance ?? 'medium'}, ${input.add_finding.memory_type ?? 'untyped'})`);
    }

    if (input.add_step) {
      const id = addStep(input.task_id, input.add_step);
      changes.push(`Step #${id} added: ${input.add_step}`);
    }

    if (input.complete_step !== undefined) {
      updateStep(input.complete_step, 'completed' as StepStatus);
      changes.push(`Step #${input.complete_step} completed`);
    }

    if (input.fail_step !== undefined) {
      updateStep(input.fail_step, 'failed' as StepStatus);
      changes.push(`Step #${input.fail_step} marked failed`);
    }

    if (input.add_artifact) {
      const id = addArtifact(input.task_id, input.add_artifact.name, input.add_artifact.reference);
      changes.push(`Artifact #${id}: ${input.add_artifact.name}`);
    }

    if (input.add_question) {
      const id = addQuestion(input.task_id, input.add_question);
      changes.push(`Question #${id}: ${input.add_question}`);
    }

    if (input.resolve_question) {
      resolveQuestion(input.resolve_question.id, input.resolve_question.resolution);
      changes.push(`Question #${input.resolve_question.id} resolved`);
    }

    return {
      content: [
        {
          type: 'text',
          text: changes.length > 0
            ? `Task ${input.task_id} updated:\n${changes.join('\n')}`
            : `Task ${input.task_id}: no changes applied`,
        },
      ],
    };
  } catch (error) {
    logger.error('task_update failed', { error: String(error) });
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

export async function handleTaskComplete(args: unknown): Promise<CallToolResult> {
  try {
    const input = args as { task_id: string; final_finding?: string };

    const state = getTaskState(input.task_id);
    if (!state) {
      return { content: [{ type: 'text', text: `Task not found: ${input.task_id}` }], isError: true };
    }

    if (input.final_finding) {
      addFinding(input.task_id, input.final_finding, 'high', 'episodic');
      // Reload state to include the new finding
      const updated = getTaskState(input.task_id);
      if (updated) Object.assign(state, updated);
    }

    updateTaskMeta(input.task_id, { status: 'completed' });

    const counts = await promoteTaskToVault(state);

    deleteTask(input.task_id);

    logger.info('Task completed', { task_id: input.task_id, ...counts });

    return {
      content: [
        {
          type: 'text',
          text: [
            `Task ${input.task_id} completed.`,
            `Goal: ${state.task.goal}`,
            `Promoted to Obsidian: ${counts.created} created, ${counts.appended} appended, ${counts.skipped} skipped`,
            'Working memory cleared.',
          ].join('\n'),
        },
      ],
    };
  } catch (error) {
    logger.error('task_complete failed', { error: String(error) });
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}

export async function handleTaskGet(args: unknown): Promise<CallToolResult> {
  try {
    const input = args as { task_id?: string };

    if (!input.task_id) {
      const tasks = listActiveTasks();
      if (tasks.length === 0) {
        return { content: [{ type: 'text', text: 'No active tasks.' }] };
      }
      const summary = tasks.map((t) =>
        `- ${t.task_id}: ${t.goal} (started ${t.created_at})`
      ).join('\n');
      return { content: [{ type: 'text', text: `Active tasks:\n${summary}` }] };
    }

    const state = getTaskState(input.task_id);
    if (!state) {
      return { content: [{ type: 'text', text: `Task not found: ${input.task_id}` }], isError: true };
    }

    const pending = state.steps.filter((s) => s.status === 'pending').length;
    const done = state.steps.filter((s) => s.status === 'completed').length;
    const openQs = state.questions.filter((q) => !q.resolved).length;

    const lines = [
      `Task: ${state.task.task_id}`,
      `Goal: ${state.task.goal}`,
      `Status: ${state.task.status}`,
      state.task.current_step ? `Current step: ${state.task.current_step}` : null,
      `Steps: ${done} completed, ${pending} pending`,
      `Findings: ${state.findings.length}`,
      `Artifacts: ${state.artifacts.length}`,
      `Open questions: ${openQs}`,
    ];

    if (state.findings.length > 0) {
      lines.push('\nFindings:');
      for (const f of state.findings) {
        lines.push(`  [${f.importance}/${f.memory_type ?? 'untyped'}] ${f.content.slice(0, 120)}`);
      }
    }

    if (state.artifacts.length > 0) {
      lines.push('\nArtifacts:');
      for (const a of state.artifacts) {
        lines.push(`  ${a.name}: ${a.reference}`);
      }
    }

    if (openQs > 0) {
      lines.push('\nOpen questions:');
      for (const q of state.questions.filter((q) => !q.resolved)) {
        lines.push(`  #${q.id}: ${q.question}`);
      }
    }

    return { content: [{ type: 'text', text: lines.filter((l) => l !== null).join('\n') }] };
  } catch (error) {
    logger.error('task_get failed', { error: String(error) });
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
}
