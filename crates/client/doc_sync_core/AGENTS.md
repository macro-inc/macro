# doc_sync_core

## What it is

Deterministic client sync machines for collaborative documents: the WAL,
convergence, reset/rebase, presence, comment delivery, socket connections and
the multi-document router. Callers supply clocks and identities; transport and
storage run in the host.

## Start here

- `src/core.rs`: `SyncCore`, its public observations and `handle`.
- `src/input.rs`, `src/output.rs`: the host contract.
- `src/core/`: lifecycle, persistence, delivery, imports, assistance, presence.
- `src/router.rs`, `src/connection.rs`: routed and direct transport.

## Scope

- Owns: WAL and storage semantics, convergence, reset/rebase, comment delivery,
  presence expiry, socket generations and routing.
- Not here: editor projection and sessions → `crates/client/document_session`;
  host ABI encoding → `crates/client/document_session_wasm`.

## Boundaries

- Depends on: Loro, `sync_protocol`.
- Used by: `document_session` and its WASM/FFI hosts, `sync_sim`.

## Checks

- `cargo test -p doc_sync_core`
- `cargo check -p doc_sync_core --target wasm32-unknown-unknown`
- `cargo clippy -p doc_sync_core --all-targets -- -D warnings`
- `cargo tree -p doc_sync_core --target wasm32-unknown-unknown -i workspace-hack` (must find nothing)
- `ast-grep test --test-dir rules/ast-grep-tests --skip-snapshot-tests` when changing the determinism rule
- `cargo x deps --check`, `cargo shear`, `just check`

## Gotchas

- No I/O, clock reads, randomness or unordered iteration; the
  `rust-sync-core-determinism` ast-grep rule enforces it.
- Never infer poison from a missing acknowledgement, and never advance the
  durable prefix over parked rows.
- Delivery proof comes only from acknowledged own-push bytes, never from the
  local version vector.
- Probes, resets and comment forks need fresh host-supplied peers; never mutate
  the live document to probe.
- Storage serde is postcard between Rust peers only; the browser ABI uses Bebop.
- `effective_access` is an observation; it never grants admission.
- Tests in `src/core/test/` use real Loro documents with fixed peers and explicit
  timestamps, plus controlled storage and socket completions.

## Related

- Docs: [Client document sessions](../../../docs/architecture/document-session.md),
  [DSS sync router](../../../docs/architecture/sync-router.md)
