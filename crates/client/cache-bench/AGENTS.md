# cache-bench

## What it is

The repeatable measurement for the client GraphQL cache engine (`cache-core` on
`cache-turso`). It generates production-size datasets, the responses the app's
backfill lanes and views write, from the app's own documents and schema, so the
native engine and the browser engine on OPFS replay the same bytes.

## Start here

- `src/dataset.rs`: tiers (`tiny`, `p50` ~14 MB, `p90` ~320 MB of origin storage, and `chat`: 6,500 member channels of 75 people each) and which ops each lane writes. Foreground ops come in `FOREGROUND_VARIANTS` variants that change the rows they write; each replay run writes the next variant (rotation kept beside the database or profile), then the same responses again as `write.<lane>.same`, the cost of a refetch that changed nothing.
- `src/faker.rs`: fills any selection set from the schema; `src/check.rs` proves every op projects completely.
- Native replay: `apps/web/tauri/graphql_cache_plugin/src/engine/test/bench.rs` (`native_cache_bench`, `native_cache_parity_dump`).
- Browser replay: `apps/web/src/lib/graphql-cache/worker/browser-test/bench-runner.ts` and `bench-harness.ts`.

## Recipes

All from the repository root, inside `nix develop`.

- Print the app's documents: `(cd apps/web && node src/lib/graphql-cache/worker/browser-test/bench-documents.ts <docs>)`.
- Generate a tier: `cargo run --release -p cache-bench -- generate --tier p90 --documents <docs> --schema static_assets/schema.graphql --out <data>`, then `cargo run --release -p cache-bench -- check --data <data>`.
- Native: `CACHE_BENCH_DATA=<data> CACHE_BENCH_REUSE=1 CACHE_BENCH_RUNS=5 nix develop .#tauri-linux --command cargo test --release --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin --lib -- --ignored --nocapture native_cache_bench`. `CACHE_BENCH_REUSE` keeps the seeded `<data>/native/cache.turso`. `CACHE_BENCH_IDLE_CHECKPOINT=1` leaves the engine quiet for 150 ms after each write step, so the plugin's own idle task (`engine/idle.rs`) copies the WAL once it is due, and records each copy as `idle.checkpoint` (ms) and `idle.checkpoint.frames`. Its JSON also carries `io` (mean `/proc/self/io` bytes and syscalls per step call) and `memory` (RSS after each run, peak RSS). The contended pass runs the reads again while a background loop hydrates (`contendedMs`, raw); `CACHE_BENCH_READ_GAP_MS=<mean>` waits a random exponential time before each read, so reads arrive independently of the hydrates as a person's do, instead of each right after the last (which makes their arrival depend on the engine and skews the median). `CACHE_BENCH_SKIP_CONTENDED=1` leaves the pass out.
- Channel batches: on a `chat` dataset, `CACHE_BENCH_DATA=<data> nix develop .#tauri-linux --command cargo test --release --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin --lib -- --ignored --nocapture --exact engine::test::channels::native_channel_batches_bench`. The Chat sidebar's 500-ID batches as exact reads and as live views, then per write the reads of every view its reply did not prove unchanged (`push.total` is the write and those reads). `memory` is resident size after `malloc_trim`; `CACHE_BENCH_HOT=<records>` caps the hot tier. `CACHE_BENCH_CHANNEL_DUMP=<data>/channels` writes the inputs instead of running, for the browser: build the bench page as below, then `node src/lib/graphql-cache/worker/browser-test/bench-runner.ts --data <data> --channels --runs 1`, which replays them through the app's `createPredicateQuery` readers until each push's reads have settled.
- Contention: after `native_cache_bench` seeded `<data>/native`, `CACHE_BENCH_DATA=<data> nix develop .#tauri-linux --command cargo test --release --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin --lib -- --ignored --nocapture --exact engine::test::contention::native_contention_bench`. A quiet phase and a loaded one (`CACHE_BENCH_PHASE_SECS`, 20) on `CACHE_BENCH_WORKERS` (8) runtime workers; `CACHE_BENCH_BACKGROUND_COPIES` (1) sets how many producers each background lane (contact pages, warming hydrates, refetch writes) has. Per command it prints answer time, longest poll, engine wait and hold, and how many a write superseded.
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
