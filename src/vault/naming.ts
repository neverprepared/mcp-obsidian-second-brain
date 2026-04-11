import fs from 'node:fs/promises';
import path from 'node:path';
import { generateSlug } from '../shared/utils.js';

export function slugFromTitle(title: string): string {
  return generateSlug(title);
}

export async function deduplicateSlug(dir: string, slug: string): Promise<string> {
  let candidate = slug;
  let counter = 2;

  while (true) {
    const filePath = path.join(dir, `${candidate}.md`);
    try {
      await fs.access(filePath);
      // File exists, try next candidate
      candidate = `${slug}-${counter}`;
      counter++;
    } catch {
      // File doesn't exist, this slug is available
      return candidate;
    }
  }
}
