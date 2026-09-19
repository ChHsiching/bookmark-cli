import { createInterface } from 'node:readline';
import { Store } from '../store.js';
import { CliError, RmOptions } from '../types.js';
import { parseId } from './id.js';

/** Dependencies that tests can inject (no real terminal needed). */
export interface RmDeps {
  store?: Store;
  /**
   * Shows the one-line confirmation `prompt` and resolves with the answer
   * line. Default: a single readline question on the real stdin/stdout.
   */
  readAnswer?: (prompt: string) => Promise<string>;
}

/** Ask one question on the real terminal; close the interface right after. */
function askOnTerminal(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * `bm rm <id>`: permanent delete (no trash). By default a one-line y/n
 * confirmation naming the bookmark is shown; exactly `y` (trimmed) deletes,
 * anything else — including an empty line or EOF — keeps the bookmark and
 * still exits 0. `-y/--yes` skips the prompt.
 */
export async function runRm(
  idArg: string,
  opts: RmOptions,
  deps: RmDeps = {},
): Promise<void> {
  const id = parseId(idArg);
  const store = deps.store ?? Store.load();
  const readAnswer = deps.readAnswer ?? askOnTerminal;

  const bookmark = store.getById(id);
  if (!bookmark) {
    throw new CliError(`No bookmark with id ${id}.`);
  }
  const target = `#${bookmark.id} ${bookmark.url} (${bookmark.title})`;

  if (!opts.yes) {
    const raw = await readAnswer(`Delete ${target}? [y/N] `);
    if (String(raw ?? '').trim() !== 'y') {
      console.log(`Not deleted: ${target}`);
      return;
    }
  }

  store.remove(id);
  store.save();
  console.log(`Deleted ${target}`);
}
