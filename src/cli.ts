#!/usr/bin/env node
import { Command } from 'commander';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runAdd } from './commands/add.js';
import { runExport } from './commands/export.js';
import { runList } from './commands/list.js';
import { AddOptions, CliError, ExportOptions, ListOptions } from './types.js';

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
    .command('export')
    .description('export bookmarks as Markdown, browser-importable HTML, or JSON')
    .option('--format <format>', 'output format: md | html | json (default: md)')
    .option('-o, --output <file>', 'write to <file> instead of stdout')
    .action(async (opts: ExportOptions) => {
      await runExport(opts);
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
