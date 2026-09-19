import { Store } from '../store.js';
import { CliError, EditOptions } from '../types.js';
import { parseTags } from './add.js';
import { parseId } from './id.js';

/** Dependencies that later tickets (and tests) can inject. */
export interface EditDeps {
  store?: Store;
  now?: () => Date;
}

/**
 * `bm edit <id> --title/--note/--tags`: patch the given fields and refresh
 * `updated_at`; `created_at` and the url (identity) never change.
 *
 * `--tags` is a **full replacement** (ADR/spec: "看到的就是最终状态"):
 * after editing, the bookmark's tags are exactly the given list — `--tags ""`
 * clears all tags. Fields not passed on the command line are left untouched.
 */
export async function runEdit(
  idArg: string,
  opts: EditOptions,
  deps: EditDeps = {},
): Promise<void> {
  const id = parseId(idArg);
  const store = deps.store ?? Store.load();
  const now = deps.now ?? (() => new Date());

  if (!store.getById(id)) {
    throw new CliError(`No bookmark with id ${id}.`);
  }

  const patch: { title?: string; tags?: string[]; note?: string } = {};
  if (opts.title !== undefined) patch.title = opts.title;
  if (opts.note !== undefined) patch.note = opts.note;
  if (opts.tags !== undefined) patch.tags = parseTags(opts.tags);
  if (patch.title === undefined && patch.note === undefined && patch.tags === undefined) {
    throw new CliError('Nothing to edit: pass --title, --note, or --tags.');
  }

  const updated = store.update(id, patch, now());
  store.save();
  console.log(`Edited #${updated.id} ${updated.url} (${updated.title})`);
}
