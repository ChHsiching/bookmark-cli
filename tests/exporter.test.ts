import { describe, expect, it } from 'vitest';
import { Bookmark, StoreData } from '../src/types.js';
import { UNTAGGED_GROUP, groupByTag, toJson, toMarkdown, toNetscapeHtml } from '../src/exporter.js';

interface BookmarkInput {
  id: number;
  url: string;
  title: string;
  tags: string[];
  note?: string;
  created_at: string;
}

function bm(input: BookmarkInput): Bookmark {
  return {
    ...input,
    note: input.note ?? '',
    updated_at: input.created_at,
  };
}

/**
 * Shared fixture: a multi-tag bookmark (multiple entrances), a Chinese-tag /
 * Chinese-title bookmark, an untagged bookmark, and a gap in the id space
 * (id 4 was deleted) so the persisted counter matters.
 */
const FIXTURE: StoreData = {
  // Key order matches what Store writes (bookmarks first, counter last).
  bookmarks: [
    bm({
      id: 1,
      url: 'https://nodejs.org/en',
      title: 'Node.js',
      tags: ['dev', 'docs'],
      note: 'runtime docs',
      created_at: '2026-09-17T10:00:00.000Z',
    }),
    bm({
      id: 2,
      url: 'https://zh.example.com/',
      title: '前端工具箱',
      tags: ['前端', 'dev'],
      created_at: '2026-09-18T10:00:00.000Z',
    }),
    bm({
      id: 3,
      url: 'https://plain.org/',
      title: 'No tags here',
      tags: [],
      note: 'loose page',
      created_at: '2026-09-19T10:00:00.000Z',
    }),
  ],
  nextId: 5,
};

