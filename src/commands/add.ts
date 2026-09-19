import { Store } from '../store.js';
import { AddOptions, CliError } from '../types.js';

/** Dependencies that later tickets (and tests) can inject. */
export interface AddDeps {
  store?: Store;
  now?: () => Date;
}

/**
 * Title fallback when no fetch happened / no --title given: the host part of
 * the URL (spec: "标题自动抓取失败时回退为域名").
 */
export function titleFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Split a comma-separated tag list: trim, drop empties, dedupe (keep order). */
export function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of raw.split(',')) {
    const tag = part.trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

/** Validate and return the trimmed URL. Only http(s) with a host is accepted. */
function parseUrl(raw: string): string {
  const url = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CliError(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CliError(`Only http(s) URLs are supported: ${url}`);
  }
  if (!parsed.hostname) {
    throw new CliError(`Invalid URL (missing host): ${url}`);
  }
  return url;
}

export async function runAdd(
  rawUrl: string,
  opts: AddOptions,
  deps: AddDeps = {},
): Promise<void> {
  const url = parseUrl(rawUrl);
  const store = deps.store ?? Store.load();
  const now = deps.now ?? (() => new Date());

  const existing = store.getByUrl(url);
  if (existing && !opts.force) {
    throw new CliError(
      `URL already exists: bookmark #${existing.id} (${url}). Use --force to update it.`,
    );
  }

  if (existing) {
    // --force: refresh the fields given on the command line, keep the rest,
    // always refresh updated_at. Identity (url) and created_at stay put.
    const updated = store.update(
      existing.id,
      {
        ...(opts.title !== undefined ? { title: opts.title } : {}),
        ...(opts.tags !== undefined ? { tags: parseTags(opts.tags) } : {}),
        ...(opts.note !== undefined ? { note: opts.note } : {}),
      },
      now(),
    );
    store.save();
    console.log(`Updated #${updated.id} ${updated.url} (${updated.title})`);
    return;
  }

  const bookmark = store.add({
    url,
    title: opts.title ?? titleFromUrl(url),
    tags: parseTags(opts.tags),
    note: opts.note ?? '',
    now: now(),
  });
  store.save();
  console.log(`Added #${bookmark.id} ${bookmark.url} (${bookmark.title})`);
}
