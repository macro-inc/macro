# Property catalog differential

Proof harness for moving the property catalog reads (definitions, options, tag
sets) from REST to GraphQL. It is not product code and is not on `main`.

```sh
apps/web/src/proof/property-catalog/run.sh all     # mutants, seed 1 quiet, seed 2 under load, seed 4 quiet, control
apps/web/src/proof/property-catalog/run.sh control mutants   # any modes, in order
apps/web/src/proof/property-catalog/run.sh smoke   # 1 sequence of 3 steps
```

It needs a local stack built from this worktree (`just run_local --instance <name>`)
serving the web app at `$BASE` (default `https://localhost:24709`), and its
Postgres container in `$PG_CONTAINER`. All accounts are synthetic
(`pc-*@*.fuzz.test`). Results go to `out/<run>/results.json`; `run.sh` exits
non-zero when a run crashed, ran fewer sequences than asked, the OLD page did
not run the base commit's modules, or a mutant was not applied or not caught.

## What runs

- `harness.tsx` mounts the real query hooks and their callers (property panel,
  filter bar, tag picker and settings, CRM stages and export, task board,
  projects, select editors) in one page and exposes `window.__h`.
- `run.sh` writes the base commit's `definitions.ts`, `options.ts` and `tags.ts`
  beside the head's as `*.__old__.ts`, each marked with
  `__PROOF_MODULE__ = 'old:<commit>'`. `run.mjs` opens every account twice in
  one Chromium: the OLD context swaps those modules in by URL (REST queryFns),
  the NEW context runs the head (GraphQL readers). Every page load reads the
  markers back and stops the run if a side runs the wrong modules.
- Each write runs through the real mutation hooks on NEW; its requests and
  responses are recorded and replayed to OLD, so the server sees it once and
  both sides get the same answer. A replay that differs from the recording, a
  recorded write OLD never sent, or a write outside the tap is a `diff` at
  level `write-replay`.
- After every step: read-after-write (old and new raw readers right after the
  write returns, and after out-of-band SQL changes and team membership
  changes), whether a created or deleted definition is visible to both, the
  property editor's imperative read (`fetchPropertyDefinitionWithOptions`),
  the mutation's result, live readers and callers OLD vs NEW after settling
  (bound `SETTLE_MS`), a fresh cold mount OLD vs NEW, and live vs fresh
  staleness per side. Each sequence ends with a real page reload of every side.
- Differences are classed `equal`; `timestamp-format` (the same instant to the
  nanosecond, only on a row's `created_at`/`updated_at`); `tie-order` (only
  rows whose server sort key is equal swap: definitions by lowercased name,
  options by display order then value, and caller rows only when both sides'
  catalogs give them the same key); `error-shape` (the same retry decision, a
  different error object; each old→new pair is its own signature); `state`
  (query state fields, or a reader missing on one side); and `diff`. Reader
  errors are compared whatever the data did.
- `MUTANT=drop-row|swap-order|alter-field|stale-cache|skip-live-update` plants a
  fault in the NEW path; `mutants` mode first runs a clean baseline of the same
  shape, and a mutant counts as caught only at a `diff` or `state` signature
  the baseline does not have, after the fault was applied. `CONTROL=1` runs OLD
  against OLD.
- `LOAD=n` adds `n` other accounts writing and reading on the server, and has
  each fuzzed account's NEW page read both catalogs in the background.
- `node summarize.mjs` rolls every `out/*/results.json` into `out/summary.json`.

## Limits of the local stack

- The auth service lets one address create 50 users an hour. Account pairs are
  reused for `ROTATE` (25) sequences, and a refused signup waits five minutes
  and retries, so a full run spends some of its time waiting.
- The dev server now and then serves a reloaded page without its modules
  (`ERR_NETWORK_CHANGED` on a machine with many network interfaces). The
  harness retries the load and records it in `harnessErrors`; a write the dev
  server never answers fails on both sides alike.
- `out/` can hold Playwright error dumps with the local session cookie; it is
  gitignored, and nothing from it is published unscanned.