const EMPTY: StoreData = { bookmarks: [], nextId: 1 };

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('groupByTag', () => {
  it('orders tag groups by code points, untagged group last, newest first inside', () => {
    const groups = groupByTag(FIXTURE.bookmarks);
    expect(groups.map((g) => g.tag)).toEqual(['dev', 'docs', '前端', UNTAGGED_GROUP]);
    // dev has #2 (newer) before #1; the untagged group holds #3.
    expect(groups[0].bookmarks.map((b) => b.id)).toEqual([2, 1]);
    expect(groups[3].bookmarks.map((b) => b.id)).toEqual([3]);
  });

  it('collapses duplicate tags on one bookmark so it appears once per group', () => {
    const groups = groupByTag([bm({ id: 9, url: 'https://x.dev', title: 'x', tags: ['a', 'a'], created_at: '2026-01-01T00:00:00.000Z' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].bookmarks).toHaveLength(1);
  });
});

describe('toMarkdown', () => {
  it('groups by tag, multi-tag bookmarks appear in every group, untagged under 无标签', () => {
    const md = toMarkdown(FIXTURE);
    // Exact output locks the format: sections in code-point order, 无标签 last,
    // entries newest-first within a group, notes as indented lines.
    expect(md).toBe(
      [
        '# Bookmarks',
        '',
        '## dev',
        '',
        '- [前端工具箱](https://zh.example.com/)',
        '- [Node.js](https://nodejs.org/en)',
        '  runtime docs',
        '',
        '## docs',
        '',
        '- [Node.js](https://nodejs.org/en)',
        '  runtime docs',
        '',
        '## 前端',
        '',
        '- [前端工具箱](https://zh.example.com/)',
        '',
        '## 无标签',
        '',
        '- [No tags here](https://plain.org/)',
        '  loose page',
      ].join('\n'),
    );
    // The multi-entrance property, explicitly: nodejs.org shows up twice.
    expect(md.match(/- \[Node\.js\]\(https:\/\/nodejs\.org\/en\)/g)).toHaveLength(2);
  });

  it('escapes brackets in titles and parens in URLs', () => {
    const data: StoreData = {
      nextId: 2,
      bookmarks: [
        bm({
          id: 1,
          url: 'https://en.wikipedia.org/wiki/Foo_(bar)',
          title: 'A [b] c',
          tags: ['t'],
          created_at: '2026-01-01T00:00:00.000Z',
        }),
      ],
    };
    expect(toMarkdown(data)).toContain(
      '- [A \\[b\\] c](https://en.wikipedia.org/wiki/Foo_\\(bar\\))',
    );
  });

  it('an empty store yields just the document title', () => {
    expect(toMarkdown(EMPTY)).toBe('# Bookmarks');
  });
});

describe('toNetscapeHtml', () => {
  it('produces the Netscape header and a hand-written nested DL structure', () => {
    const data: StoreData = {
      nextId: 3,
      bookmarks: [
        bm({
          id: 1,
          url: 'https://nodejs.org/en',
          title: 'Node.js',
          tags: ['dev'],
          created_at: '2026-09-17T10:00:00.000Z',
        }),
        bm({
          id: 2,
          url: 'https://plain.org/',
          title: 'No tags',
          tags: [],
          created_at: '2026-09-18T10:00:00.000Z',
        }),
      ],
    };
    // Hand-written minimal sample with the expected nested <DL><p> structure.
    const expected = [
      '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
      '<!-- This is an automatically generated file.',
      'It will be read and overwritten.',
      'DO NOT EDIT! -->',
      '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
      '<TITLE>Bookmarks</TITLE>',
      '<H1>Bookmarks</H1>',
      '<DL><p>',
      '    <DT><H3>dev</H3>',
      '    <DL><p>',
      `        <DT><A HREF="https://nodejs.org/en" ADD_DATE="${unix('2026-09-17T10:00:00.000Z')}">Node.js</A>`,
      '    </DL><p>',
      `    <DT><H3>${UNTAGGED_GROUP}</H3>`,
      '    <DL><p>',
      `        <DT><A HREF="https://plain.org/" ADD_DATE="${unix('2026-09-18T10:00:00.000Z')}">No tags</A>`,
      '    </DL><p>',
      '</DL><p>',
    ].join('\n');
    expect(toNetscapeHtml(data)).toBe(expected);
  });

  it('mirrors the Markdown grouping: multi entrances, Chinese tag folder, 无标签 last', () => {
    const html = toNetscapeHtml(FIXTURE);
    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
    expect(html).toContain('<TITLE>Bookmarks</TITLE>');
    expect(html).toContain('<H1>Bookmarks</H1>');
    // Folder order identical to the Markdown section order.
    const folders = ['<DT><H3>dev</H3>', '<DT><H3>docs</H3>', '<DT><H3>前端</H3>', `<DT><H3>${UNTAGGED_GROUP}</H3>`];
    const positions = folders.map((f) => html.indexOf(f));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Multi-tag bookmark appears under both dev and docs folders.
    expect(html.match(/HREF="https:\/\/nodejs\.org\/en"/g)).toHaveLength(2);
    expect(html).toContain('<DT><H3>前端</H3>');
  });

  it('escapes & < > " in attributes and text, and uses Unix-second ADD_DATE', () => {
    const data: StoreData = {
      nextId: 2,
      bookmarks: [
        bm({
          id: 1,
          url: 'https://example.com/a?x=1&y=2',
          title: 'A <b>"quoted"</b> & more',
          tags: ['t&u'],
          created_at: '2026-09-17T10:00:30.500Z',
        }),
      ],
    };
    const html = toNetscapeHtml(data);
    expect(html).toContain('<DT><H3>t&amp;u</H3>');
    expect(html).toContain('HREF="https://example.com/a?x=1&amp;y=2"');
    expect(html).toContain('>A &lt;b&gt;&quot;quoted&quot;&lt;/b&gt; &amp; more</A>');
    // 10:00:30.500Z truncates to second 30, not rounded up.
    expect(html).toContain(`ADD_DATE="${unix('2026-09-17T10:00:30.500Z')}"`);
    expect(unix('2026-09-17T10:00:30.500Z') % 60).toBe(30);
  });

  it('an empty store yields a legal document with an empty DL', () => {
    const html = toNetscapeHtml(EMPTY);
    expect(html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
    expect(html).toContain('<DL><p>');
    expect(html).toContain('</DL><p>');
    expect(html).not.toContain('<DT>');
    // Exactly one <DL> open / close pair.
    expect(html.match(/<DL><p>/g)).toHaveLength(1);
    expect(html.match(/<\/DL><p>/g)).toHaveLength(1);
  });
});

describe('toJson', () => {
  it('is the storage format itself: parse round-trips the whole StoreData including nextId', () => {
    const parsed = JSON.parse(toJson(FIXTURE)) as StoreData;
    expect(parsed).toEqual(FIXTURE);
    expect(parsed.nextId).toBe(5); // counter travels with the backup
    expect(parsed.bookmarks[0]).toEqual(FIXTURE.bookmarks[0]);
  });

  it('is human-readable 2-space JSON', () => {
    const raw = toJson(FIXTURE);
    expect(raw).toContain('{\n  "bookmarks": [');
    expect(raw).toContain('\n  "nextId": 5');
    expect(raw).toContain('"created_at": "2026-09-17T10:00:00.000Z"');
  });

  it('exports a legal empty StoreData and leaves the final newline to the caller', () => {
    const raw = toJson(EMPTY);
    expect(JSON.parse(raw)).toEqual(EMPTY);
    expect(raw.endsWith('\n')).toBe(false);
  });
});
