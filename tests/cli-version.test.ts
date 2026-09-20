import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CliSandbox, createCliSandbox } from './helpers.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

describe('cli --version', () => {
  let sb: CliSandbox;
  beforeEach(() => {
    sb = createCliSandbox();
  });
  afterEach(() => {
    sb.cleanup();
  });

  it('prints the package.json version, never a hardcoded string', async () => {
    const res = await sb.bm('--version');
    expect(res.code, res.stderr).toBe(0);
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(res.stdout.trim()).toBe(pkg.version);
  });
});
