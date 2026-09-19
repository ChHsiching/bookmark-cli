import { describe, expect, it } from 'vitest';
import { FIELD_WEIGHTS, scoreBookmark, searchBookmarks } from '../src/search.js';
import { Bookmark } from '../src/types.js';

/** Minimal bookmark factory: everything except overrides is inert. */
function mk(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: 1,
    url: 'https://example.com',
    title: 'example',
    tags: [],
    note: '',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('scoreBookmark', () => {
  it('scores a contiguous title match at index 0 as the full title weight', () => {
    expect(scoreBookmark('alp', mk({ title: 'alpha' }))).toBe(FIELD_WEIGHTS.title);
  });

  it('is case-insensitive', () => {
    expect(scoreBookmark('ALP', mk({ title: 'alpha' }))).toBe(FIELD_WEIGHTS.title);
    expect(scoreBookmark('alp', mk({ title: 'Alpha' }))).toBe(FIELD_WEIGHTS.title);
  });

  it('scores a scattered subsequence lower than a contiguous one', () => {
    // "ap" against "alpha": positions 0 and 3 -> two runs of 1 -> density 0.5.
    // (The neutral url keeps this a title-only match.)
    expect(scoreBookmark('ap', mk({ title: 'alpha', url: 'https://x.dev' }))).toBe(
      FIELD_WEIGHTS.title * 0.5,
    );
    expect(scoreBookmark('ap', mk({ title: 'alpha', url: 'https://x.dev' }))).toBeLessThan(
      scoreBookmark('al', mk({ title: 'alpha', url: 'https://x.dev' })),
    );
  });

  it('penalizes matches buried deep in the field', () => {
    const early = scoreBookmark('al', mk({ title: 'alxx' }));
    const late = scoreBookmark('al', mk({ title: 'xxal' }));
    expect(late).toBeLessThan(early);
    expect(late).toBeGreaterThan(0);
  });

  it('weights title > tag > url > note for identical match quality', () => {
    const titleHit = scoreBookmark('kent', mk({ title: 'kent' }));
    const tagHit = scoreBookmark('kent', mk({ tags: ['kent'] }));
    const urlHit = scoreBookmark('kent', mk({ url: 'https://kent' }));
    const noteHit = scoreBookmark('kent', mk({ note: 'kent' }));
    expect(titleHit).toBeGreaterThan(tagHit);
    expect(tagHit).toBeGreaterThan(urlHit);
    expect(urlHit).toBeGreaterThan(noteHit);
    expect(noteHit).toBe(FIELD_WEIGHTS.note);
  });

  it('scores each tag on its own and takes the best tag match', () => {
    // "gol" matches the tag "golang" contiguously at index 0 -> full weight.
    expect(scoreBookmark('gol', mk({ tags: ['go', 'golang'] }))).toBe(FIELD_WEIGHTS.tag);
  });

  it('adds up hits from several fields', () => {
    const both = scoreBookmark('go', mk({ title: 'go', url: 'https://go.dev' }));
    const titleOnly = scoreBookmark('go', mk({ title: 'go', url: 'https://x.dev' }));
    expect(both).toBeGreaterThan(titleOnly);
    expect(titleOnly).toBe(FIELD_WEIGHTS.title);
  });

  it('returns 0 when the query is not a subsequence of any field', () => {
    expect(scoreBookmark('zzzq', mk({ title: 'alpha' }))).toBe(0);
  });

  it('returns 0 for an empty or whitespace-only query', () => {
    expect(scoreBookmark('', mk({ title: 'alpha' }))).toBe(0);
    expect(scoreBookmark('   ', mk({ title: 'alpha' }))).toBe(0);
  });
});

describe('searchBookmarks', () => {
  const decoy = mk({ id: 99, url: 'https://other.dev', title: 'other' });

  it('finds a bookmark from a fragment of its title', () => {
    const target = mk({ id: 1, title: 'kitchen sink designs' });
    const results = searchBookmarks('ktchn', [target, decoy]);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(1);
  });

  it('finds a bookmark from a fragment of a tag', () => {
    const target = mk({ id: 1, tags: ['kitchen'] });
    const results = searchBookmarks('ktchn', [target, decoy]);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(1);
  });

  it('finds a bookmark from a fragment of its URL', () => {
    const target = mk({ id: 1, url: 'https://kitchen.example/sink' });
    const results = searchBookmarks('ktchn', [target, decoy]);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(1);
  });

  it('finds a bookmark from a fragment of its note', () => {
    const target = mk({ id: 1, note: 'kitchen renovation checklist' });
    const results = searchBookmarks('ktchn', [target, decoy]);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe(1);
  });

  it('sorts by score descending', () => {
    const titleHit = mk({ id: 1, title: 'kent' }); // weight 100
    const noteHit = mk({ id: 2, note: 'kent' }); // weight 20
    const results = searchBookmarks('kent', [noteHit, titleHit]);
    expect(results.map((b) => b.id)).toEqual([1, 2]);
  });

  it('breaks score ties with the newer bookmark first', () => {
    const older = mk({
      id: 1,
      title: 'alpha',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    const newer = mk({
      id: 2,
      title: 'alpha',
      created_at: '2026-02-01T00:00:00.000Z',
    });
    // Identical field content -> identical scores; created_at decides.
    const results = searchBookmarks('alp', [older, newer]);
    expect(results.map((b) => b.id)).toEqual([2, 1]);
    // And input order must not matter.
    expect(searchBookmarks('alp', [newer, older]).map((b) => b.id)).toEqual([2, 1]);
  });

  it('breaks full ties (same score and same timestamp) by higher id first', () => {
    const a = mk({ id: 1, title: 'alpha' });
    const b = mk({ id: 2, title: 'alpha' });
    const results = searchBookmarks('alp', [a, b]);
    expect(results.map((x) => x.id)).toEqual([2, 1]);
  });

  it('excludes non-matching bookmarks and returns [] for a blank query', () => {
    const target = mk({ title: 'alpha' });
    expect(searchBookmarks('zzz', [target, decoy])).toEqual([]);
    expect(searchBookmarks('', [target])).toEqual([]);
    expect(searchBookmarks('   ', [target])).toEqual([]);
  });
});
