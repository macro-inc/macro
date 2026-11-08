# Lexical conformance tooling

## What it is

Development-only recorder and JavaScript oracle for the Lexical v0.45.0 port.
The upstream source is downloaded by checksum into this worktree's `target/`.

## Start here

- `record/run.ts`: download, patch, dual-oracle recording and transparency comparison.
- `record/membrane.ts`: attribution, identity, callback tapes and commit capture.
- `record/replay-js.ts`: independent interpreter; never executes original test bodies.
- `record/schema.ts`: schema 2 shared with the Rust fixture reader.
- `diff/listeners.test.ts`: real JS command priority snapshots, identity, truthiness, live registration and caught opaque exceptions.
- `diff/host.test.ts`: real indexed EditorHandle lifecycle, native fields, packet decoding and JS transforms with current-hook reentry, identity and rollback.
- `diff/host-packet.generated.ts`: Specta declaration; regenerate with the conformance_wasm export_host_types example.
- `diff/debug.test.ts`: actual optimized export crossings, allocator/free traps and editor-facade lifetimes.
- `diff/compat.test.ts`: real Node/web WASM compatibility constants and per-instance key stream checks.
- `diff/README.md`: WP-07 raw-model WASM loader and Tier C text/paragraph harness.
- `record/initial.ts`: partial-state key layout and selection restoration.
- `coverage/README.md`: traceability evidence, pending ratchet and CI gates.
- `record/inventory.json`: S4 per-file expected counts; mixed files have no exact case labels.

## Boundaries

- Never import the recorder from shipped packages.
- Retain S1 D-11 error-mode caret validation in the production differential oracle.
- Keep recorder source patches in `record/hooks.patch`; differential-only patches and observation hooks use a separate disposable source tree.
- A failed upstream test, transparency check or self-replay cannot become A-rec.
- Keep unsupported cases in `fixtures/index.json` with a reason; never silently omit them.

## Checks

- In this package: `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun run test`.
- From the repository: `just lexical-fixtures --check` twice, then `just check`.
- Differential changes: `bunx tsc --noEmit -p diff/tsconfig.json` and `STEPS=10000 bunx vitest run --config diff/vitest.config.mts` in this package (uses its pinned Vitest).

- In this package: `bunx tsc --noEmit -p coverage/tsconfig.json`, `bunx vitest run --config coverage/vitest.config.ts`.
- From the repository: `just lexical-coverage-seed --check`, `just lexical-coverage --check`.

## Gotchas

- `--filter=<file>` is for recorder development only; release fixtures use the full suite.
- Recorder unit tests require the pinned `target/lexical-upstream/` checkout; the differential oracle uses a separate disposable checkout.
- The upstream pin is independent of the app's patched npm packages.
- Macro tests run separately with markdown indent 2; upstream fixtures keep indent 4.
- `--filter=macro:<file>` selects the worktree lexical-core pool.
- Regenerate the full corpus after changing copied Macro or Loro source.
- Review fixtures for account identities beyond the machine privacy scanner.
- Entropy, node keys, handles and callback tapes reset for every test.

- Keep the S1 D-11 error-mode text-offset guard enabled in the release differential oracle; compare rollback state and identities exactly.

The debug suite validates model-derived host hook aliases against pinned upstream base classes and checks their boundary bytes; full callsite derivation and per-hook hosting remain separate gates.

The WASM builder marks generated inline-JS snippets as ESM independently of the Node entry point's CommonJS boundary. Keep the snippets directory with the generated bindings when copying an artifact; the Node loader uses require(esm).

Set CARGO_BUILD_JOBS to limit the shared optimized WASM builder and its instrumenter; both honor that value (default 4). Use a lower limit on loaded hosts without changing optimization or instrumentation.
