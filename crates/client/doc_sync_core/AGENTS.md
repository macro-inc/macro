# doc_sync_core

## What it is

Deterministic client synchronization contracts and machines. All clocks and
identities come from callers; transport and durable storage run outside this crate.

## Scope

- No I/O, clock reads, random generation, or unordered output iteration.
- `SyncCore::handle` consumes inputs and clears/refills one output buffer; hosts
  send `Ready` after applying `Seeded` and execute storage effects in issue order.
- `SyncCore` owns WAL, convergence, reset/rebase, snapshot and comment delivery.
  Never infer poison from an absent ack or advance a durable prefix over parked rows.
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

## Host integration

- Forward direct `Socket*` effects to the socket identified by `ConnId`.
- For routed sessions, forward inner `SocketSend` frames to `RouterInput::Send`;
  execute `RouteReconnect` and `RouteDetach` on the shared router, never close its
  physical socket for one document. Feed `RouterOutput::to_sessions` back as `Route`.
- `Start` reserves the document's existing peer. Supply different, unused ids for
  resets and probes. Use `allocate_comment_peer` before staging a comment fork.
- `SyncDoc::probe_import` receives a fresh supplied peer; set it before importing
  the server snapshot into the throwaway document. Never mutate the live document.
- Presence expiry is a wall timestamp from the port; the core translates it to
  the monotonic timer using the latest host-supplied `Now`.
- A timed-out adoption remains correlated until its transaction result arrives:
  a delayed commit must not strand rows under this session's live owner.

## Tests

`src/core/test/` uses real Loro documents with fixed peers and explicit commit
timestamps plus controlled storage and socket completions. Tests named
`s7_NNN_*` map to core-owned S7 section 6 rows. Router cases are in
`src/router/test.rs`; production presence serialization remains WP-42's work.
