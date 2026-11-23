# cache-bench

## What it is

The repeatable measurement for the client GraphQL cache engine (`cache-core` on
`cache-turso`). It generates production-size datasets, the responses the app's
backfill lanes and views write, from the app's own documents and schema, so the
native engine and the browser engine on OPFS replay the same bytes.

## Start here

- `src/dataset.rs`: tiers (`tiny`, `p50` ~14 MB, `p90` ~320 MB of origin storage) and which ops each lane writes.
- `src/faker.rs`: fills any selection set from the schema; `src/check.rs` proves every op projects completely.
- Native replay: `apps/web/tauri/graphql_cache_plugin/src/engine/test/bench.rs` (`native_cache_bench`, `native_cache_parity_dump`).
- Browser replay: `apps/web/src/lib/graphql-cache/worker/browser-test/bench-runner.ts` and `bench-harness.ts`.

## Recipes

All from the repository root, inside `nix develop`.

- Print the app's documents: `(cd apps/web && node src/lib/graphql-cache/worker/browser-test/bench-documents.ts <docs>)`.
- Generate a tier: `cargo run --release -p cache-bench -- generate --tier p90 --documents <docs> --schema static_assets/schema.graphql --out <data>`, then `cargo run --release -p cache-bench -- check --data <data>`.
- Native: `CACHE_BENCH_DATA=<data> CACHE_BENCH_REUSE=1 CACHE_BENCH_RUNS=5 nix develop .#tauri-linux --command cargo test --release --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin --lib -- --ignored --nocapture native_cache_bench`. `CACHE_BENCH_REUSE` keeps the seeded `<data>/native/cache.turso`.
- Browser: from `apps/web`, `just build-cache-wasm`, `bunx --bun vite build --config src/lib/graphql-cache/worker/browser-test/bench.vite.config.ts`, `bun scripts/cache-wasm/cli.ts package-dist --dist src/lib/graphql-cache/worker/browser-test/.dist-bench`, then `node src/lib/graphql-cache/worker/browser-test/bench-runner.ts --data <data> --runs 5 --out <file>`.
- Prove a read change returns the same rows: run `native_cache_parity_dump` (`CACHE_BENCH_DATA`, `CACHE_BENCH_DUMP=<file>`) on the old and new code over one seeded database and `cmp` the dumps.
- A/B a change: alternate old and new builds over one seeded database or profile, two rounds each; compare p50s only within one machine and one dataset.

## Checks

- `cargo test -p cache-bench` and the `cache-bench -- check` above.
- Mail tab inputs: `bun run test -- src/features/email-view/queries/cache-bench-mail-tabs.test.ts` from `apps/web`; `UPDATE_CACHE_BENCH_TABS=1` regenerates `bench-mail-tabs.json` after the app's tab filters change.

## Gotchas

- A browser profile's OPFS belongs to its origin: rerun a seeded profile on the same `--port`, or it opens an empty database while the profile's `.seeded` marker skips the seed (every Mail read then answers `incomplete`).
- The seed is deterministic for a tier and `--seed`; regenerate datasets after schema or document changes, never edit them.
- Numbers are relative to this harness, not production: production read timings come from the `graphql_cache.*` spans in Datadog.
