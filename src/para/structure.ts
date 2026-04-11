import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { logger } from '../shared/logger.js';

export async function ensureVaultStructure(): Promise<void> {
  const vaultPath = CONFIG.VAULT_PATH;

  const dirs = [
    ...CONFIG.PARA_FOLDERS.map((f) => path.join(vaultPath, f)),
    path.join(vaultPath, CONFIG.DAILY_FOLDER),
    path.join(vaultPath, CONFIG.INDEX_FOLDER),
    path.join(vaultPath, CONFIG.TEMPLATE_FOLDER),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }

  logger.info('Vault structure ensured', { vaultPath });
}
