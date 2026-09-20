import { readFileSync } from 'node:fs';

/**
 * The package version, read at runtime from package.json one level up.
 * dist sits next to package.json in every install layout (npm tarball,
 * git checkout, --install-links copy), so `bm --version` can never drift
 * from the published package the way a hardcoded string did.
 */
export const version: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
