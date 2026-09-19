import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bookmark, StoreData } from '../src/types.js';
import { CliSandbox, createCliSandbox } from './helpers.js';

/**
 * The end-to-end smoke chain from the spec's testing decisions: one clean
 * store (fresh empty storage directory), then add -> search -> edit/rm/tags
 * -> export -> import, asserting stdout, exit codes and file side effects of
 * every step. The phases are separate `it`s only to stay well under the test
 * timeout; they share one environment and MUST run in declaration order,
 * which vitest guarantees within a file.
 */
describe('cli end-to-end chain (one clean store, ordered phases)', () => {
  let sb: CliSandbox;

  beforeAll(() => {
    // BM_NO_TITLE_FETCH keeps every add hermetic: no real network requests.
    sb = createCliSandbox({ noTitleFetch: true });
  });
  afterAll(() => {
    sb.cleanup();
  });

  const storePath = () => sb.storePath();
  const bm = (...args: string[]) => sb.bm(...args);
  // The chain's shared scratch space (one dir per phase would also work, but
  // the phases deliberately hand files to each other).
  const dataDir = () => sb.dataDir;

  function readStore(): StoreData {
    return JSON.parse(readFileSync(storePath(), 'utf8')) as StoreData;
  }

  function storeByUrl(): Map<string, Bookmark> {
    return new Map(readStore().bookmarks.map((b) => [b.url, b]));
  }

  it('phase 1: add bookmarks into the empty store', async () => {
    // The store starts truly empty: nothing was ever written there.
    expect(existsSync(storePath())).toBe(false);

    const one = await bm(
      'add',
      'https://nodejs.org/en',
      '--title',
      'Node.js runtime docs',
      '--tags',
      'dev,docs',
      '--note',
      'official runtime docs',
    );
    expect(one.code).toBe(0);
    expect(one.stdout).toContain('Added #1 https://nodejs.org/en (Node.js runtime docs)');

    const two = await bm(
      'add',
      'https://developer.mozilla.org',
      '--title',
      'MDN Web Docs',
      '--tags',
      'docs,web',
      '--note',
      'css reference',
    );
    expect(two.code).toBe(0);
    expect(two.stdout).toContain('Added #2 https://developer.mozilla.org');

    const three = await bm(
      'add',
      'https://news.ycombinator.com',
      '--title',
      'Hacker News',
      '--tags',
      'dev',
    );
    expect(three.code).toBe(0);
    expect(three.stdout).toContain('Added #3 https://news.ycombinator.com (Hacker News)');

    // No --title and no network: the title falls back to the URL host.
    const four = await bm('add', 'https://example.com/standup', '--note', 'standup meeting notes');
    expect(four.code).toBe(0);
    expect(four.stdout).toContain('Added #4 https://example.com/standup (example.com)');

    // File side effect: the store file exists with the four bookmarks.
    const store = readStore();
    expect(store.bookmarks).toHaveLength(4);
    expect(store.nextId).toBe(5);
    expect(storeByUrl().get('https://nodejs.org/en')).toMatchObject({
      id: 1,
      title: 'Node.js runtime docs',
      tags: ['dev', 'docs'],
      note: 'official runtime docs',
    });
  });

  it('phase 2: search finds bookmarks from title, URL, tag and note fragments', async () => {
    // Title fragment.
    const byTitle = await bm('search', 'runtim');
    expect(byTitle.code).toBe(0);
    expect(byTitle.stdout).toContain('#1');
    expect(byTitle.stdout).toContain('Node.js runtime docs');
    expect(byTitle.stdout).toContain('https://nodejs.org/en');

    // URL fragment.
    const byUrl = await bm('search', 'mozil');
    expect(byUrl.code).toBe(0);
    expect(byUrl.stdout).toContain('#2');
    expect(byUrl.stdout).toContain('https://developer.mozilla.org');

    // Tag fragment: two bookmarks carry "docs"-family tags.
    const byTag = await bm('search', 'docs');
    expect(byTag.code).toBe(0);
    expect(byTag.stdout).toContain('https://nodejs.org/en');
    expect(byTag.stdout).toContain('https://developer.mozilla.org');
    expect(byTag.stdout).not.toContain('https://news.ycombinator.com');

    // Note fragment: only bookmark #4 mentions the standup.
    const byNote = await bm('search', 'stdup');
    expect(byNote.code).toBe(0);
    expect(byNote.stdout).toContain('#4');
    expect(byNote.stdout).toContain('https://example.com/standup');

    // No match: clean exit, silent stdout.
    const none = await bm('search', 'zzz-no-such-thing');
    expect(none.code).toBe(0);
    expect(none.stdout.trim()).toBe('');
  });

  it('phase 3: edit / rm / tags / list keep the store consistent', async () => {
    // edit: --tags replaces the set entirely, --note appends nothing (sets).
    const edited = await bm('edit', '3', '--tags', 'news,dev', '--note', 'tech headlines');
    expect(edited.code).toBe(0);
    expect(edited.stdout).toContain('#3');
    expect(storeByUrl().get('https://news.ycombinator.com')).toMatchObject({
      tags: ['news', 'dev'],
      note: 'tech headlines',
      title: 'Hacker News',
    });

    // rm -y: scriptable deletion without a prompt.
    const removed = await bm('rm', '4', '-y');
    expect(removed.code).toBe(0);
    expect(removed.stdout).toContain('Deleted #4');
    const store = readStore();
    expect(store.bookmarks.map((b) => b.id).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    // The freed id is never reused; the counter keeps moving forward.
    expect(store.nextId).toBe(5);

    // tags: counts reflect the edit (dev=2, docs=2, news=1, web=1).
    const tags = await bm('tags');
    expect(tags.code).toBe(0);
    const rows = tags.stdout
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => {
        const m = l.match(/^(\d+)\s{2}(.+)$/);
        expect(m, `unparsable tags line: ${l}`).toBeDefined();
        return { count: Number(m![1]), tag: m![2] };
      });
    expect(rows).toEqual([
      { count: 2, tag: 'dev' },
      { count: 2, tag: 'docs' },
      { count: 1, tag: 'news' },
      { count: 1, tag: 'web' },
    ]);

    // list --json: machine-readable, newest first (3, 2, 1).
    const listed = await bm('list', '--json');
    expect(listed.code).toBe(0);
    const arr = JSON.parse(listed.stdout) as Array<{ id: number; url: string }>;
    expect(arr.map((b) => b.id)).toEqual([3, 2, 1]);
  });

  it('phase 4: export writes json, html and md documents to files', async () => {
    const backup = join(dataDir(), 'chain-backup.json');
    const jsonExport = await bm('export', '--format', 'json', '-o', backup);
    expect(jsonExport.code).toBe(0);
    expect(jsonExport.stdout).toBe('');
    const backupData = JSON.parse(readFileSync(backup, 'utf8')) as StoreData;
    expect(backupData.bookmarks).toHaveLength(3);
    expect(backupData.nextId).toBe(5);

    const htmlOut = join(dataDir(), 'exports', 'bookmarks.html');
    const htmlExport = await bm('export', '--format', 'html', '-o', htmlOut);
    expect(htmlExport.code).toBe(0);
    expect(htmlExport.stdout).toBe('');
    const html = readFileSync(htmlOut, 'utf8');
    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
    expect(html).toContain('<DT><A HREF="https://nodejs.org/en"');
    expect(html).toContain('<DT><H3>dev</H3>');
    expect(html).toContain('<DT><H3>web</H3>');

    const mdOut = join(dataDir(), 'exports', 'bookmarks.md');
    const mdExport = await bm('export', '-o', mdOut);
    expect(mdExport.code).toBe(0);
    const md = readFileSync(mdOut, 'utf8');
    expect(md).toContain('# Bookmarks');
    expect(md).toContain('## dev');
    expect(md).toContain('- [Node.js runtime docs](https://nodejs.org/en)');
    expect(md).toContain('  official runtime docs');
  });

  it('phase 5: deleting the store and importing the JSON backup restores it byte-identically', async () => {
    const before = readFileSync(storePath(), 'utf8');

    // Really gone: a list on the wiped store sees an empty library.
    rmSync(storePath());
    expect(existsSync(storePath())).toBe(false);
    const empty = await bm('list', '--json');
    expect(empty.code).toBe(0);
    expect(JSON.parse(empty.stdout)).toEqual([]);

    const restored = await bm('import', join(dataDir(), 'chain-backup.json'));
    expect(restored.code).toBe(0);
    expect(restored.stdout).toContain('Imported 3 new bookmarks, skipped 0 duplicate URLs.');

    // Byte-identical: ids, timestamps and the id counter all survive.
    expect(readFileSync(storePath(), 'utf8')).toBe(before);

    // The chain still answers searches after the restore.
    const found = await bm('search', 'runtim');
    expect(found.code).toBe(0);
    expect(found.stdout).toContain('#1');
  });

  it('phase 6: importing browser HTML adds new URLs and skips known ones', async () => {
    const html = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<DL><p>',
      '    <DT><H3>开发</H3>',
      '    <DL><p>',
      // Already in the store: skipped by the URL identity rule.
      '        <DT><A HREF="https://nodejs.org/en" ADD_DATE="1700000000">Node.js</A>',
      '        <DT><A HREF="https://rust-lang.org/" ADD_DATE="1700000001">Rust</A>',
      '    </DL><p>',
      '    <DT><H3>工具</H3>',
      '    <DL><p>',
      '        <DT><A HREF="https://github.com/" ADD_DATE="1700000002">GitHub</A>',
      '    </DL><p>',
      '</DL><p>',
    ].join('\n');
    const fixture = join(dataDir(), 'browser-bookmarks.html');
    writeFileSync(fixture, html, 'utf8');

    const res = await bm('import', fixture);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Imported 2 new bookmarks, skipped 1 duplicate URL.');

    const store = readStore();
    expect(store.bookmarks).toHaveLength(5);
    // Folder path segments became tags on the new entries.
    expect(storeByUrl().get('https://rust-lang.org/')?.tags).toEqual(['开发']);
    expect(storeByUrl().get('https://github.com/')?.tags).toEqual(['工具']);
    // The pre-existing entry kept its live title (skip, never overwrite).
    expect(storeByUrl().get('https://nodejs.org/en')?.title).toBe('Node.js runtime docs');
  });
});
