import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStorePath } from '../src/store.js';

const run = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = join(repoRoot, 'dist', 'cli.js');

let dataDir: string;
let homeDir: string;
let childEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'bm-cli-'));
  homeDir = mkdtempSync(join(tmpdir(), 'bm-cli-home-'));
  // Redirect every platform-conventional location into the sandbox so the
  // smoke tests never touch the real user directory, on any host platform.
  childEnv = {
    ...process.env,
    APPDATA: dataDir,
    HOME: homeDir,
    XDG_CONFIG_HOME: join(homeDir, '.config'),
  };
});
afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
});

const storePath = () => resolveStorePath(childEnv, process.platform);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function bm(...args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, ...args], {
      env: childEnv,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

describe('cli export smoke', () => {
  it('default format is markdown: grouped by tag, multiple entrances, 无标签 last', async () => {
    await bm('add', 'https://nodejs.org/en', '--title', 'Node.js', '--tags', 'dev,docs', '--note', 'runtime docs');
    await bm('add', 'https://zh.example.com/', '--title', '前端工具箱', '--tags', '前端,dev');
    await bm('add', 'https://plain.org/');

    const res = await bm('export');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('# Bookmarks');
    // Sections appear in deterministic order (code-point order, untagged last).
    const positions = ['## dev', '## docs', '## 前端', '## 无标签'].map((s) =>
      res.stdout.indexOf(s),
    );
    expect(positions.every((p) => p > -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    // Multi-tag bookmark has an entrance under both dev and docs.
    expect(res.stdout.match(/- \[Node\.js\]\(https:\/\/nodejs\.org\/en\)/g)).toHaveLength(2);
    // Chinese title/tag round-trip; note line; untagged entry with host-title fallback.
    expect(res.stdout).toContain('- [前端工具箱](https://zh.example.com/)');
    expect(res.stdout).toContain('  runtime docs');
    expect(res.stdout).toContain(`- [plain.org](https://plain.org/)`);
    // Ends with exactly one newline (console.log adds it).
    expect(res.stdout.endsWith('\n')).toBe(true);
    expect(res.stdout.endsWith('\n\n')).toBe(false);
  });

  it('--format json on stdout is byte-identical to the store file (lossless)', async () => {
    await bm('add', 'https://one.dev', '--tags', 'a');
    await bm('add', 'https://two.dev');

    const res = await bm('export', '--format', 'json');
    expect(res.code).toBe(0);
    expect(res.stdout).toBe(readFileSync(storePath(), 'utf8'));

    const parsed = JSON.parse(res.stdout) as {
      bookmarks: Array<{ id: number }>;
      nextId: number;
    };
    expect(parsed.bookmarks).toHaveLength(2);
    // The id counter travels with the backup (it is above the max id present).
    expect(parsed.nextId).toBe(3);
  });

  it('--format html -o <file> writes the document to the file, not stdout', async () => {
    await bm('add', 'https://nodejs.org/en', '--tags', 'dev');
    await bm('add', 'https://plain.org/');

    const out = join(dataDir, 'nested', 'bookmarks.html');
    const res = await bm('export', '--format', 'html', '-o', out);
    expect(res.code).toBe(0);
    // -o means silence on stdout (and the parent directory is created).
    expect(res.stdout).toBe('');

    const raw = readFileSync(out, 'utf8');
    expect(raw.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
    expect(raw).toContain('<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">');
    expect(raw).toContain('<TITLE>Bookmarks</TITLE>');
    expect(raw).toContain('<H1>Bookmarks</H1>');
    expect(raw).toContain('<DL><p>');
    expect(raw.match(/<DT><A HREF="/g)).toHaveLength(2);
    expect(raw).toMatch(/ADD_DATE="\d+"/);
    expect(raw).toContain('<DT><H3>无标签</H3>');
    // UTF-8 file with exactly one trailing newline.
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.endsWith('\n\n')).toBe(false);
  });

  it('-o also works for the default markdown format', async () => {
    await bm('add', 'https://one.dev', '--tags', 'a');
    const out = join(dataDir, 'bookmarks.md');
    const res = await bm('export', '-o', out);
    expect(res.code).toBe(0);
    expect(res.stdout).toBe('');
    const raw = readFileSync(out, 'utf8');
    expect(raw).toContain('# Bookmarks');
    expect(raw).toContain('## a');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.endsWith('\n\n')).toBe(false);
  });

  it('an unknown format exits non-zero with a clear error', async () => {
    const res = await bm('export', '--format', 'bogus');
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('bogus');
    expect(res.stderr.toLowerCase()).toContain('format');
  });

  it('an empty store exports legal empty documents in all three formats', async () => {
    const md = await bm('export');
    expect(md.code).toBe(0);
    expect(md.stdout.trim()).toBe('# Bookmarks');

    const html = await bm('export', '--format', 'html');
    expect(html.code).toBe(0);
    expect(html.stdout.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>')).toBe(true);
    expect(html.stdout).toContain('<DL><p>');
    expect(html.stdout).not.toContain('<DT>');

    const json = await bm('export', '--format', 'json');
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({ bookmarks: [], nextId: 1 });
  });
});
