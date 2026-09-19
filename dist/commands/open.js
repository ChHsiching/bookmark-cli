import { defaultOpener } from '../opener.js';
import { Store } from '../store.js';
import { CliError } from '../types.js';
import { parseId } from './id.js';
export async function runOpen(rawId, deps = {}) {
    const id = parseId(rawId);
    const store = deps.store ?? Store.load();
    const bookmark = store.getById(id);
    if (!bookmark) {
        throw new CliError(`No bookmark with id ${id}.`);
    }
    const opener = deps.opener ?? defaultOpener;
    try {
        await opener(bookmark.url);
    }
    catch (err) {
        throw new CliError(`Failed to open #${bookmark.id} (${bookmark.url}): ${err.message}`);
    }
    console.log(`Opened #${bookmark.id} ${bookmark.url}`);
}
