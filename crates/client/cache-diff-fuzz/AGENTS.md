# cache-diff-fuzz

## What it is

A differential fuzzer for the client GraphQL cache. Two builds of it, one per
version of the cache (before and after a change), run the same seeded operation
sequences through the native host engine. Every response and every table left on
disk after a reopen must come out the same.

## How it works

- `build.rs` copies the Tauri host's `engine` module
  (`apps/web/tauri/graphql_cache_plugin/src/engine*`) into the binary, so the
  fuzzer drives the same `EngineHandle` the desktop app does. `src/fuzz_hooks.rs`
  is compiled inside that module.
- `src/sequence.rs` generates a case from a seed: hydrates, writes, reads, Soup
  filters and search, the optimistic mutation queue (enqueue, claim, commit,
  rollback, defer), deletes, invalidation, people search, idle, reopen, crash,
  probes, and written pages again with one value broken (`src/malformed.rs`). Responses come from `src/faker.rs` over the app schema.
- `src/exec.rs` runs a case. `src/normalize.rs` replaces the ids the engine mints
  (`#1`, `#2`, …) and keeps every id that appears in the case. `src/dump.rs`
  writes the tables after a final reopen, each value tagged with its type.
- A reset on open (`open_or_reset` deleting a file it can't read) and a failed
  idle checkpoint are recorded, not hidden: the first goes into the trace, the
  second stops the run. A run that stops early writes `abort` to its trace and
  exits non-zero, so `fuzz.sh` counts the seed as failed.

## Recipes

- Build a side: `build-side.sh NAME BASE [BRANCH...]`, NAME of letters, digits, `-` and `_` (a detached worktree in
  `~/.cache/cache-diff-fuzz/sides/NAME`, binary in `bin/NAME`). Set
  `IDLE_CHECKPOINT=1` when the side has `TursoStorage::checkpoint_if_due`.
- Compare: `fuzz.sh RUN FIRST COUNT SIDE_A SIDE_B [JOBS]`. RUN must be a new name.
  The run works on copies of both binaries, the schema and the assets, so a
  rebuild or an edit meanwhile does not reach it. Differences go to `runs/RUN/diffs.txt`, seeds a side could not finish to
  `runs/RUN/failures.txt`; it exits 0 only when neither has a line.
- Shrink a difference: `minimize.sh SEED SIDE_A SIDE_B`.
- Rerun one seed: `bin/SIDE --seed N --schema static_assets/schema.graphql --assets
  crates/client/cache-diff-fuzz/assets --out D --work D/w --full`. Use
  `--emit-case` and `--case FILE` to save a case and rerun it. A seed's case
  depends on the fuzzer source (hashed in `bin/SIDE.side`), the schema and the
  assets (hashed in `runs/RUN/run.txt`); rerun it with all three unchanged.

## Checks

- `cargo clippy -p cache-diff-fuzz --all-targets`
- After a generator change: a side compared with itself (`fuzz.sh self-X 1 50 X X`)
  reports 0 differences.

## Gotchas

- Both sides must be built from the same fuzzer source: `fuzz.sh` refuses
  otherwise. Use `FUZZER_SRC=<snapshot>` to build later sides from the same copy.
- Any change to `src/sequence.rs` changes every seed's case. Earlier runs can't be
  rerun by seed number after that.
- A crash copies the cache files and abandons the engine, so it can't model a
  lost fsync.
- The browser build (OPFS, the SharedWorker coordinator, the wasm shell's hydrate
  split) is not reached here.
