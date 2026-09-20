import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DuplicateUrlError,
  Store,
  emptyStore,
  resolveStorePath,
} from '../src/store.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bm-store-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveStorePath (platform conventions)', () => {
  it('windows: %APPDATA%\\bookmark-cli\\bookmarks.json', () => {
    const appData = join(dir, 'AppData', 'Roaming');
    expect(resolveStorePath({ APPDATA: appData } as NodeJS.ProcessEnv, 'win32')).toBe(
      join(appData, 'bookmark-cli', 'bookmarks.json'),
    );
  });

  it('macOS: ~/Library/Application Support/bookmark-cli/bookmarks.json', () => {
    const home = join(dir, 'home');
    expect(resolveStorePath({ HOME: home } as NodeJS.ProcessEnv, 'darwin')).toBe(
      join(home, 'Library', 'Application Support', 'bookmark-cli', 'bookmarks.json'),
    );
  });

  it('linux: honors $XDG_CONFIG_HOME', () => {
    const xdg = join(dir, 'xdg-config');
    expect(resolveStorePath({ XDG_CONFIG_HOME: xdg, HOME: join(dir, 'h') } as NodeJS.ProcessEnv, 'linux')).toBe(
      join(xdg, 'bookmark-cli', 'bookmarks.json'),
    );
  });

  it('linux: falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    const home = join(dir, 'home');
    expect(resolveStorePath({ HOME: home } as NodeJS.ProcessEnv, 'linux')).toBe(
      join(home, '.config', 'bookmark-cli', 'bookmarks.json'),
    );
  });
});

describe('Store read/write', () => {
  it('loads an empty store when the file does not exist', () => {
    const store = Store.load(join(dir, 'bookmarks.json'));
    expect(store.all()).toEqual([]);
    expect(store.listNewestFirst()).toEqual([]);
  });

  it('loads an empty store from a blank file', () => {
    const file = join(dir, 'bookmarks.json');
    writeFileSync(file, '   \n', 'utf8');
    expect(Store.load(file).all()).toEqual([]);
  });

  it('roundtrips and writes human-readable 2-space JSON with a trailing newline', () => {
    const file = join(dir, 'bookmarks.json');
    const store = new Store(file, emptyStore());
    store.add({
      url: 'https://example.com',
      title: 'Example',
      tags: ['demo'],
      note: 'hi',
      now: new Date('2026-09-19T00:00:00.000Z'),
    });
    store.save();

    const raw = readFileSync(file, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('{\n  "bookmarks": [');
    expect(raw).toContain('"url": "https://example.com/"');

    const reloaded = Store.load(file);
    expect(reloaded.all()).toHaveLength(1);
    expect(reloaded.all()[0]).toMatchObject({
      id: 1,
      url: 'https://example.com/',
      title: 'Example',
      tags: ['demo'],
      note: 'hi',
      created_at: '2026-09-19T00:00:00.000Z',
      updated_at: '2026-09-19T00:00:00.000Z',
    });
  });

  it('creates the parent directory on save', () => {
    const file = join(dir, 'nested', 'deeper', 'bookmarks.json');
    const store = new Store(file, emptyStore());
    store.add({ url: 'https://a.dev', title: 'a', tags: [], note: '' });
    store.save();
    expect(Store.load(file).getByUrl('https://a.dev')).toBeDefined();
  });

  it('throws a clear error on a corrupted store file', () => {
    const file = join(dir, 'bookmarks.json');
    writeFileSync(file, '{ not json', 'utf8');
    expect(() => Store.load(file)).toThrow(/corrupted/);
  });
});

describe('Store duplicate-URL identity', () => {
  it('rejects adding the same URL twice and reports the existing id', () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    store.add({ url: 'https://example.com', title: 'x', tags: [], note: '' });
    store.add({ url: 'https://other.com', title: 'y', tags: [], note: '' });
    try {
      store.add({ url: 'https://example.com', title: 'z', tags: [], note: '' });
      expect.unreachable('should have thrown DuplicateUrlError');
    } catch (err) {
      expect(err).toBeInstanceOf(DuplicateUrlError);
      expect((err as DuplicateUrlError).existingId).toBe(1);
    }
    expect(store.all()).toHaveLength(2);
  });
});

describe('Store id assignment (monotonic, never reused)', () => {
  it('assigns sequential ids starting at 1', () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    const a = store.add({ url: 'https://a.dev', title: 'a', tags: [], note: '' });
    const b = store.add({ url: 'https://b.dev', title: 'b', tags: [], note: '' });
    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
  });

  it('does not reuse the id of a removed bookmark', () => {
    const file = join(dir, 'bookmarks.json');
    const store = new Store(file, emptyStore());
    store.add({ url: 'https://a.dev', title: 'a', tags: [], note: '' });
    store.add({ url: 'https://b.dev', title: 'b', tags: [], note: '' });
    expect(store.remove(2)).toBe(true);
    store.save();

    const reloaded = Store.load(file);
    const next = reloaded.add({ url: 'https://c.dev', title: 'c', tags: [], note: '' });
    reloaded.save();
    expect(next.id).toBe(3);
    expect(Store.load(file).all().map((b) => b.id)).toEqual([1, 3]);
  });

  it('trusts the persisted counter over the max id present in the file', () => {
    // Hand-crafted store: max existing id is 2 but the counter is at 5
    // (ids 3 and 4 were deleted earlier). The next add must be 5.
    const file = join(dir, 'bookmarks.json');
    writeFileSync(
      file,
      JSON.stringify(
        {
          bookmarks: [
            {
              id: 1,
              url: 'https://a.dev',
              title: 'a',
              tags: [],
              note: '',
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 2,
              url: 'https://b.dev',
              title: 'b',
              tags: [],
              note: '',
              created_at: '2026-01-02T00:00:00.000Z',
              updated_at: '2026-01-02T00:00:00.000Z',
            },
          ],
          nextId: 5,
        },
        null,
        2,
      ),
      'utf8',
    );
    const next = Store.load(file).add({ url: 'https://e.dev', title: 'e', tags: [], note: '' });
    expect(next.id).toBe(5);
  });
});

