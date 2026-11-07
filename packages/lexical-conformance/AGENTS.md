# Lexical conformance tooling

## What it is

Development-only recorder and JavaScript oracle for the Lexical v0.45.0 port.
The upstream source is downloaded by checksum into this worktree's `target/`.

## Start here

- `record/run.ts`: download, patch, dual-oracle recording and transparency comparison.
- `record/membrane.ts`: attribution, identity, callback tapes and commit capture.
- `record/replay-js.ts`: independent interpreter; never executes original test bodies.
- `record/schema.ts`: schema 2 shared with the Rust fixture reader.
- `diff/README.md`: WP-07 raw-model WASM loader and Tier C text/paragraph harness.
- `record/initial.ts`: partial-state key layout and selection restoration.
- `record/inventory.json`: S4 per-file expected counts; mixed files have no exact case labels.

## Boundaries

- Never import the recorder from shipped packages.
- Keep recorder source patches in `record/hooks.patch`; differential-only patches and observation hooks use a separate disposable source tree.
- A failed upstream test, transparency check or self-replay cannot become A-rec.
- Keep unsupported cases in `fixtures/index.json` with a reason; never silently omit them.

## Checks

- In this package: `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun run test`.
- From the repository: `just lexical-fixtures --check` twice, then `just check`.
- Differential changes: `bunx tsc --noEmit -p diff/tsconfig.json` in this package; from root, `STEPS=10000 bunx vitest run --config packages/lexical-conformance/diff/vitest.config.mts`.

## Gotchas

- `--filter=<file>` is for recorder development only; release fixtures use the full suite.
- Recorder unit tests require the pinned `target/lexical-upstream/` checkout; the differential oracle uses a separate disposable checkout.
- The upstream pin is independent of the app's patched npm packages.
- Macro tests run separately with markdown indent 2; upstream fixtures keep indent 4.
- `--filter=macro:<file>` selects the worktree lexical-core pool.
- Regenerate the full corpus after changing copied Macro or Loro source.
- Review fixtures for account identities beyond the machine privacy scanner.
- Entropy, node keys, handles and callback tapes reset for every test.

The independent `diff/collab.config.mts` profile runs four document-session/current
TS peers with three fixed 2,000-step seeds and a collaborative undo literal.
Run it from root with `bunx vitest run --config packages/lexical-conformance/diff/collab.config.mts`;
type-check it with `bunx tsc --noEmit -p packages/lexical-conformance/diff/collab/tsconfig.json`.
It uses current app Loro 1.17.1 and isolated DOM documents per TS peer; it does not
change the recorder pin or normalize comparator fields.
