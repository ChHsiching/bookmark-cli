import { Bookmark, CliError, StoreData } from './types.js';

/**
 * Hand-written parsers for the two import formats (spec: no third-party
 * libraries). `parseNetscapeHtml` lifts `<A HREF>` entries out of the browser
 * bookmark format, turning every folder-path segment into one tag (ADR-0001);
 * `parseBackupJson` reads bookmark-cli's own JSON backup - the exact dual of
 * `exporter.toJson`. Both are pure functions of the input text; file reading,
 * format sniffing and store updates live in commands/import.ts.
 */

/** One `<A HREF>` entry lifted out of a Netscape bookmark file. */
export interface ParsedBookmark {
  url: string;
  title: string;
  /** Folder path segments, each one a tag (deduped, empty segments dropped). */
  tags: string[];
  /**
   * ISO 8601 UTC derived from the ADD_DATE attribute (Unix seconds); null
   * when the attribute is missing or unparsable - the caller then supplies
   * the current time.
   */
  createdAt: string | null;
}

/** Decode the HTML entities our exporter and the browsers actually emit. */
function decodeEntities(s: string): string {
  return s.replace(
    /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole, body: string) => {
      if (body.startsWith('#')) {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) return whole;
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
      switch (body) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          return whole; // unknown entity kept verbatim
      }
    },
  );
}

/**
 * Normalize the text content of `<A>`/`<H3>`: strip nested markup first,
 * then decode entities (decoding first would let `&lt;` create fake tags),
 * then collapse whitespace so multiline markup yields a one-line title.
 */
function normalizeText(raw: string): string {
  return decodeEntities(raw.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

interface TagToken {
  /** Lowercased tag name, e.g. 'a', 'h3', 'dl'. */
  name: string;
  closing: boolean;
  /** Attribute names lowercased -> entity-decoded values. */
  attrs: Map<string, string>;
  /** Index of the '<' in the source text. */
  start: number;
  /** Index just past the '>'. */
  end: number;
}

/**
 * Attribute scanner for the inside of one tag: names case-insensitive,
 * values double-quoted, single-quoted or bare (the old Netscape files often
 * omit quotes). Valueless attributes map to ''.
 */
function parseAttrs(rest: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([A-Za-z_][A-Za-z0-9_.:-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of rest.matchAll(re)) {
    attrs.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

/**
 * Tolerant tag tokenizer: walks the raw text, skips comments and
 * declarations/processing instructions wholesale, and finds each '>' while
 * respecting quoted attribute values (so a '>' inside HREF cannot truncate
 * a tag).
 */
function scanTags(text: string): TagToken[] {
  const tokens: TagToken[] = [];
  let pos = 0;
  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    if (lt === -1) break;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      pos = end === -1 ? text.length : end + 3;
      continue;
    }
    let i = lt + 1;
    let quote: string | null = null;
    while (i < text.length) {
      const c = text[i];
      if (quote !== null) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      i += 1;
    }
    const inner = text.slice(lt + 1, i);
    pos = i + 1;
    if (inner === '' || inner.startsWith('!') || inner.startsWith('?')) continue;
    const closing = inner.startsWith('/');
    const body = closing ? inner.slice(1) : inner;
    const name = /^([A-Za-z][A-Za-z0-9:-]*)/.exec(body);
    if (!name) continue; // stray '<' that opens nothing
    tokens.push({
      name: name[1].toLowerCase(),
      closing,
      attrs: parseAttrs(body.slice(name[0].length)),
      start: lt,
      end: i + 1,
    });
  }
  return tokens;
}

/** Raw source text between an opening tag and its first closing counterpart. */
function textToClosing(text: string, tokens: TagToken[], openIdx: number, tagName: string): string {
  for (let j = openIdx + 1; j < tokens.length; j++) {
    if (tokens[j].name === tagName && tokens[j].closing) {
      return text.slice(tokens[openIdx].end, tokens[j].start);
    }
  }
  return '';
}

/** ADD_DATE (Unix seconds) -> ISO 8601 UTC; null when absent/unparsable/<=0. */
function addDateToIso(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const d = new Date(seconds * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** Folder path -> tag list: drop anonymous/empty segments, dedupe, keep order. */
function tagsFromStack(stack: (string | null)[]): string[] {
  const tags: string[] = [];
  for (const seg of stack) {
    if (seg !== null && seg !== '' && !tags.includes(seg)) tags.push(seg);
  }
  return tags;
}

/**
 * Parse a Netscape bookmark file (the format Chrome/Firefox export). The
 * folder path of each link becomes its tags - every segment on its own
 * (ADR-0001), so an empty folder contributes nothing: tags exist only as
 * prefixes of actual links. `<H3>` names the folder the next `<DL>` opens;
 * a `<DL>` without a preceding `<H3>` (the root) contributes no tag. Throws
 * CliError when the input holds no `<A HREF>` entry at all - that is the
 * "cannot parse this as bookmark HTML" signal.
 */
export function parseNetscapeHtml(text: string): ParsedBookmark[] {
  const tokens = scanTags(text);
  const bookmarks: ParsedBookmark[] = [];
  const folderStack: (string | null)[] = [];
  let pendingFolder: string | null = null; // set by <H3>, consumed by the next <DL>
  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx];
    if (tok.name === 'dl') {
      if (tok.closing) {
        folderStack.pop();
      } else {
        folderStack.push(pendingFolder);
      }
      pendingFolder = null;
    } else if (tok.name === 'h3' && !tok.closing) {
      pendingFolder = normalizeText(textToClosing(text, tokens, idx, 'h3')) || null;
    } else if (tok.name === 'a' && !tok.closing) {
      const url = decodeEntities(tok.attrs.get('href') ?? '').trim();
      if (url === '') continue; // <A> without a usable HREF is not a bookmark
      bookmarks.push({
        url,
        title: normalizeText(textToClosing(text, tokens, idx, 'a')),
        tags: tagsFromStack(folderStack),
        createdAt: addDateToIso(tok.attrs.get('add_date')),
      });
    }
  }
  if (bookmarks.length === 0) {
    throw new CliError(
      'No <A HREF> entries found: the file is not a Netscape bookmark HTML document.',
    );
  }
  return bookmarks;
}

/** Structural check used for format sniffing: `{ bookmarks: [], nextId: n }`. */
export function looksLikeBackup(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as { bookmarks?: unknown }).bookmarks) &&
    typeof (value as { nextId?: unknown }).nextId === 'number'
  );
}

