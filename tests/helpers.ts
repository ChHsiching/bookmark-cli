import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStorePath } from '../src/store.js';

/**
 * Shared subprocess harness for the CLI smoke tests (not a test file:
 * vitest only runs files matching the *.test.ts pattern under tests/).
 * One sandbox = one fresh pair of temp directories + a redirected child
 * environment + a `bm()` that runs the built dist/cli.js inside it.
 */

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliPath = join(repoRoot, 'dist', 'cli.js');

/** Result of one CLI subprocess run: exit code plus captured output. */
export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A sandboxed CLI environment, created per test (or per file, for e2e). */
export interface CliSandbox {
  /** Where the store lands on Windows (APPDATA); scratch space elsewhere. */
  dataDir: string;
  /** Redirected HOME-equivalent for macOS/Linux conventions. */
  homeDir: string;
  /** Env for CLI subprocesses: every platform-conventional location redirected. */
  childEnv: NodeJS.ProcessEnv;
  /** The store file path the sandboxed CLI resolves to on this platform. */
  storePath(): string;
  /** Run the built CLI (dist/cli.js) as a subprocess inside the sandbox. */
  bm(...args: string[]): Promise<RunResult>;
  /** Like bm(), but first writes `answer` to the child's stdin (rm prompt). */
  bmAnswer(answer: string, ...args: string[]): Promise<RunResult>;
  /** Remove the sandbox directories. Call from afterEach/afterAll. */
  cleanup(): void;
}

export function createCliSandbox(opts: { noTitleFetch?: boolean } = {}): CliSandbox {
  const dataDir = mkdtempSync(join(tmpdir(), 'bm-cli-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'bm-cli-home-'));
  // Redirect every platform-conventional location into the sandbox so the
  // smoke tests never touch the real user directory, on any host platform.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    APPDATA: dataDir,
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, '.config'),
  };
  // BM_NO_TITLE_FETCH keeps subprocess adds hermetic: the default add
  // fetches the page title, which tests must not do.
  if (opts.noTitleFetch) {
    childEnv.BM_NO_TITLE_FETCH = '1';
  }

  async function bm(...args: string[]): Promise<RunResult> {
    try {
      const { stdout, stderr } = await run(process.execPath, [cliPath, ...args], {
        env: childEnv,
      });
      return { code: 0, stdout, stderr };
    } catch (err) {
      const e = err as { code?: number; stdout?: string; stderr?: string };
      return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }

  /** Run the CLI as a subprocess and answer its confirmation prompt via stdin. */
  function bmAnswer(answer: string, ...args: string[]): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], { env: childEnv });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
      child.stdin.write(`${answer}\n`);
      child.stdin.end();
    });
  }

  return {
    dataDir,
    homeDir,
    childEnv,
    storePath: () => resolveStorePath(childEnv, process.platform),
    bm,
    bmAnswer,
    cleanup: () => {
      rmSync(dataDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}
