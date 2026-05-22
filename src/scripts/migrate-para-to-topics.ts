#!/usr/bin/env node
/**
 * Migration script: relocate atoms from PARA folders to Memory/
 * and update schema (para → lifecycle_status + explicit ttl_days).
 *
 * Usage:
 *   npx tsx src/scripts/migrate-para-to-topics.ts --dry-run    # preview
 *   npx tsx src/scripts/migrate-para-to-topics.ts --execute    # apply
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { CONFIG } from '../config.js';
import { writeAtomicFile } from '../vault/filesystem.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MigrationRow {
  oldPath: string;
  newPath: string;
  slug: string;
  newSlug: string;
  lifecycleStatus: string;
  ttlDays: number;
  title: string;
  skipped: boolean;
  skipReason?: string;
}

// ---------------------------------------------------------------------------
// PARA → lifecycle mapping (old folder names hard-coded)
// ---------------------------------------------------------------------------

const OLD_PARA_FOLDERS = ['Projects', 'Areas', 'Resources', 'Archives'] as const;

const PARA_TO_LIFECYCLE: Record<string, string> = {
  Projects: 'active',
  Areas: 'active',
  Resources: 'reference',
  Archives: 'archive',
};

const PARA_TO_TTL: Record<string, number> = {
  Projects: 30,
  Areas: 90,
  Resources: 180,
  Archives: 365,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

/**
 * Deduplicate slug within the Memory/ destination dir.
 * If Memory/<slug>.md already exists and has the SAME id, skip (idempotent).
 * If it has a DIFFERENT id, append -2, -3, etc.
 */
async function resolveDestSlug(
  memoryDir: string,
  baseSlug: string,
  sourceId: string,
): Promise<{ slug: string; reason?: 'same-id' }> {
  let candidate = baseSlug;
  let counter = 2;

  while (true) {
    const destPath = path.join(memoryDir, `${candidate}.md`);
    const exists = await fileExists(destPath);
    if (!exists) {
      return { slug: candidate };
    }

    // File exists — check the id
    try {
      const raw = await fs.readFile(destPath, 'utf-8');
      const { data } = matter(raw);
      if (data['id'] === sourceId) {
        // Same atom already migrated
        return { slug: candidate, reason: 'same-id' };
      }
    } catch {
      // Can't read destination — treat as collision
    }

    candidate = `${baseSlug}-${counter}`;
    counter++;
  }
}

// ---------------------------------------------------------------------------
// Plan (dry-run + execute shared)
// ---------------------------------------------------------------------------

