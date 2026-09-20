import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalUrl } from './canonical-url.js';
import { Bookmark, CliError, StoreData } from './types.js';

/**
 * Resolve the store file location using platform conventions, derived from
 * standard system environment variables (this is OS convention, not product
 * configuration):
 * - Windows: %APPDATA%\bookmark-cli\bookmarks.json
 * - macOS:   ~/Library/Application Support/bookmark-cli/bookmarks.json
 * - Linux:   $XDG_CONFIG_HOME (default ~/.config)/bookmark-cli/bookmarks.json
 */
export function resolveStorePath(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    const appData =
      env.APPDATA ||
      (env.USERPROFILE ? join(env.USERPROFILE, 'AppData', 'Roaming') : undefined);
    if (!appData) {
      throw new CliError('Cannot locate config directory: APPDATA is not set.');
    }
    return join(appData, 'bookmark-cli', 'bookmarks.json');
  }
  if (platform === 'darwin') {
    const home = env.HOME;
    if (!home) {
      throw new CliError('Cannot locate config directory: HOME is not set.');
    }
    return join(home, 'Library', 'Application Support', 'bookmark-cli', 'bookmarks.json');
  }
  const configHome =
    env.XDG_CONFIG_HOME || (env.HOME ? join(env.HOME, '.config') : undefined);
  if (!configHome) {
    throw new CliError(
      'Cannot locate config directory: neither XDG_CONFIG_HOME nor HOME is set.',
    );
  }
  return join(configHome, 'bookmark-cli', 'bookmarks.json');
}

/** Thrown when adding a URL that already exists in the store. */
export class DuplicateUrlError extends Error {
  constructor(
    public readonly existingId: number,
    public readonly url: string,
  ) {
    super(`URL already bookmarked as #${existingId}: ${url}`);
    this.name = 'DuplicateUrlError';
  }
}

export function emptyStore(): StoreData {
  return { bookmarks: [], nextId: 1 };
}

/**
 * The one "newest first" ordering, shared by everything that lists
 * bookmarks: created_at descending, ties broken by higher id first (ids are
 * monotonic, so identical timestamps still order deterministically). Used by
 * Store.listNewestFirst, the exporter's within-group ordering and the search
 * results tie-break — one comparator so the three can never drift apart.
 */
export function byNewestFirst(a: Bookmark, b: Bookmark): number {
  const byTime = Date.parse(b.created_at) - Date.parse(a.created_at);
  return byTime !== 0 ? byTime : b.id - a.id;
}

/**
 * Migrate legacy data to canonical URLs (ADR-0003), in memory — the file is
 * only rewritten on the next save(). Variants that collapse onto one
 * canonical form merge into the entry with the smaller id: tags union,
 * first non-empty note, earliest created_at. Non-web links (imported before
 * the invariant existed) are dropped. Collisions self-extinguish once the
 * canonical form is persisted.
 */
function canonicalizeStoreData(data: StoreData): {
  data: StoreData;
  merged: number;
  droppedNonWeb: number;
} {
  const byCanonical = new Map<string, Bookmark>();
  let merged = 0;
  let droppedNonWeb = 0;
  for (const raw of data.bookmarks) {
    const canonical = canonicalUrl(raw.url);
    if (canonical === null) {
      droppedNonWeb += 1;
      continue;
    }
    const existing = byCanonical.get(canonical);
    if (existing === undefined) {
      byCanonical.set(canonical, { ...raw, url: canonical });
      continue;
    }
    let keep = existing;
    let other = { ...raw, url: canonical };
    if (other.id < keep.id) {
      [keep, other] = [other, keep];
    }
    keep.tags = [...new Set([...keep.tags, ...other.tags])];
    if (keep.note === '') keep.note = other.note;
    if (other.created_at < keep.created_at) keep.created_at = other.created_at;
    byCanonical.set(canonical, keep);
    merged += 1;
  }
  return { data: { bookmarks: [...byCanonical.values()], nextId: data.nextId }, merged, droppedNonWeb };
}

/**
 * The bookmark store: a single human-readable JSON file. The path is
 * injectable so tests never touch the real user directory.
 */
export class Store {
  readonly path: string;
  private data: StoreData;

  private constructor(path: string, data: StoreData) {
    this.path = path;
    this.data = data;
  }

