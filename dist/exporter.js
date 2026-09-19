import { byNewestFirst } from './store.js';
/**
 * Hand-written serializers for the three export formats (spec: no third-party
 * libraries). Each is a pure function of the store data. Contract: the return
 * value never ends with a trailing newline - the `export` command owns the
 * final-newline handling for both stdout and `-o <file>`.
 */
/**
 * Group name under which bookmarks carrying no tags are exported. Wording
 * follows the CONTEXT.md term list: "无标签" (no tags), never "未分类"
 * ("分类" is on the Avoid list — this tool has tags only, no categories).
 * When such an HTML export is re-imported the folder name comes back as a
 * real tag; that asymmetry is inherent to the Netscape format, which has no
 * way to express "no tag".
 */
export const UNTAGGED_GROUP = '无标签';
/**
 * One group per tag; a bookmark with several tags enters every one of its
 * tag groups (multiple entrances are a feature, ADR-0001). Tag groups are
 * emitted in plain Unicode code-point order (not locale-aware), so the output
 * is byte-identical across platforms. The untagged group ("无标签") always
 * comes last. Duplicate tags on one bookmark are collapsed so it appears once
 * per group even in a hand-edited store.
 */
export function groupByTag(bookmarks) {
    const byTag = new Map();
    const untagged = [];
    for (const bm of bookmarks) {
        const tags = [...new Set(bm.tags)];
        if (tags.length === 0) {
            untagged.push(bm);
            continue;
        }
        for (const tag of tags) {
            const members = byTag.get(tag);
            if (members) {
                members.push(bm);
            }
            else {
                byTag.set(tag, [bm]);
            }
        }
    }
    const groups = [...byTag.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([tag, members]) => ({ tag, bookmarks: members.sort(byNewestFirst) }));
    if (untagged.length > 0) {
        groups.push({ tag: UNTAGGED_GROUP, bookmarks: untagged.sort(byNewestFirst) });
    }
    return groups;
}
/** Escape Markdown link text: brackets would break out of `[text](url)`. */
function escapeMdText(text) {
    return text.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}
/** Escape a Markdown link destination: parens would terminate it early. */
function escapeMdUrl(url) {
    return url.replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
/**
 * Markdown export: a top-level title, then one `## <tag>` section per group
 * with `- [Title](url)` entries; a non-empty note becomes an indented line
 * right under its entry. Structural grouping matches the HTML export.
 */
export function toMarkdown(data) {
    const lines = ['# Bookmarks'];
    for (const group of groupByTag(data.bookmarks)) {
        lines.push('', `## ${group.tag}`, '');
        for (const bm of group.bookmarks) {
            lines.push(`- [${escapeMdText(bm.title)}](${escapeMdUrl(bm.url)})`);
            if (bm.note !== '') {
                for (const noteLine of bm.note.split('\n')) {
                    lines.push(`  ${noteLine}`);
                }
            }
        }
    }
    return lines.join('\n');
}
/** Escape text and attribute values: `& < > "` in both contexts. */
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/** ISO 8601 UTC -> Unix seconds for ADD_DATE attributes (0 if unparsable). */
function unixSeconds(iso) {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
/**
 * Netscape bookmark HTML (the format Chrome/Firefox import). Structural
 * grouping matches the Markdown export: one first-level folder (`<H3>`) per
 * tag, multiple entrances for multi-tag bookmarks, "无标签" folder last.
 * Each `<A>` carries ADD_DATE, the Unix seconds of the bookmark's created_at.
 */
export function toNetscapeHtml(data) {
    const lines = [
        '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
        '<!-- This is an automatically generated file.',
        'It will be read and overwritten.',
        'DO NOT EDIT! -->',
        '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
        '<TITLE>Bookmarks</TITLE>',
        '<H1>Bookmarks</H1>',
        '<DL><p>',
    ];
    for (const group of groupByTag(data.bookmarks)) {
        lines.push(`    <DT><H3>${escapeHtml(group.tag)}</H3>`);
        lines.push('    <DL><p>');
        for (const bm of group.bookmarks) {
            lines.push(`        <DT><A HREF="${escapeHtml(bm.url)}" ADD_DATE="${unixSeconds(bm.created_at)}">${escapeHtml(bm.title)}</A>`);
        }
        lines.push('    </DL><p>');
    }
    lines.push('</DL><p>');
    return lines.join('\n');
}
/**
 * JSON export = the storage format itself (lossless backup): the whole
 * StoreData including the id counter, human-readable 2-space JSON. Only with
 * the counter included can a later import restore ids exactly and keep
 * deleted-id gaps from being reused.
 */
export function toJson(data) {
    return JSON.stringify(data, null, 2);
}
