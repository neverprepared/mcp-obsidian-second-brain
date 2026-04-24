import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { storeToolDefinition, handleStore } from './store.js';
import { recallToolDefinition, handleRecall } from './recall.js';
import { searchToolDefinition, handleSearch } from './search.js';
import { listToolDefinition, handleList } from './list.js';
import { updateToolDefinition, handleUpdate } from './update.js';
import { archiveToolDefinition, handleArchive } from './archive.js';
import { deleteToolDefinition, handleDelete } from './delete.js';
import { linkToolDefinition, handleLink } from './link.js';
import { projectToolDefinition, handleProject } from './project.js';
import { statsToolDefinition, handleStats } from './stats.js';
import { cleanupToolDefinition, handleCleanup } from './cleanup.js';
import { timelineToolDefinition, handleTimeline } from './timeline.js';
import {
  taskStartToolDefinition, handleTaskStart,
  taskUpdateToolDefinition, handleTaskUpdate,
  taskCompleteToolDefinition, handleTaskComplete,
  taskGetToolDefinition, handleTaskGet,
} from './task.js';

export function getToolDefinitions() {
  return [
    storeToolDefinition,
    recallToolDefinition,
    searchToolDefinition,
    listToolDefinition,
    updateToolDefinition,
    archiveToolDefinition,
    deleteToolDefinition,
    linkToolDefinition,
    projectToolDefinition,
    statsToolDefinition,
    cleanupToolDefinition,
    timelineToolDefinition,
    taskStartToolDefinition,
    taskUpdateToolDefinition,
    taskCompleteToolDefinition,
    taskGetToolDefinition,
  ];
}

const handlers: Record<string, (args: unknown) => Promise<CallToolResult>> = {
  memory_store: handleStore,
  memory_recall: handleRecall,
  memory_search: handleSearch,
  memory_list: handleList,
  memory_update: handleUpdate,
  memory_archive: handleArchive,
  memory_delete: handleDelete,
  memory_link: handleLink,
  memory_project: handleProject,
  memory_stats: handleStats,
  memory_cleanup: handleCleanup,
  memory_timeline: handleTimeline,
  task_start: handleTaskStart,
  task_update: handleTaskUpdate,
  task_complete: handleTaskComplete,
  task_get: handleTaskGet,
};

export async function handleToolCall(request: CallToolRequest): Promise<CallToolResult> {
  const toolName = request.params.name;
  const handler = handlers[toolName];

  if (!handler) {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  }

  return handler(request.params.arguments ?? {});
}
