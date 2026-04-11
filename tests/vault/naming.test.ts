import { describe, it, expect } from 'vitest';
import { slugFromTitle } from '../../src/vault/naming.js';

describe('naming', () => {
  it('should generate a slug from a simple title', () => {
    expect(slugFromTitle('Hello World')).toBe('hello-world');
  });

  it('should strip special characters', () => {
    expect(slugFromTitle('Hello, World! How are you?')).toBe('hello-world-how-are-you');
  });

  it('should truncate long slugs', () => {
    const longTitle = 'This is a very long title that should be truncated to sixty characters maximum';
    const slug = slugFromTitle(longTitle);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it('should handle titles with numbers', () => {
    expect(slugFromTitle('Chapter 3: The Return')).toBe('chapter-3-the-return');
  });
});
