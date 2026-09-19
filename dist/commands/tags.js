import { Store } from '../store.js';
/**
 * Count bookmarks per tag (a bookmark carrying a duplicated tag counts once)
 * and sort for display: count descending, ties by tag in **codepoint order**
 * (a plain `<` comparison — locale-independent, so the output is identical on
 * every machine; `localeCompare` would depend on the host's locale).
 */
export function countTags(bookmarks) {
    const counts = new Map();
    for (const bm of bookmarks) {
        for (const tag of new Set(bm.tags)) {
            counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
    }
    return [...counts.entries()]
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => {
        if (b.count !== a.count)
            return b.count - a.count;
        return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
    });
}
/** `bm tags`: one `<count>  <tag>` line per tag, nothing when the store is empty. */
export async function runTags(deps = {}) {
    const store = deps.store ?? Store.load();
    for (const { tag, count } of countTags(store.all())) {
        console.log(`${count}  ${tag}`);
    }
}
