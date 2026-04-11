import path from 'node:path';

export const CONFIG = {
  VAULT_PATH: process.env['OBSIDIAN_VAULT_PATH']
    || path.join(process.env['HOME'] || '', 'workspaces/profiles/personal/obsidian/vaults/memory'),
  PARA_FOLDERS: ['Projects', 'Areas', 'Resources', 'Archives'] as const,
  DAILY_FOLDER: '_daily',
  INDEX_FOLDER: '_index',
  TEMPLATE_FOLDER: '_templates',
  MAX_TITLE_LENGTH: 200,
  MAX_SLUG_LENGTH: 60,
  DEFAULT_SEARCH_LIMIT: 10,
  MAX_SEARCH_LIMIT: 50,
  DEFAULT_LIST_LIMIT: 20,
  MAX_LIST_LIMIT: 100,
} as const;

export const DEFAULT_TTL_DAYS: Record<string, number> = {
  projects: 30,
  areas: 90,
  resources: 180,
  archives: 365,
};

export type ParaFolder = typeof CONFIG.PARA_FOLDERS[number];

export function paraFolderFromCategory(category: string): ParaFolder {
  const map: Record<string, ParaFolder> = {
    projects: 'Projects',
    areas: 'Areas',
    resources: 'Resources',
    archives: 'Archives',
  };
  const folder = map[category];
  if (!folder) {
    throw new Error(`Invalid PARA category: ${category}`);
  }
  return folder;
}
