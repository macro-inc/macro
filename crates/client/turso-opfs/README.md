# turso-opfs

Browser-only Turso `Clock`/`IO`/`File` adapter for DedicatedWorker-owned OPFS.

## Ownership and recovery boundary

`OpfsOwner::acquire(database_identity)` validates one direct-child canonical
identity (reserving the `-wal` and `-salvage` suffixes) and derives both the exclusive Web Lock
name and main/WAL paths from it. There are no independent scope/path inputs or
main-as-WAL aliases that could map the same files to different locks. `open()`
accepts no path argument. The lock remains held
through Turso use, consuming close, preserve/reset, and idle ownership, and is
released only by `OpfsOwner::release()`.

`OpfsSession::connect()` constructs the approved Turso dialect/options and
private OPFS storage internally. Callers must never invoke `Connection::close`
directly; `ConnectedOpfsSession::try_close()` exclusively owns and proves that
transition. Turso open/connect failures poison and require worker replacement
followed by a fresh lock acquisition and `recovery_wipe()`.

`OpfsOwner::sidecar()` is one more file of the same identity, `<identity>-salvage`,
for what has to outlive a wipe. A wipe or reset of the pair leaves it alone;
`remove_and_release()` deletes all three. Its calls need the owner lock to be
held, whether or not the pair is open. Each opens the file, flushes and closes
it again, so no handle outlives a call, unless `hold()` keeps one until the
sidecar is dropped or the file removed, and `write_tail(offset, bytes)` cuts off
whatever followed `offset`, a torn earlier write included.

`connect()` also caps Turso's page cache at `PAGE_CACHE_PAGES` (8,000 pages,
about 31 MiB at the default 4 KiB page size; native Turso keeps 2,000) and
turns on cache spilling. Turso's wasm default is 100,000 pages, and the
worker's linear memory never shrinks, so the cache otherwise grew with the
database. A
transaction that dirties more pages than the cap appends some of them to the
WAL as uncommitted frames before COMMIT, as native Turso does; ROLLBACK
discards them. Without spilling, such a transaction leaves nothing to evict and
each further page scans the whole cache. Clean pages beyond the cap are read
again from OPFS.

`connect()` runs the connection at `synchronous = NORMAL` while
`DEFER_COMMIT_FLUSH` is `true`: a COMMIT appends to the WAL without flushing
it (Turso still syncs a new WAL header after a checkpoint restarts the log). A killed tab or browser keeps what was appended; an OS crash or power loss
can drop the newest COMMITs and leaves the file as of an earlier one.
`ConnectedOpfsSession::flush_wal()` flushes the WAL when a write reached it
since the last flush and says whether it did; `wal_flusher()` is the same call
as a handle the storage keeps, which fails once the session closes.
Setting the constant to `false` restores a flush in every COMMIT.

The crate tests physical lock contention in its real DedicatedWorker. Actual
cross-worker termination/restart orchestration remains a WP-08 coordinator
harness responsibility: terminating a worker causes the browser to release its
Web Lock and worker-local JavaScript handles, after which the replacement worker
must acquire the same canonical database lock and call `recovery_wipe()` when the
coordinator selected wipe-before-open. Local tests do not claim cross-worker
termination proof.

## Repeatable verification

Run from the repository root:

```bash
cargo fmt -p turso-opfs -- --check
cargo test -p turso-opfs
cargo clippy -p turso-opfs --all-targets -- -D warnings
cargo check --target wasm32-unknown-unknown -p turso-opfs --all-targets
cargo clippy --target wasm32-unknown-unknown -p turso-opfs --all-targets -- -D warnings

# Each command compiles and runs the same #[wasm_bindgen_test] in a real
# DedicatedWorker with that browser's OPFS and Web Locks implementations.
wasm-pack test --headless --chrome crates/client/turso-opfs
wasm-pack test --headless --firefox crates/client/turso-opfs
```

On NixOS, `wasm-pack`'s downloaded WebDrivers may not have a runnable ELF
interpreter. Use the wasm-bindgen test runner with Nix-provided drivers instead:

```bash
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=wasm-bindgen-test-runner \
CHROMEDRIVER=/path/to/nix/chromedriver \
WASM_BINDGEN_TEST_ONLY_WEB=1 \
cargo test --target wasm32-unknown-unknown -p turso-opfs --lib -- --nocapture

PATH=/path/to/nix/firefox:$PATH \
CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUNNER=wasm-bindgen-test-runner \
GECKODRIVER=/path/to/nix/geckodriver \
WASM_BINDGEN_TEST_ONLY_WEB=1 \
cargo test --target wasm32-unknown-unknown -p turso-opfs --lib -- --nocapture
```
