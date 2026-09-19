import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Store } from '../src/store.js';
import { CliSandbox, createCliSandbox } from './helpers.js';

let sb: CliSandbox;
beforeEach(() => {
  // BM_NO_TITLE_FETCH keeps these subprocess adds hermetic: since T2 the
  // default add fetches the page title, which these tests must not do.
  sb = createCliSandbox({ noTitleFetch: true });
});
afterEach(() => {
  sb.cleanup();
});

const storePath = () => sb.storePath();
const bm = (...args: string[]) => sb.bm(...args);

describe('cli add/list smoke', () => {
  it('add -> duplicate error with existing id -> --force updates in place', async () => {
    // 1. First add succeeds.
    const added = await bm(
      'add',
      'https://example.com',
      '--tags',
      'demo,a',
      '--note',
      'first',
    );
    expect(added.code).toBe(0);
    expect(added.stdout).toContain('#1');
    expect(added.stdout).toContain('https://example.com');

    // 2. Same URL again (no --force): non-zero exit, error on stderr naming the id.
    const dup = await bm('add', 'https://example.com', '--title', 'whatever');
    expect(dup.code).not.toBe(0);
    expect(dup.stderr).toContain('#1');
    expect(dup.stderr.toLowerCase()).toContain('already exists');

    // 3. --force updates the existing bookmark instead of adding a second one.
    const forced = await bm(
      'add',
      'https://example.com',
      '--force',
      '--title',
      'Example Domain',
      '--tags',
      'refreshed',
      '--note',
      'updated note',
    );
    expect(forced.code).toBe(0);
    expect(forced.stdout).toContain('#1');

    // Storage: exactly one entry for the URL, fields updated, human-readable JSON.
    const file = storePath();
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain('"url": "https://example.com"');
    expect(raw).toContain('"title": "Example Domain"');
    expect(raw.match(/https:\/\/example\.com/g)).toHaveLength(1);
    const parsed = JSON.parse(raw) as { bookmarks: Array<Record<string, unknown>> };
    expect(parsed.bookmarks).toHaveLength(1);
    expect(parsed.bookmarks[0]).toMatchObject({
      id: 1,
      title: 'Example Domain',
      tags: ['refreshed'],
      note: 'updated note',
    });
  });

  it('falls back to the URL host as title when --title is not given', async () => {
    const res = await bm('add', 'https://nodejs.org/en');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('(nodejs.org)');
    const raw = readFileSync(storePath(), 'utf8');
    expect(raw).toContain('"title": "nodejs.org"');
  });

  it('rejects non-http(s) URLs with a non-zero exit', async () => {
    const res = await bm('add', 'ftp://example.com/file');
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Only http(s)');
    expect(existsSync(storePath())).toBe(false);
  });

  it('never reuses ids across a fresh process after the max-id bookmark is deleted', async () => {
    await bm('add', 'https://one.dev');
    await bm('add', 'https://two.dev');
    // Simulate deletion of the max-id bookmark (rm lands in a later ticket):
    // rewrite the store through the Store API, keeping the counter intact.
    const file = storePath();
    const store = Store.load(file);
    expect(store.remove(2)).toBe(true);
    store.save();

    const res = await bm('add', 'https://three.dev');
    expect(res.code).toBe(0);
    // New id must be 3, not 2: the counter only ever moves forward.
    expect(res.stdout).toContain('#3');
    const after = JSON.parse(readFileSync(file, 'utf8')) as {
      bookmarks: Array<{ id: number }>;
    };
    expect(after.bookmarks.map((b) => b.id).sort((a, b) => a - b)).toEqual([1, 3]);
  });

  it('list: newest first, --tag filters, --json is machine readable', async () => {
    await bm('add', 'https://first.dev', '--tags', 'red,shared');
    await bm('add', 'https://second.dev', '--tags', 'blue');
    await bm('add', 'https://third.dev', '--tags', 'shared');

    // Newest first: third appears before second appears before first.
    const listed = await bm('list');
    expect(listed.code).toBe(0);
    const positions = ['https://third.dev', 'https://second.dev', 'https://first.dev'].map(
      (url) => listed.stdout.indexOf(url),
    );
    expect(positions[0]).toBeGreaterThan(-1);
    expect(positions[1]).toBeGreaterThan(positions[0]);
    expect(positions[2]).toBeGreaterThan(positions[1]);

    // --tag keeps only bookmarks carrying the exact tag.
    const tagged = await bm('list', '--tag', 'shared');
    expect(tagged.code).toBe(0);
    expect(tagged.stdout).toContain('https://third.dev');
    expect(tagged.stdout).toContain('https://first.dev');
    expect(tagged.stdout).not.toContain('https://second.dev');

    // --json output parses and carries full storage fields.
    const asJson = await bm('list', '--json');
    expect(asJson.code).toBe(0);
    const arr = JSON.parse(asJson.stdout) as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(3);
    expect(arr[0]).toMatchObject({ url: 'https://third.dev' });
    for (const key of ['id', 'url', 'title', 'tags', 'note', 'created_at', 'updated_at']) {
      expect(key in arr[0]).toBe(true);
    }
  });

  it('list --tag with no matches prints nothing and exits 0', async () => {
    await bm('add', 'https://solo.dev', '--tags', 'only');
    const res = await bm('list', '--tag', 'nope');
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('');
  });
});
