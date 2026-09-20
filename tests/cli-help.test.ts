import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = join(repoRoot, 'dist', 'cli.js');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function bm(...args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args]);
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** All nine subcommands with the option/argument lines their help must show. */
const COMMANDS: Array<{ cmd: string; mustMention: string[] }> = [
  { cmd: 'add', mustMention: ['--title', '--tags', '--note', '--force'] },
  { cmd: 'list', mustMention: ['--tag', '--json'] },
  { cmd: 'search', mustMention: ['--json', '--open'] },
  { cmd: 'open', mustMention: [] },
  { cmd: 'edit', mustMention: ['--title', '--note', '--tags'] },
  { cmd: 'rm', mustMention: ['-y, --yes'] },
  { cmd: 'tags', mustMention: [] },
  { cmd: 'export', mustMention: ['--format', '-o, --output'] },
  { cmd: 'import', mustMention: [] },
];

describe('cli help consistency', () => {
  it.each(COMMANDS)('help for "%s" is complete and styled like the others', async ({ cmd, mustMention }) => {
    const res = await bm(cmd, '--help');
    expect(res.code, res.stderr).toBe(0);
    // Every subcommand helps with the same shape: a Usage line under the
    // shared program name, a description, and an Options section.
    expect(res.stdout).toMatch(new RegExp(`^Usage: bm ${cmd}( |$)`, 'm'));
    expect(res.stdout).toContain('Options:');
    // The help option is always documented...
    expect(res.stdout).toContain('-h, --help');
    // ...and every command-specific option/argument is described too.
    for (const fragment of mustMention) {
      expect(res.stdout, `${cmd} help should document ${fragment}`).toContain(fragment);
    }
    // Style: no duplicated blank-line runs or stray whitespace-only tails.
    expect(res.stdout).not.toMatch(/\n{3,}/);
    expect(res.stdout.split(/\r?\n/).every((line) => line === line.trimEnd())).toBe(true);
  });

  it('the root help lists every subcommand', async () => {
    const res = await bm('--help');
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain('Usage: bm [options] [command]');
    for (const { cmd } of COMMANDS) {
      expect(res.stdout).toMatch(new RegExp(`^  ${cmd}\\b`, 'm'));
    }
  });

  it('--version prints the package.json version, not a hardcoded string', async () => {
    const res = await bm('--version');
    expect(res.code, res.stderr).toBe(0);
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(res.stdout.trim()).toBe(pkg.version);
  });
});
