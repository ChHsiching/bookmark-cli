import { defaultOpener, Opener } from '../opener.js';
import { Store } from '../store.js';
import { CliError } from '../types.js';

/** Dependencies that tests (and later tickets) can inject. */
export interface OpenDeps {
  store?: Store;
  opener?: Opener;
}

/** Parse a user-supplied id argument: a positive integer, nothing else. */
export function parseId(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) {
    throw new CliError(`Invalid bookmark id: ${raw}`);
  }
  return Number(trimmed);
}

export async function runOpen(rawId: string, deps: OpenDeps = {}): Promise<void> {
  const id = parseId(rawId);
  const store = deps.store ?? Store.load();
  const bookmark = store.getById(id);
  if (!bookmark) {
    throw new CliError(`No bookmark with id ${id}.`);
  }
  const opener = deps.opener ?? defaultOpener;
  try {
    await opener(bookmark.url);
  } catch (err) {
    throw new CliError(
      `Failed to open #${bookmark.id} (${bookmark.url}): ${(err as Error).message}`,
    );
  }
  console.log(`Opened #${bookmark.id} ${bookmark.url}`);
}
