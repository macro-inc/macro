# Property catalog differential

Proof harness for porting the property catalog (definitions, options, tag
sets) from REST and TanStack Query to GraphQL and the normalized cache: reads
as live queries, writes as GraphQL mutations with optimistic updates. It is
not product code and is not on `main`.

```sh
apps/web/src/proof/property-catalog/run.sh all     # mutants, seed 1 quiet, seed 2 under load, seed 4 quiet, control, optimism
apps/web/src/proof/property-catalog/run.sh control mutants   # any modes, in order
apps/web/src/proof/property-catalog/run.sh smoke   # 1 sequence of 3 steps
apps/web/src/proof/property-catalog/run.sh optimism   # pending, failed, offline and two-tab states
```

It needs a local stack built from this worktree (`just run_local --instance <name>`)
serving the web app at `$BASE` (default `https://localhost:24709`), and its
Postgres container in `$PG_CONTAINER`. All accounts are synthetic
(`pc-*@*.fuzz.test`). Results go to `out/<run>/results.json`; `run.sh` exits
non-zero when a run crashed, ran fewer sequences than asked, the OLD page did
not run the base commit's modules, a mutant was not applied or not caught, an
optimistic-state check failed, a run other than a mutant's left a data or state
difference the harness does not classify, or a harness error other than a
retried page load happened.

## What runs

- `harness.tsx` mounts the real query hooks and their callers (property panel,
  filter bar, tag picker and settings, CRM stages and export, task board,
  projects, select editors) in one page and exposes `window.__h`. It installs
  the normalized cache's host at boot, as the app does; a NEW page whose cache
  did not start stops the run.
- `run.sh` writes the base commit's copy of every web module the PR changed
  beside the head's as `*.__old__.*`, each marked with
  `__PROOF_MODULE__ = 'old:<commit>'`, and lists them in `out/old-modules.json`.
  The OLD context swaps those modules in by URL, so OLD runs main's web code
  end to end (REST reads, TanStack queries, invalidations); the NEW context
  runs the head. Every page load reads the markers back and stops the run if a
  side runs the wrong modules.
- Twin worlds. Each lane has four accounts: A and B in OLD's world and the
  same two in NEW's, whose emails differ only in the world's last tag
  (`-o`/`-n`). Every write runs through the real mutation hooks on both sides
  at once, OLD against its accounts and NEW against its own, so each world's
  server sees each write once and both mutations are real. Comparisons
  translate OLD's world into NEW's: emails, domains and user ids by the tag,
  and row ids through an id map (`pairIds` pairs the ids two results hold at
  the same paths; `syncIds` pairs the rest by identity after every write:
  definitions by their fields, options by value, order and color, tag sets by
  scope). A pairing that would override another counts in `idMap.conflicts`.
  A caller's Map or Set comes out of the page sorted by that world's ids, so
  OLD's entries are sorted again once translated.
  Timestamps compare as `<ts>`, and `updated_at` as unchanged or later.
- Write transport: every write either page sends is watched. OLD must send
  REST and no GraphQL mutation; NEW must send only the GraphQL operations its
  mutation may send (`NEW_OPS`), ending with the mutation's own, and no REST
  write. A hook that succeeds without its request, a catalog write outside a
  write window, or a write to another service during one is a `diff` at level
  `write-transport`. The token refresh is never a stray. The runner's own
  setup writes (accounts, teams, volume, load) run in a separate `setup` mode;
  `otherWrites` counts every non-catalog write by side and mode, and
  `writeTransport` the request sequence each mutation sent per side.
