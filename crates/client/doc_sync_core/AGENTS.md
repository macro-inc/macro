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
- `push_in_flight` and `is_delivered` expose read-only own-WAL diagnostics, including
  acknowledgements above a prefix blocked by parked rows; hosts never mutate them.
- `PeerSupply` validates host-generated peers; never generate identities here.
- `PresenceBackend` is the clock-injected port; `SyncCore` installs
  `ProtocolPresence` over `sync_protocol::presence` by default. It retains Loro
  wire bytes and sender timestamps, returns ordered peers and expires strictly
  after the configured wall timeout.
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
`src/router/test.rs`; shared presence wire/expiry tests are in `src/presence/test.rs`.

Consume due own/assist retry timers once; reconnect or authorization inputs drive
blocked pushes. Never return an already-consumed retry as the next wake.

Only arm a due rebase wake while Running, synchronized and without an own push;
blocked work resumes on the next eligible input. Replay acknowledged rows already
covered by a shallow snapshot as no-ops after checksum/VV verification, so collected
history cannot cause repeated rebases. Never skip an unacknowledged row this way.

Preserve the pending local coalesce range when adoption replay completes; replaying
other owners never advances the local logged vector over an unappended edit.

Retire server-confirmed foreign rows from an outstanding own push; preserve its
message identity and every still-unconfirmed row until their ack or timeout.

Retain acknowledged assist bytes until local VV coverage proves they imported,
including across reset failure, replacement and pending dependencies; the server
excludes the sender from broadcasts. Do not reload rows covered by server evidence.
Queue assistance only with write authority; retained unsent assistance stays inactive
while read-only and resumes after regrant without changing other owners' durable rows.

Clear the old document's pending-import flag only after successful replacement,
before WAL/assistance replay can establish new pending dependencies; failed
replacement keeps the original document and its pending-history status.

Record server evidence from checksum-valid bytes of actually ACKed own-push rows;
the sender receives no broadcast echo. Never infer that proof from local document VV
or unpushed rows, so periodic foreign scans cannot resend already confirmed history.

Correct premature Gap parking only with validated retained-row coverage in the local
oplog and server evidence for every required parent frontier, while Running outside
reset/rebase and without an outstanding own push. Preserve batch eligibility until
its ACK or timeout, then retry gap recovery. This disproves the earlier missing-store inference; it does not prove
row delivery. Genuinely missing parents stay parked until TTL and never get pushed.
