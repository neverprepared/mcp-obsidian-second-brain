import { formatError } from '../shared/errors.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readAllSnapshots } from '../working/db.js';
import { logger } from '../shared/logger.js';

export const workingStatsToolDefinition = {
  name: 'memory_working_stats',
  description:
    'Get a summary of all active working memory sessions across running MCP server instances. Shows active tasks, step progress, finding counts by importance, artifacts, and open questions for each session.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
};

export async function handleWorkingStats(_args: unknown): Promise<CallToolResult> {
  try {
    const snapshots = readAllSnapshots();

    if (snapshots.length === 0) {
      return {
        content: [{ type: 'text', text: '## Working Memory Sessions\n\nNo active sessions with working memory tasks.' }],
      };
    }

    const sections: string[] = [
      '## Working Memory Sessions',
      '',
      `**Active instances:** ${snapshots.length}`,
    ];

    for (const snap of snapshots) {
      const isSelf = snap.pid === process.pid;
      sections.push(
        '',
        `### PID ${snap.pid}${isSelf ? ' (this session)' : ''}`,
        `- Started: ${snap.server_start}`,
        `- Last updated: ${snap.updated_at}`,
        `- Active tasks: ${snap.tasks.length}`,
      );

      if (snap.tasks.length === 0) {
        sections.push('- No active tasks');
        continue;
      }

      for (const task of snap.tasks) {
        const stepProgress = task.steps.total > 0
          ? `${task.steps.completed}/${task.steps.total} done`
          : 'no steps';
        const findingSummary = task.findings.total > 0
          ? `${task.findings.total} (${task.findings.high}H/${task.findings.medium}M/${task.findings.low}L)`
          : 'none';
        const questionSummary = task.questions.total > 0
          ? `${task.questions.open} open / ${task.questions.resolved} resolved`
          : 'none';

        sections.push(
          '',
          `#### ${task.task_id}`,
          `- **Goal:** ${task.goal}`,
        );
        if (task.current_step) {
          sections.push(`- **Current step:** ${task.current_step}`);
        }
        sections.push(
          `- **Steps:** ${stepProgress}${task.steps.failed > 0 ? ` (${task.steps.failed} failed)` : ''}`,
          `- **Findings:** ${findingSummary}`,
          `- **Artifacts:** ${task.artifacts}`,
          `- **Questions:** ${questionSummary}`,
          `- **Started:** ${task.created_at}`,
        );
      }
    }

    return {
      content: [{ type: 'text', text: sections.filter((l) => l !== null).join('\n') }],
    };
  } catch (error) {
    logger.error('Failed to get working memory stats', { error: String(error) });
    return {
      content: [{ type: 'text', text: `Error getting working memory stats: ${formatError(error)}` }],
      isError: true,
    };
  }
}
