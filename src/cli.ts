#!/usr/bin/env node
import { Command } from 'commander';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClipboardReader } from './clipboard.js';
import { AddDeps, runAdd } from './commands/add.js';
import { runEdit } from './commands/edit.js';
import { runExport } from './commands/export.js';
import { runImport } from './commands/import.js';
import { runList } from './commands/list.js';
import { runOpen } from './commands/open.js';
import { runRm } from './commands/rm.js';
import { runSearch } from './commands/search.js';
import { runTags } from './commands/tags.js';
import { createTitleFetcher } from './title-fetcher.js';
import { version } from './version.js';
import {
  AddOptions,
  CliError,
  EditOptions,
  ExportOptions,
  ListOptions,
  RmOptions,
  SearchOptions,
} from './types.js';

/**
 * Injectable command dependencies. Commands keep hermetic defaults (no
 * network, no clipboard); the real implementations are wired in here.
 */
export interface ProgramDeps {
  add?: AddDeps;
}

/** Real implementations of the add command's injectable dependencies. */
function defaultAddDeps(): AddDeps {
  return {
    fetchTitle: createTitleFetcher(),
    readClipboard: createClipboardReader(),
  };
}

/**
 * Build the commander program. Each subcommand is registered here with its
 * arguments/options only; behavior lives in src/commands/*.ts. Later tickets
 * add new commands by adding files and one registration block here.
 */
export function buildProgram(deps: ProgramDeps = {}): Command {
  const program = new Command();
  program
    .name('bm')
    .description('Personal command-line bookmark manager')
    .version(version);

  program
    .command('add')
    .description('save a URL as a bookmark (from the argument or the clipboard)')
    .argument('[url]', 'URL to bookmark (http/https); omit to read the clipboard')
    .option('--title <title>', 'bookmark title (default: the page <title>, then the URL host)')
    .option('--tags <tags>', 'comma-separated tags, e.g. "demo,a"')
    .option('--note <note>', 'free-text note')
    .option('--force', 'update the existing bookmark if the URL is already saved')
    .action(async (url: string | undefined, opts: AddOptions) => {
      await runAdd(url, opts, deps.add ?? defaultAddDeps());
    });

  program
    .command('list')
    .description('list bookmarks, newest first')
    .option('--tag <tag>', 'only bookmarks carrying this tag')
    .option('--json', 'machine-readable JSON output')
    .action(async (opts: ListOptions) => {
      await runList(opts);
    });

  program
    .command('search')
    .description('fuzzy-search bookmarks across title, tags, URL and note')
    .argument('<query>', 'fuzzy query; best matches first')
    .option('--json', 'machine-readable JSON output')
    .option('--open', 'open the best match in the default browser')
    .action(async (query: string, opts: SearchOptions) => {
      await runSearch(query, opts);
    });

  program
    .command('open')
    .description('open a bookmark by id in the default browser')
    .argument('<id>', 'id of the bookmark to open')
    .action(async (id: string) => {
      await runOpen(id);
    });

  program
    .command('edit')
    .description('edit a bookmark by id')
    .argument('<id>', 'id of the bookmark')
    .option('--title <title>', 'new title')
    .option('--note <note>', 'new note')
    .option(
      '--tags <tags>',
      'comma-separated tags replacing the current ones entirely, e.g. "x,y" ("" clears)',
    )
    .action(async (id: string, opts: EditOptions) => {
      await runEdit(id, opts);
    });

  program
    .command('rm')
    .description('delete a bookmark by id (permanent, no trash)')
    .argument('<id>', 'id of the bookmark')
    .option('-y, --yes', 'skip the confirmation prompt')
    .action(async (id: string, opts: RmOptions) => {
      await runRm(id, opts);
    });

  program
    .command('tags')
    .description('list all tags with their bookmark counts (count desc, then A-Z)')
    .action(async () => {
      await runTags();
    });

  program
    .command('export')
    .description('export bookmarks as Markdown, browser-importable HTML, or JSON')
    .option('--format <format>', 'output format: md | html | json (default: md)')
    .option('-o, --output <file>', 'write to <file> instead of stdout')
    .action(async (opts: ExportOptions) => {
      await runExport(opts);
    });

  program
    .command('import')
    .description('import a Netscape bookmark HTML file or a bookmark-cli JSON backup')
    .argument('<file>', 'file to import (format auto-detected)')
    .action(async (file: string) => {
      await runImport(file);
    });

  return program;
}

/** Parse argv; user-facing errors print to stderr and set exit code 1. */
export async function main(argv: string[] = process.argv): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (err) {
    if (err instanceof CliError) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

/**
 * True when this module is the Node entry script. Node resolves the entry
 * through symlinks (junction-based node installs like nvm-windows, Homebrew),
 * so argv[1] can name a different path than import.meta.url; comparing
 * realpaths handles that, and Windows paths compare case-insensitively.
 */
const invokedAsScript = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const invoked = realpathSync(resolve(entry));
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32'
      ? invoked.toLowerCase() === modulePath.toLowerCase()
      : invoked === modulePath;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  void main();
}
