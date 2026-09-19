import { describe, expect, it } from 'vitest';
import { parseBackupJson, parseNetscapeHtml } from '../src/importer.js';
import { Bookmark, StoreData } from '../src/types.js';

const NESTED_HTML = [
  '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
  '<!-- This is an automatically generated file.',
  'It will be read and overwritten.',
  'DO NOT EDIT! -->',
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
  '    <DT><A HREF="https://example.com/">Example Domain</A>',
  '</DL><p>',
].join('\n');

function byUrl(html: string): Map<string, ReturnType<typeof parseNetscapeHtml>[number]> {
  return new Map(parseNetscapeHtml(html).map((b) => [b.url, b]));
}

describe('parseNetscapeHtml', () => {
  it('every folder segment on the path becomes its own tag (Chinese folder names included)', () => {
    const found = byUrl(NESTED_HTML);
    expect(found.size).toBe(3);
    // 书签栏/开发/... : two real segments above the deepest link -> two tags.
    expect(found.get('https://nodejs.org/')?.tags).toEqual(['书签栏', '开发']);
    // Nested one folder less deep: only the enclosing folder.
    expect(found.get('https://news.ycombinator.com/')?.tags).toEqual(['书签栏']);
    // Top-level link, outside every named folder: no tags at all.
    expect(found.get('https://example.com/')?.tags).toEqual([]);
  });

  it('extracts the title from the <A> text and ADD_DATE as ISO 8601 UTC', () => {
    const found = byUrl(NESTED_HTML);
    expect(found.get('https://nodejs.org/')?.title).toBe('Node.js');
    expect(found.get('https://nodejs.org/')?.createdAt).toBe('2023-11-14T22:13:20.000Z');
    expect(found.get('https://news.ycombinator.com/')?.createdAt).toBe('2020-09-13T12:26:40.000Z');
  });

  it('a missing ADD_DATE yields createdAt null (the caller supplies "now")', () => {
    expect(byUrl(NESTED_HTML).get('https://example.com/')?.createdAt).toBeNull();
  });

  it('empty folders contribute neither bookmarks nor tags', () => {
    const html = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<DL><p>',
      '    <DT><H3>空文件夹</H3>',
      '    <DL><p>',
      '    </DL><p>',
      '    <DT><A HREF="https://outside.example/" ADD_DATE="123">Outside</A>',
      '</DL><p>',
    ].join('\n');
    const parsed = parseNetscapeHtml(html);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tags).toEqual([]);
    expect(parsed[0].createdAt).toBe('1970-01-01T00:02:03.000Z');
  });

  it('tolerates lowercase tags/attrs, single quotes, unquoted values, <p> noise and decodes entities', () => {
    const html = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<dl><p>',
      '<!-- a comment hiding <A HREF="https://in-comment.example/">x</A> -->',
      '<dt><h3>A &amp; B</h3>',
      '<dl><p>',
      "<dt><a href='https://x.example/?q=1&amp;lang=zh' add_date=1600000000>X &lt;Y&gt; and <b>bold</b></a>",
      '<p>',
      '</dl><p>',
      '</dl><p>',
    ].join('\n');
    const parsed = parseNetscapeHtml(html);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].url).toBe('https://x.example/?q=1&lang=zh');
    expect(parsed[0].title).toBe('X <Y> and bold');
    expect(parsed[0].tags).toEqual(['A & B']);
    expect(parsed[0].createdAt).toBe('2020-09-13T12:26:40.000Z');
  });

  it('ignores bookmark markup inside comments', () => {
    const html = [
      '<DL><p>',
      '<!-- <A HREF="https://only-in-comment.example/">nope</A> -->',
      '<DT><A HREF="https://real.example/">Real</A>',
      '</DL><p>',
    ].join('\n');
    const parsed = parseNetscapeHtml(html);
    expect(parsed.map((b) => b.url)).toEqual(['https://real.example/']);
  });

  it('dedupes repeated folder names and drops empty folder names', () => {
    const html = [
      '<DL><p>',
      '<DT><H3>dev</H3>',
      '<DL><p>',
      '<DT><H3></H3>',
      '<DL><p>',
      '<DT><H3>dev</H3>',
      '<DL><p>',
      '<DT><A HREF="https://dup.example/" ADD_DATE="5">D</A>',
      '</DL><p>',
      '</DL><p>',
      '</DL><p>',
      '</DL><p>',
    ].join('\n');
    expect(parseNetscapeHtml(html)[0].tags).toEqual(['dev']);
  });

  it('an empty <A> text stays an empty title (faithful round-trip of empty titles)', () => {
    const html = '<DL><p>\n<DT><A HREF="https://empty.title/"></A>\n</DL><p>';
    const parsed = parseNetscapeHtml(html);
    expect(parsed[0].title).toBe('');
  });

  it('rejects plain text with a clear error', () => {
    expect(() => parseNetscapeHtml('just some plain text, nothing else')).toThrow(
      /not a Netscape bookmark HTML document/,
    );
  });

  it('rejects generic HTML without bookmark entries', () => {
    expect(() => parseNetscapeHtml('<html><body><h1>hi</h1></body></html>')).toThrow(
      /No <A HREF> entries/,
    );
    expect(() => parseNetscapeHtml('<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<DL><p></DL><p>')).toThrow(
      /No <A HREF> entries/,
    );
  });
});

describe('parseBackupJson', () => {
  const backup: StoreData = {
    bookmarks: [
      {
        id: 2,
        url: 'https://b.dev/',
        title: 'B',
        tags: ['x', 'y'],
        note: '',
        created_at: '2024-01-02T00:00:00.000Z',
        updated_at: '2024-01-02T00:00:00.000Z',
      },
      {
        id: 5,
        url: 'https://a.dev/',
        title: 'A',
        tags: [],
        note: 'n',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-03T00:00:00.000Z',
      },
    ],
    nextId: 6,
  };

  it('round-trips a well-formed backup unchanged (ids, gaps, timestamps)', () => {
    expect(parseBackupJson(JSON.stringify(backup))).toEqual(backup);
  });

  it('rejects text that is not JSON at all', () => {
    expect(() => parseBackupJson('{"bookmarks": [')).toThrow(/Invalid JSON backup/);
  });

  it('rejects JSON with the wrong envelope', () => {
    expect(() => parseBackupJson('{"hello": 1}')).toThrow(/Not a bookmark-cli backup/);
    expect(() => parseBackupJson('{"bookmarks": []}')).toThrow(/Not a bookmark-cli backup/);
    expect(() => parseBackupJson('[]')).toThrow(/Not a bookmark-cli backup/);
  });

  it('rejects malformed bookmark entries', () => {
    const bad: Bookmark[] = [
      {
        id: 1,
        url: '',
        title: 'x',
        tags: [],
        note: '',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
    ];
    expect(() => parseBackupJson(JSON.stringify({ bookmarks: bad, nextId: 2 }))).toThrow(
      /bookmarks\[0\] is malformed/,
    );
    expect(() =>
      parseBackupJson(JSON.stringify({ bookmarks: [{ nope: 1 }], nextId: 2 })),
    ).toThrow(/bookmarks\[0\] is malformed/);
  });

  it('lifts a too-low nextId above the max id (ids are never reused)', () => {
    const edited = { ...backup, nextId: 1 };
    const parsed = parseBackupJson(JSON.stringify(edited));
    expect(parsed.nextId).toBe(6);
  });
});
