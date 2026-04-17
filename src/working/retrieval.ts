import { searchMemories } from '../vault/search.js';
import { addFinding } from './db.js';
import { logger } from '../shared/logger.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'for', 'to', 'of', 'and', 'or',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
  'can', 'with', 'by', 'from', 'as', 'this', 'that', 'these', 'those',
  'it', 'its', 'we', 'our', 'my', 'i', 'you', 'your',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 6);
}

/**
 * Searches Obsidian for context relevant to the given goal and seeds the task
 * with findings sourced from long-term memory. Called automatically by task_start.
 */
export async function seedTaskFromVault(task_id: string, goal: string): Promise<number> {
  const keywords = extractKeywords(goal);
  if (keywords.length === 0) return 0;

  const query = keywords.join(' ');

  try {
    const results = await searchMemories({ query, limit: 5, freshness: 'fresh' });

    let seeded = 0;
    for (const result of results) {
      const fm = result.entry.frontmatter;
      const snippet = result.snippet
        ? `\n\n> ${result.snippet}`
        : '';

      const content =
        `[From long-term memory] **${fm.title}** (${fm.para}, score: ${result.score})` +
        snippet;

      addFinding(task_id, content, 'high', 'semantic');
      seeded++;
    }

    if (seeded > 0) {
      logger.info('Seeded task from vault', { task_id, seeded, query });
    }

    return seeded;
  } catch (err) {
    logger.warn('Failed to seed task from vault', { task_id, error: String(err) });
    return 0;
  }
}
