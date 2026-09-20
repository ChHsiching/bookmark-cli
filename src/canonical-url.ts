/**
 * The single authority on Bookmark URL identity (ADR-0003, CONTEXT.md
 * 「规范形」): raw URL in, canonical form out — or null when the input is
 * not a bookmarkable web URL.
 *
 * The canonical form is conservative WHATWG normalization: only spellings
 * of the same resource fold together (scheme/host lowercased, default port
 * dropped, empty path becomes "/"). Query and fragment are kept verbatim,
 * "www." is not stripped, parameters are not reordered — a bookmark must
 * open the same page the user saved.
 */
export function canonicalUrl(raw: string): string | null {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }
  return parsed.href;
}
