import matter from 'gray-matter';
import type { Frontmatter } from '../schemas/frontmatter.js';
import { FrontmatterSchema, normalizeFrontmatter } from '../schemas/frontmatter.js';

export interface ParsedMemory {
  frontmatter: Frontmatter;
  content: string;
}

export function parseMemoryFile(raw: string, filePath?: string): ParsedMemory {
  const { data, content } = matter(raw);
  const frontmatter = normalizeFrontmatter(FrontmatterSchema.parse(data), filePath);
  return { frontmatter, content: content.trim() };
}

export function serializeMemory(frontmatter: Frontmatter, content: string): string {
  return matter.stringify(content, frontmatter);
}