  /** Load the store from `path` (default: the platform-conventional path). */
  static load(path?: string): Store {
    const file = path ?? resolveStorePath();
    if (!existsSync(file)) {
      return new Store(file, emptyStore());
    }
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      throw new CliError(`Cannot read store file ${file}: ${(err as Error).message}`);
    }
    if (raw.trim() === '') {
      return new Store(file, emptyStore());
    }
    try {
      const parsed = JSON.parse(raw) as StoreData;
      if (
        !parsed ||
        !Array.isArray(parsed.bookmarks) ||
        typeof parsed.nextId !== 'number'
      ) {
        throw new Error('expected an object with a "bookmarks" array and a "nextId" number');
      }
      const { data, merged, droppedNonWeb } = canonicalizeStoreData(parsed);
      if (merged > 0 || droppedNonWeb > 0) {
        console.error(
          `Store migrated: merged ${merged} duplicate bookmark(s), removed ${droppedNonWeb} non-web link(s).`,
        );
      }
      return new Store(file, data);
    } catch (err) {
      throw new CliError(`Store file is corrupted (${file}): ${(err as Error).message}`);
    }
  }

  /**
   * Wrap already-composed data as a Store bound to `path` without reading any
   * file. Used by restore-style import, which merges the data itself and then
   * persists through the usual atomic save().
   */
  static adopt(path: string, data: StoreData): Store {
    return new Store(path, data);
  }

  /**
   * Full rewrite of the store file, human-readable (2-space indentation,
   * trailing newline). Writes via a temp file + rename so a crash mid-write
   * cannot truncate the existing store.
   */
  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const json = JSON.stringify(this.data, null, 2) + '\n';
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, json, 'utf8');
    try {
      renameSync(tmp, this.path);
    } catch {
      // Rename can fail on some filesystems when the destination is held
      // open (e.g. antivirus on Windows); fall back to a direct write.
      writeFileSync(this.path, json, 'utf8');
      try {
        rmSync(tmp, { force: true });
      } catch {
        // best effort cleanup
      }
    }
  }

  /** All bookmarks, in insertion order. */
  all(): Bookmark[] {
    return [...this.data.bookmarks];
  }

  /** All bookmarks sorted newest-first (ties broken by higher id first). */
  listNewestFirst(): Bookmark[] {
    return this.all().sort(byNewestFirst);
  }

  /**
   * A deep copy of the full stored data (bookmarks + id counter). Read-only
   * view for consumers such as export; mutating it never touches the store.
   */
  snapshot(): StoreData {
    return structuredClone(this.data);
  }

  /**
   * Find by URL across spellings: the query is canonicalized (ADR-0003), so
   * case/port variants of the same page hit the stored canonical form. A
   * non-web query can never match (nothing non-web is stored).
   */
  getByUrl(url: string): Bookmark | undefined {
    const canonical = canonicalUrl(url);
    if (canonical === null) return undefined;
    return this.data.bookmarks.find((b) => b.url === canonical);
  }

  getById(id: number): Bookmark | undefined {
    return this.data.bookmarks.find((b) => b.id === id);
  }

  /**
   * Append a new bookmark. Assigns the next id from the persisted counter.
   * The URL is canonicalized at this seam (ADR-0003) — the canonical form is
   * what gets stored and compared. Throws DuplicateUrlError if a bookmark
   * with the same canonical URL exists; CliError defensively if the input is
   * not a bookmarkable web URL (callers normally reject those earlier, with
   * user-facing wording).
   */
  add(input: {
    url: string;
    title: string;
    tags: string[];
    note: string;
    now?: Date;
  }): Bookmark {
    const canonical = canonicalUrl(input.url);
    if (canonical === null) {
      throw new CliError(`Not a bookmarkable URL: ${input.url}`);
    }
    const existing = this.getByUrl(canonical);
    if (existing) {
      throw new DuplicateUrlError(existing.id, canonical);
    }
    const now = (input.now ?? new Date()).toISOString();
    const bookmark: Bookmark = {
      id: this.data.nextId,
      url: canonical,
      title: input.title,
      tags: [...input.tags],
      note: input.note,
      created_at: now,
      updated_at: now,
    };
    this.data.nextId += 1;
    this.data.bookmarks.push(bookmark);
    return bookmark;
  }

  /**
   * Patch an existing bookmark. Only fields present in `patch` are changed;
   * `updated_at` is always refreshed, `created_at` never changes.
   */
  update(
    id: number,
    patch: { title?: string; tags?: string[]; note?: string },
    now: Date = new Date(),
  ): Bookmark {
    const bookmark = this.getById(id);
    if (!bookmark) {
      throw new CliError(`No bookmark with id ${id}.`);
    }
    if (patch.title !== undefined) bookmark.title = patch.title;
    if (patch.tags !== undefined) bookmark.tags = [...patch.tags];
    if (patch.note !== undefined) bookmark.note = patch.note;
    bookmark.updated_at = now.toISOString();
    return bookmark;
  }

  /** Remove a bookmark by id. The freed id is never reused. Returns whether it existed. */
  remove(id: number): boolean {
    const before = this.data.bookmarks.length;
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== id);
    return this.data.bookmarks.length < before;
  }
}
