# sync_server_sim

## What it is

Native in-memory room capabilities and the golden Worker transcript corpus.
`sync_server_core` owns policy; this crate owns fake runtime behavior and replay.

## Start here

- `src/migration_test.rs`: real Room recovery at source/target persistence boundaries.
- `src/ports.rs`: synchronous in-memory ports, ordered effects, clocks, faults,
  output-gate confirmation and socket lifecycle.
- `src/replay.rs`: the real core Room and the explicit `ENABLED` allowlist.
- `src/replay/golden.rs`: ordered Worker-boundary projection and final storage checks.
- `src/replay/golden/receipts.rs`: validated native snapshot/receipt correspondence.
- `src/transcript.rs`: lossless JSONL parsing and comparison helpers.
- `tests/transcripts/COVERAGE.md`: behavior inventory and representative fixtures.

## Boundaries

- Depends on the pure core and protocol; never Worker, Tokio, HTTP clients or a DB.
- Used by native replay and the later sync simulation driver.
- The explicit `ENABLED` list grows with extracted callbacks. Reject unsupported
  callbacks; never replay recorded outputs as if the core produced them. Enable fixtures only
  with the corresponding callback extraction and complete effect comparison.

## Checks

- `cargo test -p sync_server_sim -p sync_server_core -p sync_protocol`
- Run the sync-service suite and compare a fresh recording to the committed corpus.
- After moving corpus paths, run the PII scanner tests; local test JWT exemptions
  still require signature verification and exact fixture paths.

## Gotchas

- Port futures resolve on their first poll; only an injected crash stays pending.
- A closing socket stays listed until the runtime completes its close callback.
- D1 claims may replace only the system author; missing-peer insertion never
  replaces an existing owner. D1 writes survive DO output-gate rollback.
- Re-record comparison is byte-exact except the documented time/UUID and
  awareness normalization. Under the S6 native comparison ruling (2026-11-07),
  native Loro envelopes allow export-derived lengths/chunks to differ while
  comparing state, vectors and frontiers. Generated revision VVs compare as maps;
  forwarded updates, client VV echoes and all other envelope fields stay exact.
  RequestSince deltas require the pre-message document context. Native migration
  receipts verify SHA-256 against each side's snapshot before semantic comparison;
  translate only exact previously validated receipt/snapshot references. Never
  repair forged inputs. Keep workerd digest bytes exact.
- `fork_durable` opens an isolated cold view; `take_completed_puts` and
  `take_delivery_proofs` expose success/generation evidence without changing port effects.
  Durable generations share immutable value/snapshot buffers; writes replace leaves,
  and public reads/dumps return owned copies. Deserialize typed reads from borrowed
  immutable values so raw-byte arrays need no intermediate JSON clone. Confirming an older generation must
  preserve its exact pre-overwrite content through cold recovery.
  `take_queued_sends` and `take_completed_closes` distinguish successful runtime
  actions from failed attempts.
  Fault `"*"` counts calls through the fault-capable boundary, not diagnostic clock reads.
- Keep this crate excluded from hakari; no ambient clock or random UUID calls.

## Native coverage floor

Install `cargo-llvm-cov` as a local development tool. From the repository root:

```sh
TMPDIR=/home/wolf/tmp cargo llvm-cov -p sync_server_core -p sync_server_sim --json --output-path /home/wolf/tmp/sync-core-coverage.json
python3 crates/sync_server_sim/scripts/check-public-coverage.py /home/wolf/tmp/sync-core-coverage.json
```

The floor checks every public core function, aggregating monomorphized instances
and async wrappers by source location. Tests call real Room use cases over the
simulation ports and hand-written fakes; golden replay separately checks ordered
runtime effects. Presence comparisons include exact native timestamps, including
tombstones. For C0's unobservable local-delete clocks, only clock inputs are
recovered from wire timestamps. Runtime enumeration order must retain exact live
socket membership. Read-only Room diagnostics expose no mutable Loro handle.
- `src/persistence_test.rs` checks failed first writes versus durable pending/failed
  archive writes, same-time log identities and actual cold replay after cache invalidation.
