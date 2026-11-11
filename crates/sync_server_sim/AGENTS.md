# sync_server_sim

## What it is

Native in-memory room capabilities and the golden Worker transcript corpus.
`sync_server_core` owns policy; this crate owns fake runtime behavior and replay.

## Start here

- `src/migration_test.rs`: real Room recovery at source/target persistence boundaries.
- `src/ports/storage.rs`: atomic logical/physical operation persistence and corruption handling.
- `src/ports.rs`: synchronous in-memory ports, ordered effects, clocks, faults,
  output-gate confirmation and socket lifecycle.
- `src/replay.rs`: the real core Room and the explicit `ENABLED` allowlist.
- `src/replay/golden.rs`: ordered Worker-boundary projection and final storage checks.
- `src/replay/golden/receipts.rs`: validated native snapshot/receipt correspondence.
- `src/transcript.rs`: lossless JSONL parsing and comparison helpers.
- `tests/transcripts/COVERAGE.md`: behavior inventory and 158 default Worker fixtures, including the three application comment-root gate modes.
- `tests/transcripts-activated/COVERAGE.md`: 160 activated fixtures, covering all 158 default cases and two activation-only resolved-dependency scenarios.

## Boundaries

- Depends on the pure core and protocol; never Worker, Tokio, HTTP clients or a DB.
- Used by native replay and the sync simulation driver.
- Keep recorded comment verdicts ahead of an optional pure application evaluator;
  absent both, fail closed. Preserve the evaluator across cold durable forks and
  pass actual proposed roots plus the injected port clock.
- The explicit `ENABLED` list grows with extracted callbacks. Reject unsupported
  callbacks; never replay recorded outputs as if the core produced them. Enable fixtures only
  with the corresponding callback extraction and complete effect comparison.

## Checks

- Store oversized transcript fixtures as deterministic `.jsonl.gz`; native replay decompresses them and preserves their logical `.jsonl` identity.

- `cargo test -p sync_server_sim -p sync_server_core -p sync_protocol`
- Run the sync-service suite and compare a fresh recording to the committed corpus.
- After moving corpus paths, run the PII scanner tests; local test JWT exemptions
  still require signature verification and exact fixture paths.

## Gotchas

- Port futures resolve on their first poll; only an injected crash stays pending.
- A closing socket stays listed until the runtime completes its close callback.
- D1 claims may replace only the system author; missing-peer insertion never
  replaces an existing owner. D1 writes survive DO output-gate rollback.
- Record Worker goldens with the pinned 1.16.3 service test driver and vendored server encoder; verify old/new native replay, real legacy interoperability and repeated exact recordings before refreshing encoded snapshots.
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

The server encoder uses the vendored Loro1.16.2 dependency (`loro_server`),
separate from editor/session Loro1.17.1. Preserve the unchanged Worker corpus.

Decode every gzip member and reject corrupt tails when loading fixtures or
following inventory links; never silently accept only the first member.

Oversized operation writes use the shared physical chunk format in the stored
map, atomically at one port write generation. Completed-put facts retain the
logical bytes. `operation_storage_proof` independently reconstructs physical
records for simulator invariants; missing/corrupt chunks fail rather than replaying
a prefix. Pruning pending manifests also removes their physical chunks, while
archives retain theirs.

Archive receipts/dedup default off in SimPorts, matching the Worker activation.
Use `set_operation_archive_writes` for activated tests; cold forks preserve the
selection. Readers always accept legacy absent, Incomplete and Complete statuses.
Common pending/archive/attribution writes and the embedded Complete receipt share
one durable generation. Failed-append pending bytes and Incomplete sidecar share
one generation. GC removes sidecars with logical rows and retains archive history.

Keep default-OFF `tests/transcripts` unchanged and writer-ON `tests/transcripts-activated` separate. Replay activated fixtures with explicit deployment configuration, never infer policy from recorded outputs. Transaction projection validates exact supported calls/returns/retries and publishes the logical effect only at commit, so premature ACKs remain observable. Keep unrecognized transactions fail-closed.

Discover typed `o/~fanout` debt in the existing pending-prefix read and exclude it
from logical operations. Keep reader support unconditional, with new debt creation
behind the same operation-writer activation. Alarm retries must use only applied
durable history and preserve debt on send or storage failure.
