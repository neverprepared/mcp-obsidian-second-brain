import type { CallToolRequest, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { storeToolDefinition, handleStore } from './store.js';
import { recallToolDefinition, handleRecall } from './recall.js';
import { searchToolDefinition, handleSearch } from './search.js';
import { updateToolDefinition, handleUpdate } from './update.js';
import { memoryAppendToolDefinition, handleMemoryAppend } from './append.js';
import { deleteToolDefinition, handleDelete } from './delete.js';
import { linkToolDefinition, handleLink } from './link.js';
import { statsToolDefinition, handleStats } from './stats.js';
import { cleanupToolDefinition, handleCleanup } from './cleanup.js';
import { timelineToolDefinition, handleTimeline } from './timeline.js';
import {
  taskStartToolDefinition, handleTaskStart,
  taskUpdateToolDefinition, handleTaskUpdate,
  taskCompleteToolDefinition, handleTaskComplete,
  taskGetToolDefinition, handleTaskGet,
} from './task.js';
import {
  inputIngestToolDefinition, handleInputIngest,
  inputReadToolDefinition, handleInputRead,
  inputListToolDefinition, handleInputList,
  inputSupersedeToolDefinition, handleInputSupersede,
} from './input.js';
import {
  outputWriteToolDefinition, handleOutputWrite,
  outputReadToolDefinition, handleOutputRead,
  outputUpdateToolDefinition, handleOutputUpdate,
  outputDeleteToolDefinition, handleOutputDelete,
  outputListToolDefinition, handleOutputList,
} from './output.js';
import {
  wikiWriteToolDefinition, handleWikiWrite,
  wikiReadToolDefinition, handleWikiRead,
  wikiListToolDefinition, handleWikiList,
  wikiSearchToolDefinition, handleWikiSearch,
  wikiDeleteToolDefinition, handleWikiDelete,
  wikiMoveToolDefinition, handleWikiMove,
} from './wiki.js';
import {
  logReadToolDefinition, handleLogRead,
  logListToolDefinition, handleLogList,
} from './log.js';

export function getToolDefinitions() {
  return [
    storeToolDefinition,
    recallToolDefinition,
    searchToolDefinition,
    updateToolDefinition,
    memoryAppendToolDefinition,
    deleteToolDefinition,
    linkToolDefinition,
    statsToolDefinition,
    cleanupToolDefinition,
    timelineToolDefinition,
    taskStartToolDefinition,
    taskUpdateToolDefinition,
    taskCompleteToolDefinition,
    taskGetToolDefinition,
    inputIngestToolDefinition,
    inputReadToolDefinition,
    inputListToolDefinition,
    inputSupersedeToolDefinition,
    outputWriteToolDefinition,
    outputReadToolDefinition,
    outputUpdateToolDefinition,
    outputDeleteToolDefinition,
    outputListToolDefinition,
    wikiWriteToolDefinition,
    wikiReadToolDefinition,
    wikiListToolDefinition,
    wikiSearchToolDefinition,
    wikiDeleteToolDefinition,
    wikiMoveToolDefinition,
    logReadToolDefinition,
    logListToolDefinition,
  ];
}

const handlers: Record<string, (args: unknown) => Promise<CallToolResult>> = {
  memory_store: handleStore,
  memory_recall: handleRecall,
  memory_search: handleSearch,
  memory_update: handleUpdate,
  memory_append: handleMemoryAppend,
  memory_delete: handleDelete,
  memory_link: handleLink,
  memory_stats: handleStats,
  memory_cleanup: handleCleanup,
  memory_timeline: handleTimeline,
  task_start: handleTaskStart,
  task_update: handleTaskUpdate,
  task_complete: handleTaskComplete,
  task_get: handleTaskGet,
  input_ingest: handleInputIngest,
  input_read: handleInputRead,
  input_list: handleInputList,
  input_supersede: handleInputSupersede,
  output_write: handleOutputWrite,
  output_read: handleOutputRead,
  output_update: handleOutputUpdate,
  output_delete: handleOutputDelete,
  output_list: handleOutputList,
  wiki_write: handleWikiWrite,
  wiki_read: handleWikiRead,
  wiki_list: handleWikiList,
  wiki_search: handleWikiSearch,
  wiki_delete: handleWikiDelete,
  wiki_move: handleWikiMove,
  log_read: handleLogRead,
  log_list: handleLogList,
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
