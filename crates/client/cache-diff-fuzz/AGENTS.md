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
  filters and live views of them (read, read since, resume, release), search, the optimistic mutation queue (enqueue, claim, commit,
  rollback, defer), deletes, invalidation, people search, idle, reopen, crash,
  probes, and written pages again with one value broken (`src/malformed.rs`). Responses come from `src/faker.rs` over the app schema.
  Random filters rarely fill a first candidate window (64 candidates), so a `deep-window`
  op hydrates every core page and filters for a few documents past the first window: the
  window has to extend past the rows it rejects. It invalidates nothing, since any incomplete
  document in a query's partitions answers it as incomplete before a window runs.
- `src/exec.rs` runs a case. `src/normalize.rs` replaces the ids the engine mints
  (`#1`, `#2`, …) and keeps every id that appears in the case. `src/dump.rs`
  writes the tables after a final reopen, each value tagged with its type.
- A reset on open (`open_or_reset` deleting a file it can't read) and a failed
  checkpoint at an `idle` op's hook are recorded, not hidden: the first goes into the
  trace, the second stops the run. A checkpoint the host's own idle task runs
  (`--no-idle-hook`) is not observed; only its effect on what is read and stored is. A run that stops early writes `abort` to its trace and
  exits non-zero, so `fuzz.sh` counts the seed as failed.

## Recipes

- Build a side: `build-side.sh NAME BASE [BRANCH...]`, NAME of letters, digits, `-` and `_` (a detached worktree in
  `~/.cache/cache-diff-fuzz/sides/NAME`, binary in `bin/NAME`). Set
  `IDLE_CHECKPOINT=1` when the side has `TursoStorage::checkpoint_if_due`.
- Compare: `fuzz.sh RUN FIRST COUNT SIDE_A SIDE_B [JOBS]`. RUN must be a new name
  of the same characters as NAME (so must `TARGET`).
  The run works on copies of both binaries, the schema and the assets, so a
  rebuild or an edit meanwhile does not reach it. Differences go to `runs/RUN/diffs.txt`, seeds a side could not finish to
  `runs/RUN/failures.txt`; it exits 0 only when neither has a line.
- Shrink a difference: `minimize.sh SEED SIDE_A SIDE_B`. It reruns the case from an
  empty file, so it can't shrink a finding of an `UPGRADE` or `CHAIN_*` run: rerun
  those from the file kept in `runs/RUN/upgrade/SEED` by hand.
- When a change alters how records are encoded on purpose, compare with
  `FUZZ_ARGS=--decoded-records`: `records.value` is compared as the record each
  side's own codec decodes, and a `search_documents.source_hash` equal to the hash
  of its record's stored bytes as `h:record`. Response `sourceHash` values become
  `h1`, `h2`, … by first appearance. Every other byte is still compared.
- When a change moves index document facts into another table (storage schema 13 keeps
  them as one blob per document), add `--decoded-facts`: `index_document_facts` is
  compared as each complete document's facts, decoded from the blob or gathered from
  the fact tables, and `meta`'s storage schema version is masked.
- When the host checkpoints on its own once quiet (an idle task 100 ms after its last
  command), add `--real-pause 95` to `FUZZ_ARGS`: `idle`, `reopen` and `crash` ops
  first wait that long plus up to 30 ms in real time, so the host's copy runs, and the
  reopen or crash after a pause can land while it copies. `--no-idle-hook` stops
  `idle` ops calling the host's idle point, so only the host's own task checkpoints.
  Stats count `pause.database-written`: pauses during which a copy reached the
  database file. Background tasks the host spawns run on a Tokio runtime.
- When the cache core splits a hydrate into a stage and a commit (`Engine::stage_hydrate`),
  build the side with `STAGED_HYDRATE=1` and give it `--stage-hydrates`: each hydrate is
  staged before the op ahead of it runs and committed at its own turn, or run whole when
  that op made the stage stale (stats `stage.committed`, `stage.whole-at-commit`). A stage
  that fails answers the hydrate with its error, as the browser's `prepareHydrate` rejects,
  unless storage moved since it was staged; then the hydrate runs whole.
  Staging reads the authority and the contact fence before the op ahead, which the
  browser never lets a write do; a difference that only that ordering explains is the
  harness's.
- When reads may run while a hydrate writes, add `--concurrent-reads RATE` (0 to 1) to
  both sides: that share of hydrates runs with reads from other threads. A read issued
  before the hydrate returned must equal the state before it or after it, and one issued
  after it returned the state after it, or the seed fails. Timers don't guarantee overlap:
  stats `split.issued-during` and `split.issued-after` say how many reads overlapped.
- `FUZZ_ARGS` goes to both sides; `FUZZ_ARGS_A` and `FUZZ_ARGS_B` to one each, for
  one build under two settings (e.g. `FUZZ_ARGS_B="--hot-capacity 16"` against
  itself: the hot tier is a cache, so its size must change nothing).
- Upgrade: `UPGRADE=1 fuzz.sh RUN FIRST COUNT OLD NEW`. OLD runs each case and keeps
  its file; both sides then start from that file (`--start-from`, which must lie outside
  `--work`) with a probe and
  the case again, so NEW must read and extend what OLD stored exactly as OLD does.
  Seeds that differ or fail keep the file in `runs/RUN/upgrade/SEED`. When NEW hashes
  records differently, add `--mask-source-hashes` to `FUZZ_ARGS`: NEW rehashes
  records OLD stored when the case writes them again, though their content is the same.
- Downgrade and mixed builds: `CHAIN_A="a a" CHAIN_B="b a" fuzz.sh RUN FIRST COUNT OLD NEW`.
  Each side runs a chain of builds on one file (`a` is SIDE_A, `b` SIDE_B): the first
  runs the case on an empty file, each next one starts from what the one before left,
  with a probe and the case again. `"b a"` against `"a a"` is NEW's file opened by OLD,
  compared with OLD alone; `"b a b a"` alternates builds across reopens. Add
  `--mask-source-hashes` when the builds hash records differently.
- A migrated file against a fresh one: `CHAIN_A="b b" CHAIN_B="a b"` with SIDE_A the older
  build and SIDE_B the newer: side a is NEW from an empty file, side b is OLD's file migrated
  by NEW, each then running the case again.
- Interrupted migration: build NEW with `MIGRATION_HOOKS=1` (its `cache-turso` needs the
  `migration-test-hooks` feature) and give it `FUZZ_ARGS_B="--interrupt-migration-after K"`:
  its first open fails right after committing step K, as a killed process would (the hook must
  report it stopped that open), and the open
  after it finishes the migration. Stats count `migration.interrupted` (only opens that had
  that step to run are interrupted, so count them before trusting a clean run).
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
- Any change to `src/sequence.rs` or `src/sequence/` changes every seed's case. Earlier runs can't be
  rerun by seed number after that.
- A crash copies the cache files and abandons the engine, so it can't model a
  lost fsync.
- The browser build (OPFS, the SharedWorker coordinator, the wasm shell's hydrate
  split) is not reached here.
