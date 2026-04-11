import { describe, it, expect } from 'vitest';
import { parseMemoryFile, serializeMemory } from '../../src/vault/frontmatter.js';
import type { Frontmatter } from '../../src/schemas/frontmatter.js';

describe('frontmatter', () => {
  const sampleFrontmatter: Frontmatter = {
    id: 'mem_1712764800_test-memory',
    title: 'Test Memory',
    para: 'resources',
    tags: ['test', 'example'],
    created: '2026-04-10T14:00:00.000Z',
    updated: '2026-04-10T14:00:00.000Z',
    source: 'conversation',
    related: [],
    confidence: 'medium',
    status: 'active',
  };

  it('should serialize and parse a memory roundtrip', () => {
    const content = 'This is the memory content.\n\nWith multiple paragraphs.';
    const serialized = serializeMemory(sampleFrontmatter, content);
    const parsed = parseMemoryFile(serialized);

    expect(parsed.frontmatter.id).toBe(sampleFrontmatter.id);
    expect(parsed.frontmatter.title).toBe(sampleFrontmatter.title);
    expect(parsed.frontmatter.para).toBe(sampleFrontmatter.para);
    expect(parsed.frontmatter.tags).toEqual(sampleFrontmatter.tags);
    expect(parsed.content).toBe(content);
  });

  it('should parse valid frontmatter', () => {
    const raw = `---
id: mem_123_hello
title: Hello World
para: projects
tags:
  - greeting
created: "2026-04-10T14:00:00.000Z"
updated: "2026-04-10T14:00:00.000Z"
source: conversation
related: []
confidence: high
status: active
---

Hello world content.`;

    const parsed = parseMemoryFile(raw);
    expect(parsed.frontmatter.id).toBe('mem_123_hello');
    expect(parsed.frontmatter.para).toBe('projects');
    expect(parsed.frontmatter.confidence).toBe('high');
    expect(parsed.content).toBe('Hello world content.');
  });

  it('should reject invalid PARA category', () => {
    const raw = `---
id: mem_123_test
title: Test
para: invalid
tags: []
created: "2026-04-10T14:00:00.000Z"
updated: "2026-04-10T14:00:00.000Z"
source: conversation
related: []
confidence: medium
status: active
---

Content.`;

    expect(() => parseMemoryFile(raw)).toThrow();
  });
});
