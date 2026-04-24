import { searchMemories, findByTitle } from '../vault/search.js';
import { handleStore } from '../tools/store.js';
import { handleUpdate } from '../tools/update.js';
import { isFtsReady, searchFts } from '../vault/fts-index.js';
import type { Finding, MemoryType, TaskState } from './db.js';
import { logger } from '../shared/logger.js';

/** PARA category each memory_type promotes into */
const PARA_FOR_TYPE: Record<MemoryType, 'resources' | 'areas'> = {
  semantic: 'resources',
  episodic: 'areas',
  procedural: 'resources',
};

/** Tags appended per memory_type to aid future retrieval */
const EXTRA_TAGS: Record<MemoryType, string[]> = {
  semantic: ['fact', 'semantic-memory'],
  episodic: ['episode', 'working-memory-log'],
  procedural: ['procedure', 'runbook'],
};

/**
 * Derives a short title from the first sentence of content.
 * Falls back to the first 80 chars if no sentence boundary is found.
 */
function titleFromContent(content: string): string {
  const clean = content
    .replace(/\[From long-term memory\]/g, '')
    .replace(/\*\*/g, '')
    .trim();

  const boundary = clean.search(/[.!?\n]/);
  const raw = boundary > 0 ? clean.slice(0, boundary) : clean;
  return raw.trim().slice(0, 80).trim() || 'Promoted finding';
}

/**
 * Extracts simple keywords from a goal string for tag generation.
 */
function keywordsFromGoal(goal: string): string[] {
  const stopWords = new Set(['a', 'an', 'the', 'in', 'on', 'at', 'for', 'to', 'of', 'and', 'or', 'is', 'are', 'was', 'with', 'by', 'from', 'this', 'that']);
  return goal
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))
    .slice(0, 5);
}

/**
 * Attempts to find an existing Obsidian note that matches a finding's content.
 * Uses multiple strategies to prevent near-duplicate creation:
 * 1. Exact/partial title match via index
 * 2. FTS5 ranked search (when available)
 * 3. Keyword search fallback with score threshold
 * 4. Tag overlap (2+ shared tags)
 * Returns the memory ID if found, otherwise undefined.
 */
async function findMatchingNote(title: string, tags: string[], content: string): Promise<string | undefined> {
  try {
    // 1. Direct title match (exact or partial via index)
    const titleMatch = findByTitle(title);
    if (titleMatch) {
      return titleMatch.frontmatter.id;
    }

    // 2. FTS5 search on content for near-duplicate detection
    if (isFtsReady()) {
      // Search using first sentence of content for semantic match
      const contentQuery = content.slice(0, 100).replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
      if (contentQuery.length > 10) {
        const ftsHits = searchFts(contentQuery, 3);
        for (const hit of ftsHits) {
          // High FTS rank indicates strong content overlap
          if (hit.rank > 5) {
            logger.info('Dedup: found near-duplicate via FTS content match', { id: hit.id, rank: hit.rank });
            return hit.id;
          }
        }
      }
    }

    // 3. Search by title words
    const titleQuery = title.slice(0, 40);
    const results = await searchMemories({ query: titleQuery, limit: 5 });

    for (const result of results) {
      // Strong title match
      if (result.score >= 10) {
        return result.entry.frontmatter.id;
      }

      // Tag overlap match (2+ shared tags)
      const entryTags = result.entry.frontmatter.tags.map((t) => t.toLowerCase());
      const sharedTags = tags.filter((t) => entryTags.includes(t.toLowerCase()));
      if (sharedTags.length >= 2) {
        return result.entry.frontmatter.id;
      }
    }
  } catch (err) {
    logger.warn('Match search failed during promotion', { error: String(err) });
  }

  return undefined;
}

async function promoteFinding(finding: Finding, goalTags: string[]): Promise<'created' | 'appended' | 'skipped'> {
  const memoryType = (finding.memory_type ?? 'episodic') as MemoryType;

  // Skip seeded long-term memory findings — they already live in the vault
  if (finding.content.startsWith('[From long-term memory]')) {
    return 'skipped';
  }

  const title = titleFromContent(finding.content);
  const para = PARA_FOR_TYPE[memoryType];
  const tags = [...goalTags, ...EXTRA_TAGS[memoryType]];
  const content = memoryType === 'procedural'
    ? `## Steps\n\n${finding.content}`
    : finding.content;

  const existingId = await findMatchingNote(title, tags, content);

  if (existingId) {
    const result = await handleUpdate({
      id: existingId,
      content: `\n\n---\n\n${content}`,
      append: true,
      add_tags: tags,
    });

    if (result.isError) {
      logger.warn('Failed to append finding to existing note', { id: existingId });
      return 'skipped';
    }

    logger.info('Appended finding to existing note', { id: existingId, title });
    return 'appended';
  }

  const result = await handleStore({
    title,
    content,
    para,
    tags,
    source: 'conversation',
    confidence: finding.importance === 'high' ? 'high' : 'medium',
    related: [],
    source_urls: [],
  });

  if (result.isError) {
    logger.warn('Failed to create note for finding', { title });
    return 'skipped';
  }

  logger.info('Created new note from finding', { title, para, memoryType });
  return 'created';
}

/**
 * Promotes all medium/high importance findings from a completed task to Obsidian.
 * Called automatically by task_complete.
 */
export async function promoteTaskToVault(state: TaskState): Promise<{ created: number; appended: number; skipped: number }> {
  const counts = { created: 0, appended: 0, skipped: 0 };
  const goalTags = keywordsFromGoal(state.task.goal);

  for (const finding of state.findings) {
    if (finding.importance === 'low') continue;

    const outcome = await promoteFinding(finding, goalTags);
    counts[outcome]++;
  }

  logger.info('Task promotion complete', {
    task_id: state.task.task_id,
    ...counts,
  });

  return counts;
}
