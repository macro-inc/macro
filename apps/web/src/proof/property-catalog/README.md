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
  both sides get the same answer; a replayed write must match the recording's
  method, origin, path, query and body. Every write either page sends is watched:
  a replay that differs from the recording, a recorded write OLD never sent,
  a hook that succeeded without sending any request, a GraphQL mutation
  (comments stripped, batches and persisted queries included), a write to
  another service during a write window, any write OLD sends on its own, or a
  late NEW write after its window closed is a `diff` at level
  `write-replay`, checked before each window and at every comparison. The
  runner's own setup writes (accounts, teams, volume, load) run in a separate
  `setup` mode; `otherWrites` in the results counts every non-catalog write
  by side and mode.
- After every step: read-after-write (old and new raw readers right after the
  write returns, and after out-of-band SQL changes and team membership
  changes), whether a created or deleted definition is listed by both (level
  `visibility`, a `diff` when either is wrong or its listing fails), the
  mutation's result, live readers and callers OLD vs NEW after settling
  (bound `SETTLE_MS`; a side that does not settle in time is a `state`
  difference at level `settle`, and its snapshot is not compared), a fresh
  cold mount OLD vs NEW, live vs fresh staleness per side, and only then the
  property editor's imperative read (`fetchPropertyDefinitionWithOptions`),
  which fetches into the live cache and would otherwise repair a stale
  reader before it was compared. Each sequence ends with a real page reload
  of every side. An out-of-band SQL write that fails or changes no rows fails
  the run, unless the database itself refused it (a duplicate name for the
  owner, or a reserved system property name: `sqlRefusals` in the results).
- Differences are classed `equal`; `timestamp-format` (the same instant to the
  nanosecond, only on a row's `created_at`/`updated_at`); `tie-order` (only
  rows whose server sort key is equal swap: definitions by lowercased name,
  options by display order then value, and caller rows only when both sides'
  list, the one that caller derives its rows from (`CALLER_SOURCES` in `run.mjs`: the all, system or CRM export definitions listing, the tag sets, or a select editor's own option list), gives them the same key; an option without a key never ties). Tie
  keys lowercase the way the server sorted that list: definitions with options
  like Rust's `to_lowercase` (JavaScript's `toLowerCase`), plain definitions,
  options and tag options like PostgreSQL's `LOWER` under its libc collation
  (one code point at a time, so `İ` lowers to `i`). At the end the run asks
  PostgreSQL to lower every string a SQL-sorted key was built from and fails if
  any differs from the harness's mapping. Timestamps normalize to a NUL-prefixed instant, so no literal can
  pass for one. `error-shape` (the same retry decision, a different error
  object; the retry decision is the app's own, computed in the page with
  `thrownResultErrorHasCode`; equality compares the whole message, and each
  old→new pair is its own signature: both whole messages with each id
  replaced by its number in order of first appearance across the pair (the
  message's own `\` and `<` escaped first), so a
  pair that names other ids, or the same ids in other roles, is a signature of
  its own); `state`
  (query state fields, or a reader missing on one side); and `diff`. Reader
  errors are compared whatever the data did.
- `MUTANT=drop-row|swap-order|alter-field|stale-cache|skip-live-update` plants a
  fault in the NEW path; `mutants` mode first runs a clean baseline of the same
  shape, and a mutant counts as caught only at a signature
  the baseline does not have, after the fault was applied. It must be a `diff`
  in data both sides read successfully (a reader that succeeded on both, not with placeholder data, a
  caller that rendered on both over a source list that read without error and was not placeholder data),
  at a level the fault can reach (`MUTANT_REACH`: any read for the response
  mutants, only live readers for the cache mutants), and it must show the
  change the fault made. Each application leaves a mark once delivered: the
  account, when, and the dropped row, the two swapped rows in their injected
  order, the altered field with its old and new value, or each open reader a
  restored cache entry or a swallowed invalidation left behind with the data
  it left there. The catch must observe that account after the mark and show
  exactly that: the dropped row on OLD only, one list (same path) that on NEW
  is exactly OLD's with the two rows transposed, the field holding the
  injected value on NEW and the server's on OLD, or a live NEW reader still
  holding exactly (unnormalized) the data the fault left while a successful cold mount of
  it on the same page reads otherwise, and exactly what OLD reads live, so a refresh that replaced that data
  retires the mark. A real bug that made the same change to
  the same row would also be credited; it would show up as a difference in
  the runs without a mutant. A
  cache restore that changes nothing is not applied. A settle timeout, a write-replay difference or an uncaught page
  error never counts, and a catch in a sequence that had one is discarded (each sequence
  ends with a reload, so its fallout stays inside it). `CONTROL=1` runs OLD
  against OLD.
- `LOAD=n` adds `n` other accounts writing and reading on the server, and has
  each fuzzed account's NEW page read both catalogs in the background.
- An uncaught page error seen on one side only is a `diff` at level
  `page-errors`.
- `node summarize.mjs` rolls every `out/*/results.json` into `out/summary.json`.

## What it does not check

- The tag filter's cleanup of a selection whose tag is gone depends on when the
  missing-tag listing was fetched (`listedAt`, `tag-filter-state.tsx`); the
  harness compares the filter's state, not that timing, and does not run the
  cleanup.
- Two definitions or options the server ties (same sort key) may be shown in
  either order on either side, by readers and callers alike: the server gives
  no order between them, and the control run shows the old side doing the same
  against itself. A change that reordered only tied rows would pass.

## Limits of the local stack

- The auth service lets one address create 50 users an hour. Account pairs are
  reused for `ROTATE` (25) sequences, and a refused signup clears the sign-up
  counter in the instance's own Redis (`$REDIS_CONTAINER`, as the email e2e
  tier does) and retries; with `REDIS_CONTAINER=` it waits five minutes instead.
- The dev server now and then serves a reloaded page without its modules
  (`ERR_NETWORK_CHANGED` on a machine with many network interfaces). The
  harness retries the load and records it in `harnessErrors`; a write the dev
  server never answers fails on both sides alike.
- `out/` can hold Playwright error dumps with the local session cookie; it is
  gitignored, and nothing from it is published unscanned.
