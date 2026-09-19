import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, emptyStore } from '../src/store.js';
import {
  FetchLike,
  TitleFetchResponse,
  createTitleFetcher,
  extractTitle,
} from '../src/title-fetcher.js';
import { runAdd } from '../src/commands/add.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bm-title-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const htmlResponse = (
  body: string,
  contentType = 'text/html; charset=utf-8',
  status = 200,
): TitleFetchResponse =>
  new Response(body, { status, headers: { 'content-type': contentType } });

const fetchTitleAlways = (title: string | null) => async (): Promise<string | null> => title;

describe('extractTitle (hand-written <title> parsing)', () => {
  it('extracts a simple title', () => {
    expect(extractTitle('<html><head><title>Hello World</title></head></html>')).toBe(
      'Hello World',
    );
  });

  it('tolerates attributes, case, newlines and collapsed whitespace', () => {
    const html = '<HEAD><TITLE data-x="1">\n  Multi\n  line   title\t here </TITLE></HEAD>';
    expect(extractTitle(html)).toBe('Multi line title here');
  });

  it('decodes basic HTML entities (named, decimal, hex)', () => {
    expect(extractTitle('<title>A &amp; B &lt;tag&gt; &#8212; &#x2713;</title>')).toBe(
      'A & B <tag> — ✓',
    );
    expect(extractTitle('<title>&quot;q&quot; &apos;s&apos; &nbsp;x</title>')).toBe(
      '"q" \'s\' x',
    );
  });

  it('leaves unknown entities untouched', () => {
    expect(extractTitle('<title>&totallymadeup; stays</title>')).toBe(
      '&totallymadeup; stays',
    );
  });

  it('returns null for a missing, empty or non-HTML body', () => {
    expect(extractTitle('<html><body>no title here</body></html>')).toBeNull();
    expect(extractTitle('<title>   </title>')).toBeNull();
    expect(extractTitle('<title></title>')).toBeNull();
    expect(extractTitle('just plain text, no markup')).toBeNull();
  });
});

describe('createTitleFetcher (injected fetch — no real network)', () => {
  it('resolves the page title on a 200 HTML response and wires an abort signal', async () => {
    let seenUrl = '';
    let seenSignal: unknown;
    const fake: FetchLike = (url, init) => {
      seenUrl = url;
      seenSignal = init.signal;
      return Promise.resolve(
        htmlResponse('<html><title>Fetched Page</title></html>'),
      );
    };
    const title = await createTitleFetcher({ fetch: fake })('https://page.dev/a');
    expect(title).toBe('Fetched Page');
    expect(seenUrl).toBe('https://page.dev/a');
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });

  it('returns null when fetch rejects (offline / network error)', async () => {
    const fake: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await createTitleFetcher({ fetch: fake })('https://down.dev')).toBeNull();
  });

  it('returns null on timeout instead of hanging', async () => {
    // A fetch that never settles on its own; only the abort signal ends it.
    const hanging: FetchLike = (_url, init) =>
      new Promise<TitleFetchResponse>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const fetcher = createTitleFetcher({ fetch: hanging, timeoutMs: 25 });
    const start = Date.now();
    const title = await fetcher('https://slow.dev');
    expect(title).toBeNull();
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('returns null for a non-HTML content type', async () => {
    const fake: FetchLike = () =>
      Promise.resolve(htmlResponse('{"a":1}', 'application/json'));
    expect(await createTitleFetcher({ fetch: fake })('https://api.dev/x')).toBeNull();
  });

  it('returns null on a non-2xx status', async () => {
    const fake: FetchLike = () =>
      Promise.resolve(htmlResponse('<title>Not Found</title>', 'text/html', 404));
    expect(await createTitleFetcher({ fetch: fake })('https://gone.dev')).toBeNull();
  });

  it('returns null when the HTML body has no <title>', async () => {
    const fake: FetchLike = () =>
      Promise.resolve(htmlResponse('<html><body>nothing</body></html>'));
    expect(await createTitleFetcher({ fetch: fake })('https://plain.dev')).toBeNull();
  });

  it('skips fetching entirely when BM_NO_TITLE_FETCH=1 is set', async () => {
    // If the env check were ignored, this fetch would resolve a title.
    const fake: FetchLike = () =>
      Promise.resolve(htmlResponse('<title>Network Title</title>'));
    const fetcher = createTitleFetcher({
      fetch: fake,
      env: { BM_NO_TITLE_FETCH: '1' },
    });
    expect(await fetcher('https://env.dev')).toBeNull();
  });
});

describe('runAdd title resolution (injected fake fetcher)', () => {
  it('stores the fetched page title when --title is absent', async () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    await runAdd(
      'https://page.dev/en',
      {},
      { store, fetchTitle: fetchTitleAlways('Real Page Title') },
    );
    expect(store.all()[0]).toMatchObject({
      url: 'https://page.dev/en',
      title: 'Real Page Title',
    });
  });

  it('--title overrides the automatically fetched title', async () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    await runAdd(
      'https://page.dev/en',
      { title: 'Manual Title' },
      { store, fetchTitle: fetchTitleAlways('Fetched Title') },
    );
    expect(store.all()[0].title).toBe('Manual Title');
  });

  it('falls back to the URL host when the fetcher returns null (timeout/offline)', async () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    await runAdd(
      'https://nodejs.org/en',
      {},
      { store, fetchTitle: fetchTitleAlways(null) },
    );
    expect(store.all()[0].title).toBe('nodejs.org');
  });

  it('falls back to the URL host when the fetcher returns null for a non-HTML body', async () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    await runAdd(
      'https://api.dev/data.json',
      {},
      { store, fetchTitle: fetchTitleAlways(null) },
    );
    expect(store.all()[0].title).toBe('api.dev');
  });

  it('falls back to the URL host even when a misbehaving fetcher throws', async () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    const exploding = async (): Promise<string | null> => {
      throw new Error('fetcher exploded');
    };
    await runAdd('https://boom.dev/x', {}, { store, fetchTitle: exploding });
    expect(store.all()[0].title).toBe('boom.dev');
  });

  it('--force without --title re-fetches and updates the title in place', async () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    store.add({
      url: 'https://page.dev/en',
      title: 'Stale Title',
      tags: ['keep'],
      note: 'keep me',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    await runAdd(
      'https://page.dev/en',
      { force: true },
      {
        store,
        fetchTitle: fetchTitleAlways('Fresh Title'),
        now: () => new Date('2026-02-02T00:00:00.000Z'),
      },
    );

    expect(store.all()).toHaveLength(1);
    expect(store.all()[0]).toMatchObject({
      id: 1,
      title: 'Fresh Title',
      tags: ['keep'],
      note: 'keep me',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-02-02T00:00:00.000Z',
    });
  });

  it('--force with --title keeps --title winning; a fetch miss keeps the old title', async () => {
    const store = new Store(join(dir, 'bookmarks.json'), emptyStore());
    store.add({
      url: 'https://page.dev/en',
      title: 'Old Title',
      tags: [],
      note: '',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    await runAdd(
      'https://page.dev/en',
      { force: true, title: 'Manual Beats Fetch' },
      { store, fetchTitle: fetchTitleAlways('Fetched') },
    );
    expect(store.all()[0].title).toBe('Manual Beats Fetch');

    await runAdd(
      'https://page.dev/en',
      { force: true },
      { store, fetchTitle: fetchTitleAlways(null) },
    );
    // Fetch miss on --force keeps the existing title; it must not degrade
    // to the host fallback.
    expect(store.all()[0].title).toBe('Manual Beats Fetch');
  });
});
