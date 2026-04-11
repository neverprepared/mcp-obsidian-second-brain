#!/usr/bin/env npx tsx
/**
 * Migration script: backfill freshness fields on existing memories.
 *
 * - Extracts source_urls from markdown content (Source:/Sources: patterns)
 * - Sets ttl_days based on tags (cloud docs=90, demographics=365, default=180)
 * - Sets last_accessed to current time
 *
 * Usage: npx tsx scripts/migrate-freshness.ts [--dry-run]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const VAULT_PATH =
  process.env['OBSIDIAN_VAULT_PATH'] ||
  path.join(process.env['HOME'] || '', 'workspaces/profiles/personal/obsidian/vaults/memory');

const PARA_FOLDERS = ['Projects', 'Areas', 'Resources', 'Archives'];
const dryRun = process.argv.includes('--dry-run');

// TTL rules: first matching tag wins
const TTL_RULES: Array<{ tags: string[]; ttl: number }> = [
  { tags: ['aws', 'azure', 'ecs', 'eks', 'aks', 'fargate', 'container-apps', 'aci'], ttl: 90 },
  { tags: ['networking', 'vpc', 'vnet', 'firewall', 'security-groups', 'nsg', 'nacl'], ttl: 120 },
  { tags: ['s3', 'blob-storage', 'ecr', 'acr', 'object-storage'], ttl: 120 },
  { tags: ['demographics', 'birth-rates', 'fertility', 'population'], ttl: 365 },
];

function inferTtlDays(tags: string[]): number {
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  for (const rule of TTL_RULES) {
    if (rule.tags.some((t) => tagSet.has(t))) {
      return rule.ttl;
    }
  }
  return 180; // default
}

function extractSourceUrls(content: string): string[] {
  const urls: string[] = [];

  // Pattern 1: "Source: https://..."
  const singleMatch = content.match(/^Source:\s*(https?:\/\/\S+)/m);
  if (singleMatch) {
    urls.push(singleMatch[1]!);
  }

  // Pattern 2: "Sources:\n- https://...\n- https://..."
  const multiMatch = content.match(/^Sources:\s*\n((?:\s*-\s*https?:\/\/\S+\s*\n?)+)/m);
  if (multiMatch) {
    const lines = multiMatch[1]!.split('\n');
    for (const line of lines) {
      const urlMatch = line.match(/^\s*-\s*(https?:\/\/\S+)/);
      if (urlMatch) {
        urls.push(urlMatch[1]!);
      }
    }
  }

  // Deduplicate
  return [...new Set(urls)];
}

async function migrate() {
  const now = new Date().toISOString();
  let updated = 0;
  let skipped = 0;

  for (const folder of PARA_FOLDERS) {
    const dirPath = path.join(VAULT_PATH, folder);
    let files: string[];
    try {
      files = (await fs.readdir(dirPath)).filter((f) => f.endsWith('.md'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(raw);
      const fm = parsed.data;

      // Skip if already migrated
      if (fm.last_accessed && fm.source_urls?.length > 0 && fm.ttl_days !== undefined) {
        skipped++;
        continue;
      }

      const tags: string[] = fm.tags || [];
      const sourceUrls = extractSourceUrls(parsed.content);
      const ttlDays = inferTtlDays(tags);

      // Apply new fields (preserve existing if already set)
      fm.last_accessed = fm.last_accessed || now;
      fm.source_urls = fm.source_urls?.length > 0 ? fm.source_urls : sourceUrls;
      fm.ttl_days = fm.ttl_days ?? ttlDays;

      const output = matter.stringify(parsed.content, fm);

      console.log(
        `${dryRun ? '[DRY RUN] ' : ''}${file}` +
          `\n  ttl_days: ${fm.ttl_days}` +
          `\n  source_urls: [${fm.source_urls.join(', ')}]` +
          `\n  last_accessed: ${fm.last_accessed}\n`
      );

      if (!dryRun) {
        await fs.writeFile(filePath, output, 'utf-8');
      }
      updated++;
    }
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}Migration complete: ${updated} updated, ${skipped} skipped`);
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
