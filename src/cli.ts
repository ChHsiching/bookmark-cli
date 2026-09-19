#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAdd } from './commands/add.js';
import { runList } from './commands/list.js';
import { runOpen } from './commands/open.js';
import { runSearch } from './commands/search.js';
import { AddOptions, CliError, ListOptions, SearchOptions } from './types.js';

/**
 * Build the commander program. Each subcommand is registered here with its
 * arguments/options only; behavior lives in src/commands/*.ts. Later tickets
 * add new commands by adding files and one registration block here.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('bm')
    .description('Personal command-line bookmark manager')
    .version('0.1.0');

  program
    .command('add')
    .description('save a URL as a bookmark')
    .argument('<url>', 'URL to bookmark (http/https)')
    .option('--title <title>', 'bookmark title (default: the URL host)')
    .option('--tags <tags>', 'comma-separated tags, e.g. "demo,a"')
    .option('--note <note>', 'free-text note')
    .option('--force', 'update the existing bookmark if the URL is already saved')
    .action(async (url: string, opts: AddOptions) => {
      await runAdd(url, opts);
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

const invokedAsScript = (() => {
  try {
    return import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  void main();
}
