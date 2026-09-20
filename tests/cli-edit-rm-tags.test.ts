import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { runRm } from '../src/commands/rm.js';
import { CliSandbox, createCliSandbox } from './helpers.js';

let sb: CliSandbox;
beforeEach(() => {
  sb = createCliSandbox();
});
afterEach(() => {
  sb.cleanup();
});

const storePath = () => sb.storePath();
const bm = (...args: string[]) => sb.bm(...args);
const bmAnswer = (answer: string, ...args: string[]) => sb.bmAnswer(answer, ...args);

interface StoredBookmark {
  id: number;
  url: string;
  title: string;
  tags: string[];
  note: string;
  created_at: string;
  updated_at: string;
}

function readStore(): { bookmarks: StoredBookmark[]; nextId: number } {
  return JSON.parse(readFileSync(storePath(), 'utf8'));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('cli edit smoke', () => {
  it('edit --tags replaces the tag set entirely; untouched fields survive', async () => {
    await bm('add', 'https://example.com', '--title', 'Old', '--tags', 'demo,a', '--note', 'keep');

    const res = await bm('edit', '1', '--tags', 'x,y');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('#1');

    const after = readStore();
    expect(after.bookmarks).toHaveLength(1);
    // Full replacement: the old tags are gone, the set is exactly [x, y].
    expect(after.bookmarks[0].tags).toEqual(['x', 'y']);
    // Fields not passed on the command line are untouched.
    expect(after.bookmarks[0].title).toBe('Old');
    expect(after.bookmarks[0].note).toBe('keep');
    expect(after.bookmarks[0].url).toBe('https://example.com/');

    // --tags "" clears the tag set (still full-replacement semantics).
    const cleared = await bm('edit', '1', '--tags', '');
    expect(cleared.code).toBe(0);
    expect(readStore().bookmarks[0].tags).toEqual([]);
  });

  it('edit refreshes updated_at and leaves created_at unchanged', async () => {
    await bm('add', 'https://example.com');
    const before = readStore().bookmarks[0];
    expect(before.created_at).toBe(before.updated_at);

    // ISO timestamps have millisecond precision; make sure the clock moved.
    await sleep(50);
    const res = await bm('edit', '1', '--title', 'New Title');
    expect(res.code).toBe(0);

    const after = readStore().bookmarks[0];
    expect(after.created_at).toBe(before.created_at);
    expect(after.title).toBe('New Title');
    expect(after.updated_at).not.toBe(before.updated_at);
    expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.created_at));
  });

  it('edit on a missing id errors with a non-zero exit and changes nothing', async () => {
    await bm('add', 'https://example.com');
    const before = readStore();

    const res = await bm('edit', '99', '--title', 'x');
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('No bookmark with id 99');
    expect(readStore()).toEqual(before);
  });

  it('edit rejects a non-numeric id and an edit with no fields', async () => {
    await bm('add', 'https://example.com');

    const badId = await bm('edit', 'abc', '--title', 'x');
    expect(badId.code).not.toBe(0);
    expect(badId.stderr).toContain('Invalid id');

    const noFields = await bm('edit', '1');
    expect(noFields.code).not.toBe(0);
    expect(noFields.stderr).toContain('Nothing to edit');
  });
});

describe('cli rm smoke', () => {
  it('prompts by default; answering n keeps the bookmark and exits 0', async () => {
    await bm('add', 'https://example.com', '--title', 'Example');

    const res = await bmAnswer('n', 'rm', '1');
    expect(res.code).toBe(0);
    // One-line confirmation names the bookmark (title or URL), then decline.
    expect(res.stdout).toContain('Delete #1');
    expect(res.stdout).toContain('https://example.com');
    expect(res.stdout.toLowerCase()).toContain('not deleted');
    expect(readStore().bookmarks).toHaveLength(1);
  });

  it('answering y at the prompt deletes the bookmark', async () => {
    await bm('add', 'https://example.com');

    const res = await bmAnswer('y', 'rm', '1');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Deleted #1');
    expect(readStore().bookmarks).toEqual([]);
  });

  it('-y (and --yes) skips the prompt and deletes directly', async () => {
    await bm('add', 'https://one.dev');
    await bm('add', 'https://two.dev');

    const res = await bm('rm', '2', '-y');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Deleted #2');
    expect(res.stdout).not.toContain('[y/N]');
    expect(readStore().bookmarks.map((b) => b.url)).toEqual(['https://one.dev/']);

    const long = await bm('rm', '--yes', '1');
    expect(long.code).toBe(0);
    expect(long.stdout).toContain('Deleted #1');
    expect(readStore().bookmarks).toEqual([]);
  });

  it('rm on a missing id errors with a non-zero exit, without prompting', async () => {
    await bm('add', 'https://example.com');

    const res = await bm('rm', '99', '-y');
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('No bookmark with id 99');
    expect(res.stdout).not.toContain('[y/N]');
    expect(readStore().bookmarks).toHaveLength(1);
  });
});

describe('rm confirmation seam (injected reader, no terminal)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bm-rm-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function seedOne(): Promise<Store> {
    const store = Store.load(join(dir, 'bookmarks.json'));
    store.add({ url: 'https://example.com', title: 'Example', tags: ['demo'], note: '' });
    return store;
  }

  it('keeps the bookmark on a declined or EOF answer; deletes on y', async () => {
    for (const answer of ['n', '', 'Y']) {
      const store = await seedOne();
      await runRm('1', {}, { store, readAnswer: async () => answer });
      expect(store.all()).toHaveLength(1);
      expect(store.all()[0].id).toBe(1);
    }

    const store = await seedOne();
    const prompts: string[] = [];
    await runRm('1', {}, {
      store,
      readAnswer: async (prompt) => {
        prompts.push(prompt);
        return 'y';
      },
    });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Delete #1');
    expect(store.all()).toEqual([]);
    // The deletion is persisted to disk.
    expect(Store.load(join(dir, 'bookmarks.json')).all()).toEqual([]);
  });
});

describe('cli tags smoke', () => {
  it('lists tags with counts, count desc then codepoint asc for ties', async () => {
    await bm('add', 'https://first.dev', '--tags', 'red,shared');
    await bm('add', 'https://second.dev', '--tags', 'blue');
    await bm('add', 'https://third.dev', '--tags', 'shared');
    await bm('add', 'https://fourth.dev', '--tags', 'Apple,shared');

    const res = await bm('tags');
    expect(res.code).toBe(0);
    const rows = res.stdout
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => {
        const m = l.match(/^(\d+)\s{2}(.+)$/);
        expect(m, `unparsable tags line: ${l}`).toBeDefined();
        return { count: Number(m![1]), tag: m![2] };
      });

    // shared=3 tops the list; the count-1 ties sort in codepoint order
    // ('A' < 'b' < 'r' — uppercase first, i.e. NOT locale "alphabetical").
    expect(rows).toEqual([
      { count: 3, tag: 'shared' },
      { count: 1, tag: 'Apple' },
      { count: 1, tag: 'blue' },
      { count: 1, tag: 'red' },
    ]);
  });

  it('prints nothing and exits 0 on an empty store', async () => {
    const res = await bm('tags');
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('');
  });
});