function isBookmarkLike(v: unknown): v is Bookmark {
  if (v === null || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === 'number' &&
    Number.isInteger(b.id) &&
    b.id > 0 &&
    typeof b.url === 'string' &&
    b.url !== '' &&
    typeof b.title === 'string' &&
    Array.isArray(b.tags) &&
    b.tags.every((t) => typeof t === 'string') &&
    typeof b.note === 'string' &&
    typeof b.created_at === 'string' &&
    b.created_at !== '' &&
    typeof b.updated_at === 'string' &&
    b.updated_at !== ''
  );
}

/**
 * Parse a bookmark-cli JSON backup (the output of `export --format json`,
 * i.e. the storage format itself). The envelope and every entry are validated
 * so a hand-edited or truncated backup fails loudly instead of reaching the
 * store. The restored counter never dips below max id + 1: the never-reuse
 * invariant outranks literal fidelity for inconsistent input (well-formed
 * backups are returned unchanged).
 */
export function parseBackupJson(text: string): StoreData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new CliError(`Invalid JSON backup: ${(err as Error).message}`);
  }
  if (!looksLikeBackup(parsed)) {
    throw new CliError(
      'Not a bookmark-cli backup: expected an object with a "bookmarks" array and a "nextId" number.',
    );
  }
  const raw = parsed as { bookmarks: unknown[]; nextId: number };
  const bookmarks: Bookmark[] = raw.bookmarks.map((entry, i) => {
    if (!isBookmarkLike(entry)) {
      throw new CliError(`Not a bookmark-cli backup: bookmarks[${i}] is malformed.`);
    }
    return { ...entry, tags: [...entry.tags] };
  });
  const maxId = bookmarks.reduce((m, b) => Math.max(m, b.id), 0);
  return { bookmarks, nextId: Math.max(raw.nextId, maxId + 1, 1) };
}
