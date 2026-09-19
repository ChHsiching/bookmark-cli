import { searchBookmarks } from '../search.js';
import { Store } from '../store.js';
import { Opener, defaultOpener } from '../opener.js';
import { Bookmark, CliError, SearchOptions } from '../types.js';

/** Dependencies that tests (and later tickets) can inject. */
export interface SearchDeps {
  store?: Store;
  opener?: Opener;
}

/** One result line: ID, title, URL (spec: search prints exactly these). */
export function formatSearchResult(bm: Bookmark): string {
  return `#${bm.id}  ${bm.title}  ${bm.url}`;
}

export async function runSearch(
  query: string,
  opts: SearchOptions,
  deps: SearchDeps = {},
): Promise<void> {
  const store = deps.store ?? Store.load();
  const results = searchBookmarks(query, store.all());

  if (opts.open) {
    // Open the best match in one step; with nothing to open that is an
    // error, not an empty listing.
    if (results.length === 0) {
      throw new CliError(`No bookmark matches "${query.trim()}".`);
    }
    const best = results[0] as Bookmark;
    const opener = deps.opener ?? defaultOpener;
    try {
      await opener(best.url);
    } catch (err) {
      throw new CliError(
        `Failed to open #${best.id} (${best.url}): ${(err as Error).message}`,
      );
    }
    // The "Opened" notice is human-facing progress, not data. With --json
    // stdout must stay machine-pure (jq-parseable), so the notice moves to
    // stderr — kept rather than dropped, the information still travels.
    if (opts.json) {
      console.error(`Opened #${best.id} ${best.url}`);
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(`Opened #${best.id} ${best.url}`);
    }
    return;
  }

  if (opts.json) {
    // Machine-readable output: full bookmark objects, jq-parseable.
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  // No matches as plain text prints nothing and exits 0, mirroring
  // `list --tag <missing>` (an empty result set is not an error).
  for (const bm of results) {
    console.log(formatSearchResult(bm));
  }
}
