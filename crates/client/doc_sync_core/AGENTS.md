# doc_sync_core

## What it is

Deterministic client synchronization contracts and machines. All clocks and
identities come from callers; transport and durable storage run outside this crate.

## Scope

- No I/O, clock reads, random generation, or unordered output iteration.
- `Connection` handles socket generations, heartbeat and backoff; `RouterCore`
  multiplexes independently authorized routes on one physical socket.
- `PeerSupply` validates host-generated peers; never generate identities here.
- `PresenceBackend` is the clock-injected port; the production store adapter is
  deferred until `sync_protocol::presence` lands (WP-42).
- Storage serde is for Rust-only postcard; host ABI encoding is a separate adapter.

## Checks

- `cargo test -p doc_sync_core`
- `cargo check -p doc_sync_core --target wasm32-unknown-unknown`
- `cargo clippy -p doc_sync_core --all-targets -- -D warnings`
- `cargo tree -p doc_sync_core --target wasm32-unknown-unknown -i workspace-hack`
- `cargo x deps --check`, `cargo shear`, `just check`

## Storage semantics

- Execute operations in issue order per document; report durable completion.
- Append is idempotent on `(doc, owner, seq)`; retry only uncertain writes.
- Adoption is one conditional transaction, preserving delivered and quarantine flags.
- Never wipe storage automatically; pruning requires a durable covering snapshot.
- Keep quarantined rows until TTL; never infer poison from absent acknowledgements.
- Serialize storage with postcard only between Rust peers. The browser ABI uses Bebop.
- `rust-sync-core-determinism` in `rules/ast-grep/` enforces ordered containers
  and host-supplied clocks/randomness. Exercise its fixtures with
  `ast-grep test --test-dir rules/ast-grep-tests --skip-snapshot-tests`.
