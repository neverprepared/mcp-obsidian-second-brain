import fs from 'node:fs/promises';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { paraFolderFromCategory } from '../config.js';
import type { ParaCategory } from '../schemas/frontmatter.js';
import { VaultError } from '../shared/errors.js';
import { logger } from '../shared/logger.js';

export function memoryFilePath(para: ParaCategory, slug: string): string {
  return path.join(CONFIG.VAULT_PATH, paraFolderFromCategory(para), `${slug}.md`);
}

export async function writeMemoryFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
  logger.debug('Wrote memory file', { path: filePath });
}

export async function readMemoryFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    throw new VaultError(`Failed to read memory file: ${filePath}`, {
      path: filePath,
      error: String(err),
    });
  }
}

export async function deleteMemoryFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    logger.debug('Deleted memory file', { path: filePath });
  } catch (err) {
    throw new VaultError(`Failed to delete memory file: ${filePath}`, {
      path: filePath,
      error: String(err),
    });
  }
}

export async function moveMemoryFile(oldPath: string, newPath: string): Promise<void> {
  const dir = path.dirname(newPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.rename(oldPath, newPath);
  logger.debug('Moved memory file', { from: oldPath, to: newPath });
}

export interface MemoryFileEntry {
  filePath: string;
  slug: string;
  paraFolder: string;
}

export async function listAllMemoryFiles(): Promise<MemoryFileEntry[]> {
  const entries: MemoryFileEntry[] = [];

  for (const folder of CONFIG.PARA_FOLDERS) {
    const dirPath = path.join(CONFIG.VAULT_PATH, folder);
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          entries.push({
            filePath: path.join(dirPath, file),
            slug: file.replace(/\.md$/, ''),
            paraFolder: folder,
          });
        }
      }
    } catch {
      // Directory may not exist yet
    }
  }

  return entries;
}

export async function appendToDaily(line: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0]!;
  const dailyPath = path.join(CONFIG.VAULT_PATH, CONFIG.DAILY_FOLDER, `${today}.md`);

  let existing = '';
  try {
    existing = await fs.readFile(dailyPath, 'utf-8');
  } catch {
    existing = `# ${today}\n\n`;
  }

  const updated = existing.trimEnd() + '\n' + line + '\n';
  await fs.mkdir(path.dirname(dailyPath), { recursive: true });
  await fs.writeFile(dailyPath, updated, 'utf-8');
}
