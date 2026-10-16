# turso-opfs

## What it is

Part of the web client's shared infrastructure: a browser-only Turso
`Clock`/`IO`/`File` adapter over a DedicatedWorker's Origin Private File
System, backing `cache-turso`'s storage for the normalized GraphQL cache.
Production code is wasm32-only; the lifecycle state machine also compiles
natively for its unit tests. See `README.md` for the full ownership/recovery
contract and the multi-target verification commands.

## Start here

- `README.md`: the ownership/recovery boundary — read before touching
  `OpfsOwner`, `OpfsSession`, or close/reset paths.
- `src/browser.rs` (wasm32 only): `OpfsOwner`, `OpfsSession`, `ConnectedOpfsSession`,
  close/reset state types.
- `src/state.rs`, `src/write_batch.rs`: target-independent lifecycle machine,
  compiled natively for unit tests.

## Scope

- Owns: the exclusive Web Lock + main/WAL file pair for one canonical database
  identity, and the typed open/connect/close/reset state machine around it.
- Not here: the Turso storage adapter that uses this → `crates/client/cache-turso`;
  cross-worker termination/restart orchestration (a coordinator responsibility,
  not tested here — see README "Repeatable verification").

## Boundaries

- Depends on: `turso_core` (feature `fs`, `uuid`), `wasm-bindgen`/`web-sys` (wasm32 only).
- Used by: `cache-turso`, `cache-wasm` (wasm32 target only).

## Recipes

- Change the open/close state machine: `src/state.rs` (native-testable) →
  `src/browser.rs` (wasm wiring) → the `#[wasm_bindgen_test]` suite (README
  "Repeatable verification").

## Checks

- `cargo test -p turso-opfs` (native lifecycle tests; `SQLX_OFFLINE` unset).
- `cargo check --target wasm32-unknown-unknown -p turso-opfs --all-targets`
  and the `#[wasm_bindgen_test]` suite — see `README.md` for the full command list.

## Gotchas

- `#![forbid(unsafe_code)]` and `#![deny(missing_docs)]`.
- Never call `Connection::close` directly — `ConnectedOpfsSession::try_close()`
  exclusively owns and proves that transition.
- `OpfsOwner::acquire` derives both the lock name and main/WAL paths from one
  canonical identity; there's no independent path input that could alias the
  same files to a different lock.
- Local tests prove physical lock contention but not real cross-worker
  termination — don't read passing tests here as proof of that.

## Related

- Docs: `README.md`
