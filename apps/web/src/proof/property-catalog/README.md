# Property catalog differential

Proof harness for moving the property catalog reads (definitions, options, tag
sets) from REST to GraphQL. It is not product code and is not on `main`.

```sh
apps/web/src/proof/property-catalog/run.sh all     # seed 1 quiet, seed 2 under load, control, mutants
apps/web/src/proof/property-catalog/run.sh smoke   # 1 sequence of 3 steps
```

It needs a local stack built from this worktree (`just run_local --instance <name>`)
serving the web app at `$BASE` (default `https://localhost:24709`), and its
Postgres container in `$PG_CONTAINER`. All accounts are synthetic
(`pc-*@*.fuzz.test`). Results go to `out/<run>/results.json`.

## What runs

- `harness.tsx` mounts the real query hooks and their callers (property panel,
  filter bar, tag picker and settings, CRM stages and export, task board,
  projects, select editors) in one page and exposes `window.__h`.
- `run.sh` writes the base commit's `definitions.ts`, `options.ts` and `tags.ts`
  beside the head's as `*.__old__.ts`. `run.mjs` opens every account twice in
  one Chromium: the OLD context swaps those modules in by URL (REST queryFns),
  the NEW context runs the head (GraphQL readers). Request counts per side are
  in `traffic`.
- Each write runs through the real mutation hooks on NEW; its requests and
  responses are recorded and replayed to OLD, so the server sees it once and
  both sides get the same answer.
- After every step: read-after-write (old and new readers right after the write
  returns), live readers and callers OLD vs NEW after settling (bound
  `SETTLE_MS`), a fresh cold mount OLD vs NEW, and live vs fresh staleness per
  side. Each sequence ends with a real page reload of every side.
- Differences are classed `equal`, `timestamp-format` (same instant, only on
  `created_at`/`updated_at`), `tie-order` (rows whose server sort key is equal),
  `error-shape` (same status, data and retries; only the error object differs),
  `state` and `diff`.
- `MUTANT=drop-row|swap-order|alter-field|stale-cache|skip-live-update` plants a
  fault in the NEW path; `CONTROL=1` runs OLD against OLD.
