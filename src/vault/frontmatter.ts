import matter from 'gray-matter';
import type { Frontmatter } from '../schemas/frontmatter.js';
import { FrontmatterSchema } from '../schemas/frontmatter.js';

export interface ParsedMemory {
  frontmatter: Frontmatter;
  content: string;
}

export function parseMemoryFile(raw: string): ParsedMemory {
  const { data, content } = matter(raw);
  const frontmatter = FrontmatterSchema.parse(data);
  return { frontmatter, content: content.trim() };
}

export function serializeMemory(frontmatter: Frontmatter, content: string): string {
  return matter.stringify(content, frontmatter);
}
