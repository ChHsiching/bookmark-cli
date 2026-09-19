import { Store } from '../store.js';
/** ISO 8601 UTC -> "YYYY-MM-DD HH:mm" in the local timezone (display only). */
export function formatLocalDateTime(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return (`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}`);
}
export function formatBookmark(bm) {
    const tags = bm.tags.length > 0 ? ` [${bm.tags.join(', ')}]` : '';
    return `#${bm.id}  ${formatLocalDateTime(bm.created_at)}  ${bm.title}  ${bm.url}${tags}`;
}
export async function runList(opts, deps = {}) {
    const store = deps.store ?? Store.load();
    let items = store.listNewestFirst();
    if (opts.tag !== undefined) {
        items = items.filter((bm) => bm.tags.includes(opts.tag));
    }
    if (opts.json) {
        // Machine-readable output: the storage representation as a JSON array.
        console.log(JSON.stringify(items, null, 2));
        return;
    }
    for (const bm of items) {
        console.log(formatBookmark(bm));
    }
}
