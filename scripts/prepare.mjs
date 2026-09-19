/**
 * prepare hook: build dist/cli.js so the package is installable from git.
 *
 * Why a script instead of plain "npm run build": when npm installs this
 * package from a git URL it runs `prepare` inside the clone, and on some npm
 * versions (observed on npm 11.6) that inner install runs with the parent
 * install's npm_config_global / npm_config_prefix leaked into the
 * environment. The clone is then treated as a plain dependency, whose
 * devDependencies are never installed — so `tsc` is missing exactly when we
 * need it. This script detects that case, installs just the build toolchain
 * (versions read from package.json, single source of truth) with a cleaned
 * environment, and then runs the normal build.
 *
 * The script uses only Node builtins: it must run before any dependency is
 * guaranteed to exist.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Environment for child npm calls, stripped of global-install leakage. */
function cleanEnv() {
  const env = { ...process.env };
  for (const key of ['npm_config_global', 'npm_config_prefix', 'npm_config_location']) {
    delete env[key];
  }
  return env;
}

/**
 * Run npm with `args` in the repo root. Prefers invoking npm's own CLI
 * through the current node binary (npm exposes its path as npm_execpath
 * when it runs lifecycle scripts); spawning npm.cmd without a shell is not
 * allowed on Windows (CVE-2024-27980 mitigation), and a shell would re-quote
 * arguments. The PATH fallback only serves manual invocations.
 */
function runNpm(args) {
  const node = process.env.npm_node_execpath || process.execPath;
  const npmCli = process.env.npm_execpath;
  const result = npmCli
    ? spawnSync(node, [npmCli, ...args], { cwd: root, env: cleanEnv(), stdio: 'inherit' })
    : spawnSync('npm', args, {
        cwd: root,
        env: cleanEnv(),
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
  if (result.error) {
    console.error(`prepare: failed to run npm: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return false;
  }
  return true;
}

const toolchainPresent = existsSync(join(root, 'node_modules', 'typescript', 'bin', 'tsc'));

if (!toolchainPresent) {
  // Dev-facing installs already have devDependencies; only the git-dep
  // preparation path reaches here. --no-save leaves package.json alone
  // (the clone is temporary, but stay tidy anyway).
  const pkg = createRequire(import.meta.url)('../package.json');
  const specs = ['typescript', '@types/node'].map(
    (name) => `${name}@${pkg.devDependencies[name]}`,
  );
  if (!runNpm(['install', '--no-save', '--no-audit', '--no-fund', ...specs])) {
    console.error('prepare: failed to install the build toolchain.');
    process.exit(1);
  }
}

if (!runNpm(['run', 'build'])) {
  console.error('prepare: build failed.');
  process.exit(1);
}
