import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { Store } from '../src/store.js';
import { runOpen } from '../src/commands/open.js';
import { runSearch } from '../src/commands/search.js';
import { Opener } from '../src/opener.js';
import { CliError } from '../src/types.js';
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

async function seed(): Promise<void> {
  await bm(
    'add',
    'https://rust-lang.org',
    '--title',
    'The Rust Programming Language',
    '--tags',
    'lang,systems',
  );
  await bm('add', 'https://developer.mozilla.org', '--title', 'MDN Web Docs', '--note', 'css reference');
  await bm('add', 'https://example.com/note', '--note', 'standup meeting notes');
}

// ---------------------------------------------------------------------------
// Subprocess smoke tests (dist build). None of these exercise a successful
// open — the success paths live below with an injected fake opener, so no
// test ever launches a real browser.
// ---------------------------------------------------------------------------
describe('cli search/open smoke', () => {
  it('search finds bookmarks from a title fragment and prints id, title, url', async () => {
    await seed();
    const res = await bm('search', 'rust');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('#1');
    expect(res.stdout).toContain('The Rust Programming Language');
    expect(res.stdout).toContain('https://rust-lang.org');
  });

  it('search finds bookmarks from URL and note fragments', async () => {
    await seed();
    const byUrl = await bm('search', 'mozil');
    expect(byUrl.code).toBe(0);
    expect(byUrl.stdout).toContain('#2');
    expect(byUrl.stdout).toContain('https://developer.mozilla.org');

    const byNote = await bm('search', 'stdup');
    expect(byNote.code).toBe(0);
    expect(byNote.stdout).toContain('#3');
    expect(byNote.stdout).toContain('https://example.com/note');
  });

  it('search orders results best score first, ties newest first', async () => {
    await bm('add', 'https://first.dev', '--tags', 'shared');
    await bm('add', 'https://second.dev', '--tags', 'shared');
    const res = await bm('search', 'shared');
    expect(res.code).toBe(0);
    // Both match only via the identical tag -> same score -> newer first.
    const second = res.stdout.indexOf('https://second.dev');
    const first = res.stdout.indexOf('https://first.dev');
    expect(second).toBeGreaterThan(-1);
    expect(first).toBeGreaterThan(second);
  });

  it('search with no matches prints nothing and exits 0', async () => {
    await seed();
    const res = await bm('search', 'zzznomatch');
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('');
  });

  it('search --json emits a jq-parseable array of full bookmark objects', async () => {
    await seed();
    const res = await bm('search', 'rust', '--json');
    expect(res.code).toBe(0);
    const arr = JSON.parse(res.stdout) as Array<Record<string, unknown>>;
    expect(arr).toHaveLength(1);
    expect(arr[0]).toMatchObject({
      id: 1,
      url: 'https://rust-lang.org',
      title: 'The Rust Programming Language',
      tags: ['lang', 'systems'],
    });
    for (const key of ['id', 'url', 'title', 'tags', 'note', 'created_at', 'updated_at']) {
      expect(key in (arr[0] as object)).toBe(true);
    }
    // A no-match --json search is an empty array, still valid JSON.
    const empty = await bm('search', 'zzznomatch', '--json');
    expect(empty.code).toBe(0);
    expect(JSON.parse(empty.stdout)).toEqual([]);
  });

  it('search --open with no matches errors on stderr with a non-zero exit', async () => {
    await seed();
    const res = await bm('search', 'zzznomatch', '--open');
    expect(res.code).not.toBe(0);
    expect(res.stderr.toLowerCase()).toContain('no bookmark matches');
  });

  it('open with a non-existent id errors on stderr with a non-zero exit', async () => {
    await seed();
    const res = await bm('open', '999');
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('999');
  });

  it('open with a non-numeric id errors with a non-zero exit', async () => {
    await seed();
    const res = await bm('open', 'abc');
    expect(res.code).not.toBe(0);
    // Same parseId (and therefore same wording) as edit/rm.
    expect(res.stderr.toLowerCase()).toContain('invalid id');
  });
});

// ---------------------------------------------------------------------------
// In-process tests with an injected fake opener: this is how the successful
// open paths are asserted without ever launching a real browser.
// ---------------------------------------------------------------------------
describe('search --open / open <id> with an injected opener', () => {
  let store: Store;
  let openedUrls: string[];
  let fakeOpener: Opener;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store = Store.load(join(sb.dataDir, 'bookmarks.json'));
    store.add({
      url: 'https://rust-lang.org',
      title: 'The Rust Programming Language',
      tags: ['lang'],
      note: '',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    store.add({
      url: 'https://example.com/rust-notes',
      title: 'example.com',
      tags: [],
      note: 'rust notes for later reading',
      now: new Date('2026-02-01T00:00:00.000Z'),
    });
    store.save();
    openedUrls = [];
    fakeOpener = (url: string) => {
      openedUrls.push(url);
    };
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it('search --open opens exactly the top-ranked result', async () => {
    // The title hit (weight 100) outranks the note hit (weight 20), even
    // though the note bookmark is newer.
    await runSearch('rust', { open: true }, { store, opener: fakeOpener });
    expect(openedUrls).toEqual(['https://rust-lang.org']);
    expect(logSpy).toHaveBeenCalledWith('Opened #1 https://rust-lang.org');
  });

  it('search --open --json keeps stdout pure JSON; the open notice goes to stderr', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runSearch('rust', { open: true, json: true }, { store, opener: fakeOpener });
      expect(openedUrls).toEqual(['https://rust-lang.org']);
      // stdout saw exactly one write and it parses as the JSON array — no
      // human notice ahead of the payload (that is the --json contract).
      expect(logSpy).toHaveBeenCalledTimes(1);
      const arr = JSON.parse(logSpy.mock.calls[0]![0] as string) as unknown[];
      expect(arr).toHaveLength(2);
      // The notice is kept, on stderr.
      expect(errSpy).toHaveBeenCalledWith('Opened #1 https://rust-lang.org');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('search --open with no matches raises a CliError without opening', async () => {
    await expect(
      runSearch('zzznomatch', { open: true }, { store, opener: fakeOpener }),
    ).rejects.toThrow(CliError);
    expect(openedUrls).toEqual([]);
  });

  it('open <id> opens the url of that bookmark', async () => {
    await runOpen('2', { store, opener: fakeOpener });
    expect(openedUrls).toEqual(['https://example.com/rust-notes']);
    expect(logSpy).toHaveBeenCalledWith('Opened #2 https://example.com/rust-notes');
  });

  it('open with a non-existent id raises a CliError without opening', async () => {
    await expect(runOpen('999', { store, opener: fakeOpener })).rejects.toThrow(
      CliError,
    );
    expect(openedUrls).toEqual([]);
  });

  it('open with a malformed id raises a CliError without opening', async () => {
    await expect(runOpen('abc', { store, opener: fakeOpener })).rejects.toThrow(
      CliError,
    );
    expect(openedUrls).toEqual([]);
  });

  it('surfaces opener failures as CliError', async () => {
    const failingOpener: Opener = () => {
      throw new Error('no handler');
    };
    await expect(runOpen('1', { store, opener: failingOpener })).rejects.toThrow(
      CliError,
    );
    await expect(
      runSearch('rust', { open: true }, { store, opener: failingOpener }),
    ).rejects.toThrow(CliError);
  });
});
