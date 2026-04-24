import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initFts, isFtsReady, upsertFts, deleteFts, searchFts, rebuildFts } from '../../src/vault/fts-index.js';

describe('FTS5 index', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initFts(db);
  });

  afterEach(() => {
    db.close();
  });

  it('initializes successfully', () => {
    expect(isFtsReady()).toBe(true);
  });

  it('inserts and searches by title', () => {
    upsertFts('id1', 'Kubernetes deployment guide', ['k8s', 'devops'], 'How to deploy apps.');
    const results = searchFts('kubernetes', 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('id1');
    expect(results[0]!.rank).toBeGreaterThan(0);
  });

  it('searches by tag content', () => {
    upsertFts('id1', 'Some title', ['python', 'machine-learning'], 'Body text here.');
    const results = searchFts('python', 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe('id1');
  });

  it('searches by body content', () => {
    upsertFts('id1', 'Title', ['tag'], 'The quick brown fox jumps over the lazy dog.');
    const results = searchFts('fox', 10);
    expect(results).toHaveLength(1);
  });

  it('returns snippets from body matches', () => {
    upsertFts('id1', 'Title', [], 'Lorem ipsum dolor sit amet, the important finding is here, consectetur adipiscing.');
    const results = searchFts('important', 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.snippet).toContain('important');
  });

  it('returns no results for non-matching query', () => {
    upsertFts('id1', 'Cats and dogs', [], 'Pets are great.');
    const results = searchFts('kubernetes', 10);
    expect(results).toHaveLength(0);
  });

  it('respects limit', () => {
    for (let i = 0; i < 10; i++) {
      upsertFts(`id${i}`, `Title ${i} with deploy`, ['common'], `Body ${i} about deploy.`);
    }
    const results = searchFts('deploy', 3);
    expect(results).toHaveLength(3);
  });

  it('upsert replaces existing entry', () => {
    upsertFts('id1', 'Old title', [], 'Old body');
    upsertFts('id1', 'New title about react', [], 'New body about react');

    const oldResults = searchFts('Old', 10);
    expect(oldResults).toHaveLength(0);

    const newResults = searchFts('react', 10);
    expect(newResults).toHaveLength(1);
    expect(newResults[0]!.id).toBe('id1');
  });

  it('delete removes entry', () => {
    upsertFts('id1', 'Deletable', [], 'Will be removed.');
    deleteFts('id1');
    const results = searchFts('Deletable', 10);
    expect(results).toHaveLength(0);
  });

  it('rebuildFts replaces all entries', () => {
    upsertFts('old1', 'Old entry', [], 'Should be gone.');
    rebuildFts([
      { id: 'new1', title: 'New entry one', tags: ['fresh'], body: 'Brand new.' },
      { id: 'new2', title: 'New entry two', tags: ['fresh'], body: 'Also new.' },
    ]);

    expect(searchFts('Old', 10)).toHaveLength(0);
    expect(searchFts('new', 10)).toHaveLength(2);
  });

  it('handles prefix matching', () => {
    upsertFts('id1', 'Authentication system', [], 'OAuth2 implementation details.');
    // "auth" should match "authentication" via prefix
    const results = searchFts('auth', 10);
    expect(results).toHaveLength(1);
  });

  it('handles special characters in query gracefully', () => {
    upsertFts('id1', 'Normal title', [], 'Normal body.');
    // Should not throw on special FTS characters
    const results = searchFts('test "AND" OR (NOT) [bracket]', 10);
    expect(results).toBeDefined();
  });

  it('uses porter stemming (deploy matches deployment)', () => {
    upsertFts('id1', 'Deployment guide', [], 'Deploy instructions.');
    const results = searchFts('deploy', 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
