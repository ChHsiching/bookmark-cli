/**
 * TitleFetcher: the ONLY network boundary of bookmark-cli. It exists as an
 * injectable function so every code path — including the timeout/offline
 * fallback to the URL host — is testable without real network access.
 *
 * Contract: resolve to the page <title>, or to null on any failure (timeout,
 * non-HTML response, network error). It never throws, so a fetch failure can
 * never fail an `add`.
 */
export const DEFAULT_TITLE_FETCH_TIMEOUT_MS = 3000;
const USER_AGENT = 'bookmark-cli/0.1 (+https://github.com/ChHsiching/bookmark-cli)';
/**
 * Build a TitleFetcher. The default implementation uses the Node built-in
 * fetch with an AbortController-enforced timeout (3s by default).
 *
 * Testing escape hatch: setting BM_NO_TITLE_FETCH=1 in the environment makes
 * the default implementation resolve to null without touching the network.
 * It exists so subprocess-level CLI tests stay hermetic; it is not a public
 * configuration surface.
 */
export function createTitleFetcher(deps = {}) {
    const env = deps.env ?? process.env;
    const timeoutMs = deps.timeoutMs ?? DEFAULT_TITLE_FETCH_TIMEOUT_MS;
    const doFetch = deps.fetch ?? ((url, init) => fetch(url, init));
    return async (url) => {
        if (env.BM_NO_TITLE_FETCH === '1')
            return null;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await doFetch(url, {
                signal: controller.signal,
                redirect: 'follow',
                headers: {
                    'user-agent': USER_AGENT,
                    accept: 'text/html,application/xhtml+xml',
                },
            });
            if (!response.ok)
                return null;
            // A declared non-HTML type is a failure. An absent type is sniffed by
            // the extractor instead: a text/plain body simply has no <title>.
            const contentType = response.headers?.get('content-type')?.toLowerCase() ?? '';
            if (contentType && !contentType.includes('html'))
                return null;
            const body = await response.text();
            return extractTitle(body);
        }
        catch {
            // Timeout, DNS failure, connection reset, body read error: unknown
            // title, never a hard error.
            return null;
        }
        finally {
            clearTimeout(timer);
        }
    };
}
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title\s*>/i;
/**
 * Hand-written <title> extraction (no third-party HTML parser): first
 * case-insensitive match, attributes tolerated, whitespace collapsed.
 * Returns null for a missing or effectively empty title.
 */
export function extractTitle(html) {
    const match = TITLE_RE.exec(html);
    if (!match)
        return null;
    const title = decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim();
    return title === '' ? null : title;
}
const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
    copy: '\u00a9',
    reg: '\u00ae',
    hellip: '\u2026',
    mdash: '\u2014',
    ndash: '\u2013',
    laquo: '\u00ab',
    raquo: '\u00bb',
};
const ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g;
/** Basic HTML entity decoding: the common named set plus numeric forms. */
function decodeHtmlEntities(input) {
    return input.replace(ENTITY_RE, (original, body) => {
        if (body.startsWith('#')) {
            const isHex = body[1] === 'x' || body[1] === 'X';
            const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
            if (!Number.isFinite(code) || code < 1 || code > 0x10ffff)
                return original;
            try {
                return String.fromCodePoint(code);
            }
            catch {
                return original;
            }
        }
        const named = NAMED_ENTITIES[body];
        return named !== undefined ? named : original;
    });
}