- Each write's result compares as `{ok, value or failure contract, toasts}`;
  a write both servers refused (400, 403, 404, 409 or 422 on OLD's REST, with
  no transport failure) is a coverage case of its own. Out-of-band SQL steps
  run in both worlds with translated ids; worlds whose SQL outcomes differ are
  a `diff` at level `sql`.
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
  PostgreSQL to lower the strings SQL-sorted keys were built from (up to
  200,000 distinct ones, NUL-free) and fails if any differs from the harness's
  mapping. Timestamps normalize to a NUL-prefixed instant, so no literal can
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
- `old-stale`: main's live readers miss some updates (an invalidation that
  does not reach them) that the cache's live queries pick up. A live reader or
  caller whose data differs counts as `old-stale` instead of `diff` only when
  main's live copy differs from main's own cold mount, the head's live copy
  equals the head's cold mount, and the two cold mounts agree; the staleness
  record does the same when the head's stale keys are a subset of main's and
  every extra one is excused that way. They are counted in `oldStale` by
  operation and reader. A head that is stale itself, or whose cold mount
  differs from main's, never qualifies, so the cache mutants still count.
  One exception carries an excuse forward: a key excused at the previous
  comparison of the same account stays excused while neither side's live copy
  has moved and the cold mounts still agree. That is a write neither side is
  told of (another account's) leaving both behind, the head no staler than
  main; `oldStale.inherited` counts them.
- `VALUE_DROPPED` (`run.mjs`) lists writes the head resolves with nothing
  where main resolved with the changed option (`updateTag`, `updateOption`) or
  `{ success: true }` (`deleteTag`, `deleteOption`, `deleteDef`):
  their hooks type the result `void`, so the type check proves no caller reads
  it. Their result compares as `{ok, toasts}`; `valueDropped` counts them.
- `DUMP=n` writes the first `n` differences (not ties or timestamp formats)
  in full, both sides, to `out/<run>/dump.jsonl`. It can hold account
  addresses; sanitize it before sharing.
- `OPTIMISM=1` (`run.sh optimism`, `optimism.mjs`) runs every catalog write
  (add, rename and delete an option, create and delete a definition, create,
  rename and delete a tag) in one OLD and one NEW account, each with a second
  tab of the same account open, in three ways: held (read while in flight,
  then let through), failed (held, then answered 500), and offline (the
  context goes offline and every catalog write it sends fails as a lost
  connection, covering the cache engine's worker, which `setOffline` does not
  reach; then it comes back). Readers are summarized by what a person sees.
  Each case checks the result and toasts, the cold-mounted readers and the
  server's catalog against main; that the head's settled readers equal its
  own cold mount; that the write settles; on failure that both tabs roll back;
  otherwise that the head shows the write while it is pending and that this
  is the settled state (creating a definition, which the server answers,
  shows on neither side until it does); offline, that the write reaches the
  server exactly once, after the reconnect, and how long after it
  (`optimism.landMs`: main resumes on the reconnect, the cache's queue when
  its retry delay runs out). Settled live readers compare with main as above,
  with main's staleness listed in `optimism.oldStale`. The first tab's state
  reaching the second is reported per case (`tab2Live`, `tab2Ms`).
- `MUTANT=drop-row|swap-order|alter-field|stale-cache|skip-live-update` plants a
  fault in the NEW path; `mutants` mode first runs a clean baseline of the same
  shape (a mutant run refuses a baseline without a passing verdict), and a mutant counts as caught only at a signature
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
  cache restore that changes nothing is not applied. A settle timeout, a write-transport difference or an uncaught page
  error never counts, and a catch in a sequence that had one is discarded (each sequence
  ends with a reload, so its fallout stays inside it). `CONTROL=1` runs OLD
  against OLD.
- `LOAD=n` adds `n` other accounts writing and reading on the server, and has
  each fuzzed account's NEW page read both catalogs in the background.
- An uncaught page error seen on one fuzzed side only is a `diff` at level
  `page-errors` (a load page's errors count in `harnessErrors`).
- `node summarize.mjs` rolls every `out/*/results.json` into `out/summary.json`
  and prints, for each run with readable results, its commit and verdict:
  PASSED, FAILED (it reached its final checks, a lane crash included) or
  INCOMPLETE (it stopped before writing a verdict). A run with no readable
  results prints INCOMPLETE with the reason and no commit, and is an entry
  `{ verdict: null, incomplete }` in the JSON. A run deletes its old
  `results.json` when it starts and writes `verdict` only after its final
  checks, so a run killed or stopped before them reads `INCOMPLETE` (with no
  results file yet, from its `started` marker), and none reads as passed
  unless it passed this time. Results are written
  to a temporary file and renamed into place.

## What the counts mean

The counts measure work attempted, not successes, and are not interchangeable:

- `counts`: `sequences`, `steps` and `volumeSteps` are finished loop
  iterations, no-op steps and steps whose snapshot comparison was skipped
  included. `rawCases` are completed old/new pairs, errors on both sides
  included. `readerComparisons` and `callerComparisons` count every reader or
  caller compared, including one missing on a side or one that threw (a
  missing one is a `state` or `diff`; two that threw the same message compare
  `equal`, as the caller behaves the same). `freshMounts` count mounts that returned, timeouts included;
  `reloads` count page loads that succeeded, after retries; `imperativeReads`
  count reads started.
- `classes` and the summary's rollups count assertions: one reader pair
  gives a data and an error record, so these are not pair counts.
  `diffSignatures` group differences by level, class, normalized location and
  the signature's own fields; different values at the same path can share one.
- `coverage` counts how often a case had a dimension. A write's dimensions
  (created type and scope, unicode and long names, tag scope, renames, team
  events, SQL renames and null colors) are credited only when the write
  succeeded and changed that value; an option write to a system definition is
  credited as `(refused)` when both worlds' servers refused it.
  Read dimensions count reads requested, not reads that succeeded; an
  `option target` already open is credited again without a new mount.
- `ops`: for a hook write, both worlds' outcomes per operation and actor
  (`ok`, `rejected`, or each side's when they differ); for an out-of-band SQL write, the statement's
  outcome, where `rejected` includes database refusals (`sqlRefusals`, the two
  recognized ones) and harness failures (`sqlFailures`, which fail the run).
  `rejections` buckets refused hook writes, transport errors included, by
  class, codes and the first 80 characters of the message. Write requests per
  mutation include requests that failed.
- `staleness.byOp` counts one hit per account, side and step with any key
  whose live and fresh reads differ, under the operation chosen, whatever the
  step then did; `visibility` counts both missing and unexpectedly present rows.
- `volume` reports its targets beside the successful counts. `load.ops` and
  `sameUserReads` count returned attempts, errors included.
- `settle` buckets by elapsed time to first quiet (the settle is confirmed
  60 ms later), or to the timeout; the last bucket is everything from 2.5 s.
- `traffic` counts requests as sent by method and service (REST GET includes
  HEAD and OPTIONS); `otherWrites` counts every non-catalog request that could
  write, which can include a persisted GraphQL read.
- `mutant.applied` is per fault: rewritten responses (drop-row, swap-order,
  alter-field), swallowed invalidation calls whether or not a reader was open
  (skip-live-update), or steps with at least one restored cache entry
  (stale-cache). `candidatesBy` counts observations, `caughtBy` accepted
  catches, at most one per sequence.
- `moduleChecks` count verified page loads per physical side; `harnessErrors`
  count error events; `pageErrors` count occurrences per masked message and
  side, while the `page-errors` comparison uses presence. The collation check
  takes at most 200,000 distinct strings, skips strings with a NUL, and lists
  at most 50 mismatches. An uncaught error on a load page (`LOAD`) counts in
  `harnessErrors` only.
- The lists are capped: `harnessErrors` keeps its first 200 messages (its
  count in `totals` is whole), `diffs` the first 400 differences, and
  `examples` the first five per level and class; `diffSignatures` and
  `classes` count everything.

## What it does not check

- The tag filter's cleanup of a selection whose tag is gone depends on when the
  missing-tag listing was fetched (`listedAt`, `tag-filter-state.tsx`); the
  harness compares the filter's state, not that timing, and does not run the
  cleanup.
- Two definitions or options the server ties (same sort key) may be shown in
  either order on either side, by readers and callers alike: the server gives
  no order between them, and the control run shows the old side doing the same
  against itself. A change that reordered only tied rows would pass.
- Where main's live reader was stale (`old-stale`), the head is checked
  against its own cold mount and main's cold mount, not against main's live
  behavior.
- Main's pending, failed and offline states are recorded, not required: the
  optimism checks hold the head to rolling back, showing the write at once and
  landing it once, which main's invalidate-on-settle hooks do not all do.

## Limits of the local stack

- The auth service lets one address create 50 users an hour. Account pairs are
  reused for `ROTATE` (25) sequences, and a refused signup clears the sign-up
  counter in the instance's own Redis (`$REDIS_CONTAINER`, as the email e2e
  tier does) and retries; with `REDIS_CONTAINER=` it waits five minutes instead.
- Chromium aborts every request in flight when the machine's network
  interfaces change (`ERR_NETWORK_CHANGED`; on a machine where other stacks'
  containers add and remove virtual interfaces all the time), and one lost
  module fails the page's whole module graph. A page that is not ready yet,
  after its load event, and has had a module request fail or answer 4xx/5xx is
  reloaded without waiting for the readiness timeout (after a backoff of 2 s
  times the attempt), up to 8 loads; each failed load is in `harnessErrors`,
  and `harnessReloadRetries` counts the reloads made. A write whose request is
  lost fails on both sides alike.
- A settle timeout (level `settle`) records what that side was still waiting
  on, as `waitedOn` in `settleTimeouts` (every one, uncapped up to 1,000),
  `diffs` and `examples`: its busy queries and readers (`busy`, taken in the
  page at the timeout), every non-module request of that page still in flight
  with its age (`inflight`; a request whose end Playwright never reported stays
  there), the API requests that finished during the wait with their status,
  start and duration (`recent`), the page's own view of its API fetches, in ms
  from the settle's start (`fetches`, from a pass-through `fetch` wrapper in
  `harness.tsx`; a failed one is marked `failed`), the driver's event-loop stalls of 100 ms or more during the
  wait (`driverStalls`; the driver answers every API request through its route
  handlers, so a stall delays every page's answers), the driver's own blocking work of
  100 ms or more in that time (`driverWork`: its synchronous child processes,
  such as the SQL steps' `psql`, its comparisons, its results flushes, and
  garbage collection). Stalls and work are kept when they overlap the driver's
  call to that side, from its start to its return, with `overlapMs` saying how
  much did; and the page's last eight
  network notes (failed requests, failed module responses, console errors:
  `net`).
  `inflight`, `recent` and `net` are taken when that side's call returns, which
  for a fresh mount is after the mount was torn down. Paths are masked: ids,
  numbers and any segment of 24 or more token characters (the write census
  masks only ids and numbers, so distinct routes stay apart).
- The SQL steps (`sqlRename`, `sqlNullColor`) run `psql` through
  `docker exec` synchronously (`sql()` in `run.mjs`), which blocks the driver
  and so every page's API answers until it returns. Under machine load that
  took up to 3.1 s. No route handler runs while it does, so no request in
  flight across it is answered before it ends; a cold mount that also needs a
  retried read (two round trips plus the retry delay) or a token refresh then overruns
  `SETTLE_MS`. In the final load run every `settle` timeout's `waitedOn` has
  a `psql` in `driverWork` covering at least 2.6 s of the last 5 s before the
  call returned, matching a stall in `driverStalls`
  (`results/settle-timeouts.json`). That is a coincidence in time plus the mechanism,
  not a trace of each request: `driverWork` is process-wide, and `fetches`
  shows which of the page's requests were open across it.
- `out/` can hold Playwright error dumps with the local session cookie; it is
  gitignored, and nothing from it is published unscanned.
