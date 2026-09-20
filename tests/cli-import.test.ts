import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bookmark, StoreData } from '../src/types.js';
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

function writeFixture(name: string, content: string): string {
  const file = join(sb.dataDir, name);
  writeFileSync(file, content, 'utf8');
  return file;
}

function readStore(): StoreData {
  return JSON.parse(readFileSync(storePath(), 'utf8')) as StoreData;
}

function storeByUrl(): Map<string, Bookmark> {
  return new Map(readStore().bookmarks.map((b) => [b.url, b]));
}

const BROWSER_HTML = [
  '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
  '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
  '<TITLE>Bookmarks</TITLE>',
  '<H1>Bookmarks</H1>',
  '<DL><p>',
  '    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">书签栏</H3>',
  '    <DL><p>',
  '        <DT><H3>开发</H3>',
  '        <DL><p>',
  '            <DT><A HREF="https://nodejs.org/" ADD_DATE="1700000000">Node.js</A>',
  '        </DL><p>',
  '        <DT><A HREF="https://news.ycombinator.com/" ADD_DATE="1600000000">Hacker News</A>',
  '    </DL><p>',
  '    <DT><A HREF="https://example.com/" ADD_DATE="123">Example Domain</A>',
  '</DL><p>',
].join('\n');

describe('cli import smoke', () => {
  it('imports browser HTML: folder paths become tags, ADD_DATE becomes created_at', async () => {
    const file = writeFixture('bookmarks.html', BROWSER_HTML);
    const res = await bm('import', file);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 3 new bookmarks, skipped 0 duplicate URLs.');

    const store = readStore();
    expect(store.nextId).toBe(4);
    const byUrl = new Map(store.bookmarks.map((b) => [b.url, b]));
    expect(byUrl.get('https://nodejs.org/')?.tags).toEqual(['书签栏', '开发']);
    expect(byUrl.get('https://nodejs.org/')?.title).toBe('Node.js');
    expect(byUrl.get('https://nodejs.org/')?.created_at).toBe('2023-11-14T22:13:20.000Z');
    expect(byUrl.get('https://news.ycombinator.com/')?.tags).toEqual(['书签栏']);
    expect(byUrl.get('https://example.com/')?.tags).toEqual([]);
  });

  it('skips a URL already stored even when the title differs, and reports counts', async () => {
    await bm('add', 'https://nodejs.org/', '--title', 'Different title');
    const before = readStore();

    const file = writeFixture('bookmarks.html', BROWSER_HTML);
    const res = await bm('import', file);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 2 new bookmarks, skipped 1 duplicate URL.');

    // The live entry is untouched (identity rule: skip, never overwrite).
    expect(storeByUrl().get('https://nodejs.org/')?.title).toBe('Different title');
    const after = readStore();
    expect(after.bookmarks).toHaveLength(3);
    expect(after.bookmarks.find((b) => b.url === 'https://nodejs.org/')).toEqual(
      before.bookmarks[0],
    );
  });

  it('re-importing the same file is a no-op with everything skipped', async () => {
    const file = writeFixture('bookmarks.html', BROWSER_HTML);
    await bm('import', file);
    const afterFirst = readFileSync(storePath(), 'utf8');

    const res = await bm('import', file);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 0 new bookmarks, skipped 3 duplicate URLs.');
    expect(readFileSync(storePath(), 'utf8')).toBe(afterFirst);
  });

  it('merges tags when one file bookmarks the same URL in several folders', async () => {
    const html = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<DL><p>',
      '    <DT><H3>docs</H3>',
      '    <DL><p>',
      '        <DT><A HREF="https://mdn.example/" ADD_DATE="1700000001">MDN</A>',
      '    </DL><p>',
      '    <DT><H3>dev</H3>',
      '    <DL><p>',
      '        <DT><A HREF="https://mdn.example/" ADD_DATE="1700000002">MDN again</A>',
      '        <DT><A HREF="https://rust.example/" ADD_DATE="1700000003">Rust</A>',
      '    </DL><p>',
      '</DL><p>',
    ].join('\n');
    const res = await bm('import', writeFixture('dup.html', html));
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 2 new bookmarks, skipped 1 duplicate URL.');

    const store = readStore();
    expect(store.bookmarks).toHaveLength(2);
    const mdn = storeByUrl().get('https://mdn.example/');
    // First occurrence fixes the title, both folders contribute a tag.
    expect(mdn?.title).toBe('MDN');
    expect(mdn?.tags).toEqual(['docs', 'dev']);
  });

  it('JSON round-trip: export -> delete store -> import restores a byte-identical store', async () => {
    await bm('add', 'https://one.dev/', '--title', 'One', '--tags', 'a,b', '--note', 'first');
    await bm('add', 'https://two.dev/', '--title', 'Two', '--tags', 'b');
    await bm('add', 'https://three.dev/');
    // Delete one so the id counter carries a gap that must survive the trip.
    await bm('rm', '2', '-y');
    const before = readFileSync(storePath(), 'utf8');
    expect(JSON.parse(before).nextId).toBe(4);

    const backup = join(sb.dataDir, 'backup.json');
    const exp = await bm('export', '--format', 'json', '-o', backup);
    expect(exp.code).toBe(0);
    rmSync(storePath());

    const res = await bm('import', backup);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 2 new bookmarks, skipped 0 duplicate URLs.');
    // Byte-identical: ids, the id-2 gap, nextId and every timestamp match.
    expect(readFileSync(storePath(), 'utf8')).toBe(before);
  });

  it('HTML round-trip through our own exporter: urls, titles and tags survive', async () => {
    await bm('add', 'https://single.dev/', '--title', 'Single', '--tags', 'dev');
    await bm('add', 'https://multi.dev/', '--title', 'Multi', '--tags', 'dev,前端');
    await bm('add', 'https://plain.dev/', '--title', 'Plain');
    const out = join(sb.dataDir, 'roundtrip.html');
    await bm('export', '--format', 'html', '-o', out);
    rmSync(storePath());

    const res = await bm('import', out);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 3 new bookmarks');

    const byUrl = storeByUrl();
    expect(byUrl.get('https://single.dev/')?.title).toBe('Single');
    expect(byUrl.get('https://single.dev/')?.tags).toEqual(['dev']);
    // The multi-tag bookmark has one entrance per tag folder in the export;
    // import merges both entrances back into one bookmark.
    expect([...(byUrl.get('https://multi.dev/')?.tags ?? [])].sort()).toEqual(['dev', '前端']);
    expect(byUrl.get('https://plain.dev/')?.title).toBe('Plain');
    // Untagged bookmarks export under the "无标签" presentation group, so on
    // the way back that group name becomes a real tag (documented asymmetry:
    // the Netscape format has folders only, no way to say "no tag", so the
    // presentation name and a real tag of the same wording coexist).
    expect(byUrl.get('https://plain.dev/')?.tags).toEqual(['无标签']);
  });

  it('JSON restore into a non-empty store: conflicts keep the live entry, ids stay unique', async () => {
    await bm('add', 'https://live.dev/', '--title', 'Live one'); // gets id 1
    const backup: StoreData = {
      bookmarks: [
        {
          id: 1,
          url: 'https://live.dev/',
          title: 'Backup title',
          tags: ['x'],
          note: '',
          created_at: '2024-05-01T00:00:00.000Z',
          updated_at: '2024-05-01T00:00:00.000Z',
        },
        {
          id: 7,
          url: 'https://restored.dev/',
          title: 'Restored',
          tags: ['y'],
          note: 'n',
          created_at: '2024-05-02T00:00:00.000Z',
          updated_at: '2024-05-03T00:00:00.000Z',
        },
      ],
      nextId: 8,
    };
    const file = writeFixture('backup.json', JSON.stringify(backup));

    const res = await bm('import', file);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 1 new bookmark, skipped 1 duplicate URL.');

    const store = readStore();
    // Live entry untouched; restored entry keeps its backup id and timestamps.
    const live = store.bookmarks.find((b) => b.url === 'https://live.dev/');
    expect(live?.title).toBe('Live one');
    const restored = store.bookmarks.find((b) => b.url === 'https://restored.dev/');
    expect(restored?.id).toBe(7);
    expect(restored?.created_at).toBe('2024-05-02T00:00:00.000Z');
    expect(restored?.updated_at).toBe('2024-05-03T00:00:00.000Z');
    expect(restored?.note).toBe('n');
    // The counter honors the backup's higher nextId.
    expect(store.nextId).toBe(8);
  });

  it('skips non-web links (place:, javascript:) with a stderr count, importing the rest', async () => {
    const html = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<DL><p>',
      '    <DT><A HREF="https://nodejs.org/" ADD_DATE="1700000000">Node.js</A>',
      '    <DT><A HREF="place:folder=BOOKMARK_MENU">Bookmarks Toolbar</A>',
      '    <DT><A HREF="javascript:void(0)">bookmarklet</A>',
      '</DL><p>',
    ].join('\n');
    const res = await bm('import', writeFixture('mixed.html', html));
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 1 new bookmark, skipped 0 duplicate URLs.');
    expect(res.stderr).toContain('Skipped 2 non-web links (not http(s)).');

    const byUrl = storeByUrl();
    expect(byUrl.size).toBe(1);
    expect(byUrl.get('https://nodejs.org/')?.title).toBe('Node.js');
  });

  it('backup restore skips non-web entries and canonicalizes restored urls', async () => {
    const backup: StoreData = {
      bookmarks: [
        {
          id: 1,
          url: 'https://Example.com',
          title: 'Legacy spelling',
          tags: ['old'],
          note: '',
          created_at: '2024-05-01T00:00:00.000Z',
          updated_at: '2024-05-01T00:00:00.000Z',
        },
        {
          id: 2,
          url: 'place:folder=BOOKMARK_MENU',
          title: 'firefox internal',
          tags: [],
          note: '',
          created_at: '2024-05-02T00:00:00.000Z',
          updated_at: '2024-05-02T00:00:00.000Z',
        },
      ],
      nextId: 3,
    };
    const file = writeFixture('legacy-backup.json', JSON.stringify(backup));

    const res = await bm('import', file);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 1 new bookmark, skipped 0 duplicate URLs.');
    expect(res.stderr).toContain('Skipped 1 non-web link (not http(s)).');

    const store = readStore();
    expect(store.bookmarks).toHaveLength(1);
    expect(store.bookmarks[0]).toMatchObject({ id: 1, url: 'https://example.com/' });
  });

  it('rejects an unrecognized format with a non-zero exit and a clear error', async () => {
    const file = writeFixture('mystery.txt', 'just some plain text, not HTML nor JSON\n');
    const res = await bm('import', file);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Unrecognized import format');
  });

  it('rejects valid JSON that is not a bookmark-cli backup', async () => {
    const file = writeFixture('foreign.json', '{"hello": 1}');
    const res = await bm('import', file);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('not a bookmark-cli backup');
  });

  it('rejects HTML markup that contains no bookmark entries', async () => {
    const file = writeFixture('empty-dl.html', '<DL><p>\n</DL><p>\n');
    const res = await bm('import', file);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('No <A HREF> entries');
  });

  it('errors on a missing file', async () => {
    const res = await bm('import', join(sb.dataDir, 'nope.html'));
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Cannot read import file');
  });
});
