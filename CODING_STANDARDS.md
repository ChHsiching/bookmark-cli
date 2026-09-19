# Coding standards

Judgement-call conventions the diff alone doesn't enforce. Mechanical checks (typecheck, tests, dist freshness) live in CI, not here. Domain terminology: `CONTEXT.md` (its _Avoid_ lists bind user-visible strings too).

## Seams

- Command implementations: `(opts, deps?) => Promise<void>` in `src/commands/<name>.ts`. Every external effect — network, clipboard, browser open, interactive input — reaches the command only through `deps`, default implementations wired in `src/cli.ts` alone. A new test that needs a fake dependency should never require touching a command file.
- `src/cli.ts` holds registration blocks only; a new command adds one self-contained block plus its import.
- Business errors throw `CliError` (converted to stderr + exit 1 in `src/cli.ts`); never `process.exit` inside a command.

## Determinism

- Ties in any user-visible ordering break by `id` descending (shared `byNewestFirst` in `src/store.ts`).
- Sort user-visible strings by codepoint, not `localeCompare` — output must be identical across machines.

## Time

- Storage is ISO 8601 UTC; display converts to local timezone. Never store local time.

## Tests

- One topic per file, `tests/<topic>.test.ts`; subprocess smoke tests use the sandbox harness from `tests/helpers.ts` (`createCliSandbox`) with redirected `APPDATA`/`HOME`/`XDG_CONFIG_HOME`. No test touches the real network, clipboard, browser, or user directories — `BM_NO_TITLE_FETCH=1` exists for the no-fetch path.
