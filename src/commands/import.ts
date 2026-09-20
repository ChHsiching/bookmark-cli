import { readFileSync } from 'node:fs';
import { canonicalUrl } from '../canonical-url.js';
import { looksLikeBackup, parseBackupJson, parseNetscapeHtml, ParsedBookmark } from '../importer.js';
import { Store } from '../store.js';
import { Bookmark, CliError, StoreData } from '../types.js';

/** Dependencies that tests can inject. */
export interface ImportDeps {
  store?: Store;
  now?: () => Date;
}

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function looksLikeNetscapeHtml(text: string): boolean {
  return /<!DOCTYPE\s+NETSCAPE-Bookmark-file/i.test(text) || /<DL[\s>]/i.test(text);
}

function report(added: number, skipped: number, nonWeb = 0): void {
  const pl = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  console.log(`Imported ${pl(added, 'new bookmark')}, skipped ${pl(skipped, 'duplicate URL')}.`);
  if (nonWeb > 0) {
    // Browser exports routinely carry place:/about: entries (ADR-0003: only
    // web URLs are bookmarkable). Skipped, never silent — stderr so stdout
    // stays script-friendly.
    console.error(`Skipped ${pl(nonWeb, 'non-web link')} (not http(s)).`);
  }
}

/**
 * HTML path: every parsed entry goes through the ordinary Store creation
 * logic, so ids come from the live counter and ADD_DATE decides created_at.
 * URL identity first, as everywhere — judged on the canonical form
 * (ADR-0003): an entry whose URL is already stored is skipped untouched, and
 * spellings of the same page within one file (our own HTML export gives
 * multi-tag bookmarks one entrance per tag folder) merge into the first
 * occurrence: it fixes title/created_at, later occurrences only contribute
 * their tags; they count as skipped because no new bookmark is created.
 * Non-web links (place:, javascript:, …) are skipped and counted to stderr.
 */
function importHtml(parsed: ParsedBookmark[], store: Store, now: () => Date): void {
  const byUrl = new Map<string, ParsedBookmark>();
  let skipped = 0;
  let nonWeb = 0;
  for (const bm of parsed) {
    const canonical = canonicalUrl(bm.url);
    if (canonical === null) {
      nonWeb += 1;
      continue;
    }
    if (store.getByUrl(canonical) !== undefined) {
      skipped += 1;
      continue;
    }
    const acc = byUrl.get(canonical);
    if (acc) {
      for (const tag of bm.tags) {
        if (!acc.tags.includes(tag)) acc.tags.push(tag);
      }
      skipped += 1;
      continue;
    }
    byUrl.set(canonical, { ...bm, url: canonical, tags: [...bm.tags] });
  }
  for (const bm of byUrl.values()) {
    store.add({
      url: bm.url,
      title: bm.title,
      tags: bm.tags,
      note: '',
      now: bm.createdAt !== null ? new Date(bm.createdAt) : now(),
    });
  }
  store.save();
  report(byUrl.size, skipped, nonWeb);
}

/**
 * JSON path = restore semantics: bookmarks come back with their original ids
 * and timestamps (the dual of the JSON export carrying nextId), so a
 * round-trip on an empty store reproduces the store byte for byte. Identity
 * rule still wins over restore: a backup URL that already exists in the live
 * store is skipped and the live entry is left untouched (conservative - an
 * import never overwrites live data). URLs are canonicalized at restore
 * (ADR-0003) and non-web entries are skipped with a count — the store holds
 * canonical web URLs only. When a live bookmark already occupies a backup id
 * under a different URL, the restored entry is handed a fresh id from the
 * merged counter; the counter never drops below either side's nextId,
 * keeping deleted-id gaps from being reused.
 */
function restoreBackup(backup: StoreData, store: Store): void {
  const current = store.snapshot();
  const keptUrls = new Set(current.bookmarks.map((b) => b.url));
  const usedIds = new Set(current.bookmarks.map((b) => b.id));
  let nextId = Math.max(current.nextId, backup.nextId, 1);
  const restored: Bookmark[] = [];
  let skipped = 0;
  let nonWeb = 0;
  for (const entry of backup.bookmarks) {
    const canonical = canonicalUrl(entry.url);
    if (canonical === null) {
      nonWeb += 1;
      continue;
    }
    if (keptUrls.has(canonical)) {
      skipped += 1;
      continue;
    }
    keptUrls.add(canonical); // also guards duplicate URLs inside the backup
    const bm = structuredClone(entry);
    bm.url = canonical;
    if (usedIds.has(bm.id)) {
      bm.id = nextId;
    }
    usedIds.add(bm.id);
    nextId = Math.max(nextId, bm.id + 1);
    restored.push(bm);
  }
  Store.adopt(store.path, { bookmarks: [...current.bookmarks, ...restored], nextId }).save();
  report(restored.length, skipped, nonWeb);
}

/**
 * `bm import <file>`: read the file (UTF-8) and auto-detect the format.
 * Our JSON backup wins when the text parses as JSON with the StoreData
 * envelope; otherwise a Netscape DOCTYPE or `<DL>` structure routes to the
 * HTML parser; anything else is an error (stderr, exit code 1 via CliError).
 */
export async function runImport(file: string, deps: ImportDeps = {}): Promise<void> {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new CliError(`Cannot read import file ${file}: ${(err as Error).message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // tolerate a UTF-8 BOM

  const store = deps.store ?? Store.load();
  const now = deps.now ?? (() => new Date());

  const json = tryParseJson(text);
  if (json.ok) {
    if (!looksLikeBackup(json.value)) {
      throw new CliError(
        `${file} is valid JSON but not a bookmark-cli backup ` +
          '(expected an object with a "bookmarks" array and a "nextId" number).',
      );
    }
    restoreBackup(parseBackupJson(text), store);
  } else if (looksLikeNetscapeHtml(text)) {
    importHtml(parseNetscapeHtml(text), store, now);
  } else {
    throw new CliError(
      `Unrecognized import format: ${file}. ` +
        'Expected a Netscape bookmark HTML file or a bookmark-cli JSON backup.',
    );
  }
}
