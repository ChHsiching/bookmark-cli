import { Store } from '../store.js';
import { CliError } from '../types.js';
import { canonicalUrl } from '../canonical-url.js';
/**
 * Title fallback when no fetch happened / no --title given: the host part of
 * the URL (spec: "标题自动抓取失败时回退为域名").
 */
export function titleFromUrl(url) {
    try {
        return new URL(url).host;
    }
    catch {
        return url;
    }
}
/** Split a comma-separated tag list: trim, drop empties, dedupe (keep order). */
export function parseTags(raw) {
    if (!raw)
        return [];
    const seen = new Set();
    const tags = [];
    for (const part of raw.split(',')) {
        const tag = part.trim();
        if (tag && !seen.has(tag)) {
            seen.add(tag);
            tags.push(tag);
        }
    }
    return tags;
}
/**
 * Validate the URL the user handed us and return its canonical form
 * (ADR-0003). The identity rules live in canonical-url; this wrapper only
 * owns the user-facing error wording.
 */
function parseUrl(raw) {
    const canonical = canonicalUrl(raw);
    if (canonical === null) {
        throw new CliError(`Only http(s) URLs are supported: ${raw.trim()}`);
    }
    return canonical;
}
/**
 * Resolve the URL to bookmark: from the argument when given, otherwise from
 * the clipboard. Clipboard content must itself be a valid http(s) URL.
 */
async function resolveUrl(rawUrl, readClipboard) {
    const fromArg = rawUrl?.trim() ?? '';
    if (fromArg !== '') {
        return parseUrl(fromArg);
    }
    if (!readClipboard) {
        throw new CliError('No URL given. Usage: bm add <url> — or copy an http(s) URL and run bm add.');
    }
    let text = '';
    try {
        text = (await readClipboard()).trim();
    }
    catch {
        text = '';
    }
    if (text === '') {
        throw new CliError('Clipboard is empty or unreadable. Copy an http(s) URL, or pass it as an argument.');
    }
    try {
        return parseUrl(text);
    }
    catch {
        const preview = text.length > 60 ? `${text.slice(0, 57)}...` : text;
        throw new CliError(`Clipboard does not contain a valid http(s) URL: "${preview}"`);
    }
}
/**
 * --title always wins; otherwise ask the fetcher (when one is wired) and
 * trust its never-throws contract only up to a defensive catch: a fetch
 * failure must never fail the add.
 */
async function fetchTitleIfPossible(url, opts, deps) {
    if (opts.title !== undefined || !deps.fetchTitle)
        return null;
    try {
        const fetched = await deps.fetchTitle(url);
        return fetched !== null && fetched.trim() !== '' ? fetched.trim() : null;
    }
    catch {
        return null;
    }
}
export async function runAdd(rawUrl, opts, deps = {}) {
    const url = await resolveUrl(rawUrl, deps.readClipboard);
    const store = deps.store ?? Store.load();
    const now = deps.now ?? (() => new Date());
    const existing = store.getByUrl(url);
    if (existing && !opts.force) {
        throw new CliError(`URL already exists: bookmark #${existing.id} (${url}). Use --force to update it.`);
    }
    const fetchedTitle = await fetchTitleIfPossible(url, opts, deps);
    if (existing) {
        // --force: refresh the fields given on the command line, keep the rest,
        // always refresh updated_at. Identity (url) and created_at stay put.
        // Without --title the title is re-fetched; a fetch miss keeps the old
        // title rather than degrading it to the host (spec story 9).
        const updated = store.update(existing.id, {
            ...(opts.title !== undefined
                ? { title: opts.title }
                : fetchedTitle !== null
                    ? { title: fetchedTitle }
                    : {}),
            ...(opts.tags !== undefined ? { tags: parseTags(opts.tags) } : {}),
            ...(opts.note !== undefined ? { note: opts.note } : {}),
        }, now());
        store.save();
        console.log(`Updated #${updated.id} ${updated.url} (${updated.title})`);
        return;
    }
    const bookmark = store.add({
        url,
        title: opts.title ?? fetchedTitle ?? titleFromUrl(url),
        tags: parseTags(opts.tags),
        note: opts.note ?? '',
        now: now(),
    });
    store.save();
    console.log(`Added #${bookmark.id} ${bookmark.url} (${bookmark.title})`);
}
