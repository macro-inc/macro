# sync_server_sim

## What it is

Native in-memory room capabilities and the golden Worker transcript corpus.
`sync_server_core` owns policy; this crate owns fake runtime behavior and replay.

## Start here

- `src/ports.rs`: synchronous in-memory ports, ordered effects, clocks, faults,
  output-gate confirmation and socket lifecycle.
- `src/replay.rs`: the real core Room and the explicit `ENABLED` allowlist.
- `src/transcript.rs`: lossless JSONL parsing and comparison helpers.
- `tests/transcripts/COVERAGE.md`: behavior inventory and representative fixtures.

## Boundaries

- Depends on the pure core and protocol; never Worker, Tokio, HTTP clients or a DB.
- Used by native replay and the later sync simulation driver.
- C7 has no enabled callback transcripts. Reject unsupported callbacks; never
  replay recorded outputs as if the core produced them. Enable fixtures only
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
  awareness normalization. Native Loro snapshot comparison is semantic;
  RequestSince deltas require the pre-message document context.
- Keep this crate excluded from hakari; no ambient clock or random UUID calls.