describe('Store update semantics', () => {
  it('patches only provided fields and refreshes updated_at, never created_at', () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    store.add({
      url: 'https://example.com',
      title: 'old',
      tags: ['old'],
      note: 'old',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    const updated = store.update(
      1,
      { title: 'new', tags: ['new1', 'new2'] },
      new Date('2026-02-02T00:00:00.000Z'),
    );
    expect(updated).toMatchObject({
      title: 'new',
      tags: ['new1', 'new2'],
      note: 'old',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-02-02T00:00:00.000Z',
    });
  });

  it('throws when updating a missing id', () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    expect(() => store.update(99, { title: 'x' })).toThrow(/No bookmark with id 99/);
  });
});

describe('Store ordering', () => {
  it('lists newest first, ties broken by higher id first', () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    const sameTime = new Date('2026-09-19T00:00:00.000Z');
    store.add({ url: 'https://a.dev', title: 'a', tags: [], note: '', now: new Date('2026-09-01T00:00:00.000Z') });
    store.add({ url: 'https://b.dev', title: 'b', tags: [], note: '', now: sameTime });
    store.add({ url: 'https://c.dev', title: 'c', tags: [], note: '', now: sameTime });
    store.add({ url: 'https://d.dev', title: 'd', tags: [], note: '', now: new Date('2026-09-18T00:00:00.000Z') });
    expect(store.listNewestFirst().map((b) => b.url)).toEqual([
      'https://c.dev/',
      'https://b.dev/',
      'https://d.dev/',
      'https://a.dev/',
    ]);
  });
});

describe('Store canonical identity (ADR-0003)', () => {
  it('stores the canonical form and treats case/port variants as the same bookmark', () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    const added = store.add({
      url: 'HTTPS://Example.COM:443',
      title: 'x',
      tags: [],
      note: '',
    });
    expect(added.url).toBe('https://example.com/');
    expect(store.getByUrl('https://example.com')).toBeDefined();
    expect(() =>
      store.add({ url: 'https://example.com/', title: 'y', tags: [], note: '' }),
    ).toThrow(DuplicateUrlError);
  });

  it('defensively rejects non-web URLs at the seam', () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    expect(() => store.add({ url: 'place:folder=MENU', title: 'x', tags: [], note: '' })).toThrow(
      /Not a bookmarkable URL/,
    );
    expect(store.getByUrl('javascript:alert(1)')).toBeUndefined();
  });
});

describe('Store load migration (legacy data)', () => {
  function writeLegacyStore(file: string): void {
    writeFileSync(
      file,
      JSON.stringify(
        {
          bookmarks: [
            {
              id: 1,
              url: 'https://Example.com',
              title: 'older title',
              tags: ['a'],
              note: '',
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 2,
              url: 'https://example.com/',
              title: 'newer title',
              tags: ['b'],
              note: 'kept note',
              created_at: '2026-01-02T00:00:00.000Z',
              updated_at: '2026-01-02T00:00:00.000Z',
            },
            {
              id: 3,
              url: 'place:folder=BOOKMARK_MENU',
              title: 'firefox internal',
              tags: [],
              note: '',
              created_at: '2026-01-03T00:00:00.000Z',
              updated_at: '2026-01-03T00:00:00.000Z',
            },
            {
              id: 4,
              url: 'https://other.dev/',
              title: 'untouched',
              tags: [],
              note: '',
              created_at: '2026-01-04T00:00:00.000Z',
              updated_at: '2026-01-04T00:00:00.000Z',
            },
          ],
          nextId: 5,
        },
        null,
        2,
      ),
      'utf8',
    );
  }

  it('merges case-variant duplicates and drops non-web links, reporting both to stderr', () => {
    const file = join(dir, 'bookmarks.json');
    writeLegacyStore(file);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = Store.load(file);

    expect(store.all()).toHaveLength(2);
    const merged = store.getById(1);
    expect(merged).toMatchObject({
      id: 1,
      url: 'https://example.com/',
      title: 'older title',
      tags: ['a', 'b'],
      note: 'kept note',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(store.all().map((b) => b.id)).toEqual([1, 4]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0]).toContain('merged 1 duplicate bookmark');
    expect(err.mock.calls[0][0]).toContain('removed 1 non-web link');

    // Persisted: the next load is already canonical, so the notice self-extinguishes.
    store.save();
    err.mockClear();
    const reloaded = Store.load(file);
    expect(reloaded.all()).toHaveLength(2);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('is silent when the file is already canonical', () => {
    const file = join(dir, 'bookmarks.json');
    const store = new Store(file, emptyStore());
    store.add({ url: 'https://a.dev/', title: 'a', tags: [], note: '' });
    store.save();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    Store.load(file);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
