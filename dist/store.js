import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from 'node:fs';
import { dirname, join } from 'node:path';
import { CliError } from './types.js';
/**
 * Resolve the store file location using platform conventions, derived from
 * standard system environment variables (this is OS convention, not product
 * configuration):
 * - Windows: %APPDATA%\bookmark-cli\bookmarks.json
 * - macOS:   ~/Library/Application Support/bookmark-cli/bookmarks.json
 * - Linux:   $XDG_CONFIG_HOME (default ~/.config)/bookmark-cli/bookmarks.json
 */
export function resolveStorePath(env = process.env, platform = process.platform) {
    if (platform === 'win32') {
        const appData = env.APPDATA ||
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
    const configHome = env.XDG_CONFIG_HOME || (env.HOME ? join(env.HOME, '.config') : undefined);
    if (!configHome) {
        throw new CliError('Cannot locate config directory: neither XDG_CONFIG_HOME nor HOME is set.');
    }
    return join(configHome, 'bookmark-cli', 'bookmarks.json');
}
/** Thrown when adding a URL that already exists in the store. */
export class DuplicateUrlError extends Error {
    existingId;
    url;
    constructor(existingId, url) {
        super(`URL already bookmarked as #${existingId}: ${url}`);
        this.existingId = existingId;
        this.url = url;
        this.name = 'DuplicateUrlError';
    }
}
export function emptyStore() {
    return { bookmarks: [], nextId: 1 };
}
function byNewestFirst(a, b) {
    const byTime = Date.parse(b.created_at) - Date.parse(a.created_at);
    return byTime !== 0 ? byTime : b.id - a.id;
}
/**
 * The bookmark store: a single human-readable JSON file. The path is
 * injectable so tests never touch the real user directory.
 */
export class Store {
    path;
    data;
    constructor(path, data) {
        this.path = path;
        this.data = data;
    }
    /** Load the store from `path` (default: the platform-conventional path). */
    static load(path) {
        const file = path ?? resolveStorePath();
        if (!existsSync(file)) {
            return new Store(file, emptyStore());
        }
        let raw;
        try {
            raw = readFileSync(file, 'utf8');
        }
        catch (err) {
            throw new CliError(`Cannot read store file ${file}: ${err.message}`);
        }
        if (raw.trim() === '') {
            return new Store(file, emptyStore());
        }
        try {
            const parsed = JSON.parse(raw);
            if (!parsed ||
                !Array.isArray(parsed.bookmarks) ||
                typeof parsed.nextId !== 'number') {
                throw new Error('expected an object with a "bookmarks" array and a "nextId" number');
            }
            return new Store(file, parsed);
        }
        catch (err) {
            throw new CliError(`Store file is corrupted (${file}): ${err.message}`);
        }
    }
    /**
     * Wrap already-composed data as a Store bound to `path` without reading any
     * file. Used by restore-style import, which merges the data itself and then
     * persists through the usual atomic save().
     */
    static adopt(path, data) {
        return new Store(path, data);
    }
    /**
     * Full rewrite of the store file, human-readable (2-space indentation,
     * trailing newline). Writes via a temp file + rename so a crash mid-write
     * cannot truncate the existing store.
     */
    save() {
        mkdirSync(dirname(this.path), { recursive: true });
        const json = JSON.stringify(this.data, null, 2) + '\n';
        const tmp = `${this.path}.tmp`;
        writeFileSync(tmp, json, 'utf8');
        try {
            renameSync(tmp, this.path);
        }
        catch {
            // Rename can fail on some filesystems when the destination is held
            // open (e.g. antivirus on Windows); fall back to a direct write.
            writeFileSync(this.path, json, 'utf8');
            try {
                rmSync(tmp, { force: true });
            }
            catch {
                // best effort cleanup
            }
        }
    }
    /** All bookmarks, in insertion order. */
    all() {
        return [...this.data.bookmarks];
    }
    /** All bookmarks sorted newest-first (ties broken by higher id first). */
    listNewestFirst() {
        return this.all().sort(byNewestFirst);
    }
    /**
     * A deep copy of the full stored data (bookmarks + id counter). Read-only
     * view for consumers such as export; mutating it never touches the store.
     */
    snapshot() {
        return structuredClone(this.data);
    }
    getByUrl(url) {
        return this.data.bookmarks.find((b) => b.url === url);
    }
    getById(id) {
        return this.data.bookmarks.find((b) => b.id === id);
    }
    /**
     * Append a new bookmark. Assigns the next id from the persisted counter.
     * Throws DuplicateUrlError if the URL already exists.
     */
    add(input) {
        const existing = this.getByUrl(input.url);
        if (existing) {
            throw new DuplicateUrlError(existing.id, input.url);
        }
        const now = (input.now ?? new Date()).toISOString();
        const bookmark = {
            id: this.data.nextId,
            url: input.url,
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
    update(id, patch, now = new Date()) {
        const bookmark = this.getById(id);
        if (!bookmark) {
            throw new CliError(`No bookmark with id ${id}.`);
        }
        if (patch.title !== undefined)
            bookmark.title = patch.title;
        if (patch.tags !== undefined)
            bookmark.tags = [...patch.tags];
        if (patch.note !== undefined)
            bookmark.note = patch.note;
        bookmark.updated_at = now.toISOString();
        return bookmark;
    }
    /** Remove a bookmark by id. The freed id is never reused. Returns whether it existed. */
    remove(id) {
        const before = this.data.bookmarks.length;
        this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== id);
        return this.data.bookmarks.length < before;
    }
}
