/**
 * Fuzzy search over bookmarks (spec: "search 语义" — 标题+标签+URL+备注
 * 全字段模糊匹配). Hand-written subsequence matching, no third-party
 * fuzzy library.
 *
 * A query matches a field when its characters appear in the field in order
 * (a subsequence), case-insensitively. The quality of the subsequence match
 * scales with how contiguous it is and how early in the field it starts;
 * that quality is multiplied by a per-field weight.
 *
 * Field weights (rationale: how strongly a hit in that field predicts
 * "this is the bookmark you wanted"):
 * - title 100: the primary human handle for a page; users remember it best
 * - tag    60: a curated keyword, a strong semantic signal
 * - url    40: structural; users recall fragments such as the domain
 * - note   20: free-form prose, the least specific field
 */
export const FIELD_WEIGHTS = { title: 100, tag: 60, url: 40, note: 20 };
/** A match starting at index i loses 2% per character, capped at 20%. */
const START_PENALTY_PER_CHAR = 0.02;
const MAX_PENALIZED_START = 10;
/**
 * Greedy subsequence match of `query` inside `text` (both pre-lowercased).
 * Returns a match quality in (0, 1], or null when query is not a
 * subsequence of text.
 *
 * quality = density * (1 - startPenalty), where
 * - density = sum(runLength^2) / queryLength^2 over runs of consecutively
 *   matched positions: a fully contiguous match scores 1.0, a scattered
 *   one scores proportionally less (a contiguous chunk is a much stronger
 *   "the user typed a real fragment" signal than the same letters spread
 *   across the field);
 * - startPenalty = 2% per character of leading distance (capped at 20%):
 *   a match at the very beginning of the field beats the same match
 *   buried mid-field (searching "git" should prefer "GitHub Docs" over
 *   "digitally...").
 */
function subsequenceQuality(query, text) {
    if (query.length === 0 || query.length > text.length) {
        return null;
    }
    let from = 0;
    const positions = [];
    for (const ch of query) {
        const at = text.indexOf(ch, from);
        if (at === -1) {
            return null;
        }
        positions.push(at);
        from = at + 1;
    }
    let squaredRunSum = 0;
    let run = 1;
    for (let i = 1; i < positions.length; i += 1) {
        if (positions[i] === positions[i - 1] + 1) {
            run += 1;
        }
        else {
            squaredRunSum += run * run;
            run = 1;
        }
    }
    squaredRunSum += run * run;
    const density = squaredRunSum / (positions.length * positions.length);
    const startPenalty = Math.min(positions[0], MAX_PENALIZED_START) * START_PENALTY_PER_CHAR;
    return density * (1 - startPenalty);
}
/**
 * Score one bookmark against a query: the sum of weight * quality over every
 * field that matched. Titles and the URL are scored as single fields; tags
 * are each scored on their own (a tag is an independent keyword) and the
 * best-matching tag carries the signal — summing across tags would
 * double-count one query hitting several near-identical tags.
 * Returns 0 when nothing matches (or the query is blank).
 */
export function scoreBookmark(query, bookmark) {
    const q = query.trim().toLowerCase();
    if (!q) {
        return 0;
    }
    let total = 0;
    const titleQuality = subsequenceQuality(q, bookmark.title.toLowerCase());
    if (titleQuality !== null) {
        total += FIELD_WEIGHTS.title * titleQuality;
    }
    let bestTagQuality = null;
    for (const tag of bookmark.tags) {
        const tagQuality = subsequenceQuality(q, tag.toLowerCase());
        if (tagQuality !== null && (bestTagQuality === null || tagQuality > bestTagQuality)) {
            bestTagQuality = tagQuality;
        }
    }
    if (bestTagQuality !== null) {
        total += FIELD_WEIGHTS.tag * bestTagQuality;
    }
    const urlQuality = subsequenceQuality(q, bookmark.url.toLowerCase());
    if (urlQuality !== null) {
        total += FIELD_WEIGHTS.url * urlQuality;
    }
    const noteQuality = subsequenceQuality(q, bookmark.note.toLowerCase());
    if (noteQuality !== null) {
        total += FIELD_WEIGHTS.note * noteQuality;
    }
    return total;
}
/**
 * All bookmarks matching `query`, sorted by score descending; ties broken by
 * created_at descending (newest first, matching the spec), then by id
 * descending for determinism when scores and timestamps are identical.
 */
export function searchBookmarks(query, bookmarks) {
    const q = query.trim();
    if (!q) {
        return [];
    }
    return bookmarks
        .map((bookmark) => ({ bookmark, score: scoreBookmark(q, bookmark) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        const byTime = Date.parse(b.bookmark.created_at) - Date.parse(a.bookmark.created_at);
        if (byTime !== 0) {
            return byTime;
        }
        return b.bookmark.id - a.bookmark.id;
    })
        .map((entry) => entry.bookmark);
}
