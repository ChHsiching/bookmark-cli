# Known environment issues

Fixes for failures that recur on this machine. Verify the fix still applies before editing; append new issues at the end.

## npm install: vitest/rolldown "Cannot find native binding"

npm [bug #4828](https://github.com/npm/cli/issues/4828): optional dependencies can be skipped, leaving vitest without its rolldown native binding. Fix:

```bash
rm -rf node_modules package-lock.json
npm install
git checkout -- package-lock.json   # REQUIRED
```

The reinstall prunes other platforms' optional bindings (~528 lines) from the lockfile. Committing that pruning breaks installs on other machines — the `git checkout` is part of the fix, not optional cleanup.

## npm i -g from GitHub fails on nvm-windows

`npm i -g github:ChHsiching/bookmark-cli` reports MODULE_NOT_FOUND on nvm-windows (npm junctions the package to a pacote clone that later gets cleaned). Add `--install-links=true`. Also documented in README's troubleshooting note.