async function planMigration(): Promise<MigrationRow[]> {
  const vaultPath = CONFIG.VAULT_PATH;
  const memoryDir = path.join(vaultPath, CONFIG.MEMORY_FOLDER);
  const rows: MigrationRow[] = [];

  for (const folder of OLD_PARA_FOLDERS) {
    const folderPath = path.join(vaultPath, folder);
    let files: string[];
    try {
      files = await fs.readdir(folderPath);
    } catch {
      // Folder doesn't exist — skip
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      if (file === CONFIG.INDEX_FILE) continue;

      const oldPath = path.join(folderPath, file);
      const baseSlug = file.replace(/\.md$/, '');

      let raw: string;
      try {
        raw = await fs.readFile(oldPath, 'utf-8');
      } catch {
        rows.push({
          oldPath,
          newPath: '',
          slug: baseSlug,
          newSlug: '',
          lifecycleStatus: PARA_TO_LIFECYCLE[folder]!,
          ttlDays: PARA_TO_TTL[folder]!,
          title: baseSlug,
          skipped: true,
          skipReason: 'unreadable',
        });
        continue;
      }

      const { data } = matter(raw);
      const sourceId: string = typeof data['id'] === 'string' ? data['id'] : '';
      const title: string = typeof data['title'] === 'string' ? data['title'] : baseSlug;

      const { slug: newSlug, reason } = await resolveDestSlug(memoryDir, baseSlug, sourceId);
      const newPath = path.join(memoryDir, `${newSlug}.md`);

      if (reason === 'same-id') {
        rows.push({
          oldPath,
          newPath,
          slug: baseSlug,
          newSlug,
          lifecycleStatus: PARA_TO_LIFECYCLE[folder]!,
          ttlDays: PARA_TO_TTL[folder]!,
          title,
          skipped: true,
          skipReason: 'already-migrated (same id)',
        });
        continue;
      }

      rows.push({
        oldPath,
        newPath,
        slug: baseSlug,
        newSlug,
        lifecycleStatus: PARA_TO_LIFECYCLE[folder]!,
        ttlDays: PARA_TO_TTL[folder]!,
        title,
        skipped: false,
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

async function execute(rows: MigrationRow[]): Promise<{ migrated: number; skipped: number; failed: number }> {
  const vaultPath = CONFIG.VAULT_PATH;
  const memoryDir = path.join(vaultPath, CONFIG.MEMORY_FOLDER);
  const timestamp = todayTimestamp();
  const backupRoot = path.join(vaultPath, '_backup', `para-${timestamp}`);

  // Ensure Memory/ dir exists
  await fs.mkdir(memoryDir, { recursive: true });

  // Backup old PARA folders
  for (const folder of OLD_PARA_FOLDERS) {
    const src = path.join(vaultPath, folder);
    if (!await fileExists(src)) continue;
    const dest = path.join(backupRoot, folder);
    await fs.mkdir(dest, { recursive: true });
    const files = await fs.readdir(src);
    for (const file of files) {
      try {
        await fs.copyFile(path.join(src, file), path.join(dest, file));
      } catch {
        // Best effort
      }
    }
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const migratedSlugs: Array<{ newSlug: string; title: string; lifecycleStatus: string }> = [];

  for (const row of rows) {
    if (row.skipped) {
      skipped++;
      continue;
    }

    try {
      // Read source
      const raw = await fs.readFile(row.oldPath, 'utf-8');
      const parsed = matter(raw);
      const fm = parsed.data as Record<string, unknown>;

      // Update schema: add lifecycle_status + explicit ttl_days; keep para for compat
      fm['lifecycle_status'] = row.lifecycleStatus;
      if (fm['ttl_days'] === undefined || fm['ttl_days'] === null) {
        fm['ttl_days'] = row.ttlDays;
      }

      const newContent = matter.stringify(parsed.content, fm);

      // Write to Memory/
      await writeAtomicFile(row.newPath, newContent);

      // Verify written file is readable
      await fs.readFile(row.newPath, 'utf-8');

      // Delete original
      await fs.unlink(row.oldPath);

      migratedSlugs.push({ newSlug: row.newSlug, title: row.title, lifecycleStatus: row.lifecycleStatus });
      migrated++;
    } catch (err) {
      console.error(`  FAILED: ${row.oldPath} → ${err}`);
      failed++;
    }
  }

  // Build initial Memory/_index.md
  const memoryIndexPath = path.join(memoryDir, CONFIG.INDEX_FILE);
  const existingIndex = await fileExists(memoryIndexPath)
    ? await fs.readFile(memoryIndexPath, 'utf-8')
    : '';

  const indexLines = [
    '# Memory Index',
    '',
    '> Auto-generated by migrate-para-to-topics. Human-curated links below.',
    '',
    '| Slug | Title | Lifecycle |',
    '| ---- | ----- | --------- |',
    ...migratedSlugs.map((r) => `| [[${r.newSlug}]] | ${r.title} | ${r.lifecycleStatus} |`),
  ];

  // If existing index has content beyond headers, append to it
  if (existingIndex.trim() && !existingIndex.includes('Auto-generated by migrate-para-to-topics')) {
    await writeAtomicFile(memoryIndexPath, existingIndex.trimEnd() + '\n\n' + indexLines.join('\n') + '\n');
  } else {
    await writeAtomicFile(memoryIndexPath, indexLines.join('\n') + '\n');
  }

  // Seed Input/_index.md (empty table header only, don't overwrite if exists)
  const inputIndexPath = path.join(vaultPath, CONFIG.INPUT_FOLDER, CONFIG.INDEX_FILE);
  if (!await fileExists(inputIndexPath)) {
    await fs.mkdir(path.dirname(inputIndexPath), { recursive: true });
    await writeAtomicFile(inputIndexPath, [
      '# Input Index',
      '',
      '| File | Kind | Title | Ingested |',
      '| ---- | ---- | ----- | -------- |',
      '',
    ].join('\n'));
  }

  // Seed Wiki/_index.md (if Library/ exists, note it should be moved)
  const wikiIndexPath = path.join(vaultPath, CONFIG.WIKI_FOLDER, CONFIG.INDEX_FILE);
  if (!await fileExists(wikiIndexPath)) {
    const libraryPath = path.join(vaultPath, 'Library');
    const libraryExists = await fileExists(libraryPath);
    await fs.mkdir(path.dirname(wikiIndexPath), { recursive: true });
    await writeAtomicFile(wikiIndexPath, [
      '# Wiki Index',
      '',
      '| File | Kind | Title | Updated |',
      '| ---- | ---- | ----- | ------- |',
      '',
      libraryExists ? '> Note: Legacy Library/ content should be moved here manually.' : '',
    ].join('\n'));
  }

  // Write migration summary to _log/<date>.md
  const logDir = path.join(vaultPath, CONFIG.LOG_FOLDER);
  const logPath = path.join(logDir, `${todayDate()}.md`);
  await fs.mkdir(logDir, { recursive: true });
  const summaryLines = [
    `## PARA → Memory Migration (${new Date().toISOString()})`,
    '',
    `- Migrated: ${migrated}`,
    `- Skipped: ${skipped}`,
    `- Failed: ${failed}`,
    `- Backup: _backup/para-${timestamp}/`,
    '',
    '### Migrated atoms',
    ...migratedSlugs.map((r) => `- [[${r.newSlug}]] (${r.lifecycleStatus})`),
  ];

  const existingLog = await fileExists(logPath) ? await fs.readFile(logPath, 'utf-8') : '';
  await fs.appendFile(logPath, (existingLog ? '\n' : '') + summaryLines.join('\n') + '\n', 'utf-8');

  return { migrated, skipped, failed };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const doExecute = args.includes('--execute');

  if (!dryRun && !doExecute) {
    console.error('Usage: npx tsx src/scripts/migrate-para-to-topics.ts [--dry-run | --execute]');
    process.exit(1);
  }

  console.log(`Vault: ${CONFIG.VAULT_PATH}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'EXECUTE'}`);
  console.log('');

  const rows = await planMigration();

  // Print table
  const colWidths = [
    Math.max(10, ...rows.map((r) => r.oldPath.replace(CONFIG.VAULT_PATH + '/', '').length)),
    Math.max(10, ...rows.map((r) => (r.newSlug || r.slug).length + 7)),
    12,
    8,
    10,
  ];

  const header = [
    'Old Path'.padEnd(colWidths[0]!),
    'New Path'.padEnd(colWidths[1]!),
    'Lifecycle'.padEnd(colWidths[2]!),
    'TTL'.padEnd(colWidths[3]!),
    'Action',
  ].join('  ');

  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of rows) {
    const oldRel = row.oldPath.replace(CONFIG.VAULT_PATH + '/', '');
    const newRel = row.newPath ? row.newPath.replace(CONFIG.VAULT_PATH + '/', '') : '—';
    const action = row.skipped ? `SKIP (${row.skipReason})` : 'MIGRATE';
    console.log([
      oldRel.padEnd(colWidths[0]!),
      newRel.padEnd(colWidths[1]!),
      row.lifecycleStatus.padEnd(colWidths[2]!),
      String(row.ttlDays).padEnd(colWidths[3]!),
      action,
    ].join('  '));
  }

  console.log('');
  const toMigrate = rows.filter((r) => !r.skipped).length;
  const toSkip = rows.filter((r) => r.skipped).length;
  console.log(`Total: ${rows.length} atoms (${toMigrate} to migrate, ${toSkip} to skip)`);

  if (dryRun) {
    console.log('\nDry run complete. Run with --execute to apply.');
    return;
  }

  console.log('\nExecuting migration...');
  const { migrated, skipped, failed } = await execute(rows);

  console.log('');
  console.log(`Migration complete:`);
  console.log(`  Migrated: ${migrated}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Failed:   ${failed}`);
  if (failed > 0) {
    console.log('\nWARNING: Some atoms failed to migrate. Check output above.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
