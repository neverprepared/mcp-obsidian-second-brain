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
