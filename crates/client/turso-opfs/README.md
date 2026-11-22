# turso-opfs

Browser-only Turso `Clock`/`IO`/`File` adapter for DedicatedWorker-owned OPFS.

## Ownership and recovery boundary

`OpfsOwner::acquire(database_identity)` validates one direct-child canonical
identity (reserving the `-wal` and `-adopting` suffixes) and derives both the
exclusive Web Lock name and main/WAL paths from it. There are no independent
scope/path inputs or main-as-WAL aliases that could map the same files to
different locks. `open()` accepts no path argument. The lock remains held
through Turso use, consuming close, preserve/reset, and idle ownership, and is
released only by `OpfsOwner::release()`.

`OpfsSession::connect()` constructs the approved Turso dialect/options and
private OPFS storage internally. Callers must never invoke `Connection::close`
directly; `ConnectedOpfsSession::try_close()` exclusively owns and proves that
transition. Turso open/connect failures poison and require worker replacement
followed by a fresh lock acquisition and `recovery_wipe()`.

`OpfsOwner::adopt(&previous)` moves an older build's complete main/WAL pair to
this owner's paths, so a new storage version opens the old database and upgrades
it instead of starting empty. `previous` is a `PreviousLock` from
`OpfsOwner::lock_previous(identity)`: that identity's owner lock, taken only if
it is free (`ifAvailable`) and held until the caller releases it. A held lock
means a context of the older build may have the files open, so the caller moves
nothing; holding it through the moves and the first open keeps the older build
from opening, resetting or recreating its paths meanwhile. Nothing moves when
this owner's main file exists (`TargetExists`), when the previous pair is
incomplete or both files are empty (`NothingToAdopt`), or when a non-empty file
lacks a header Turso opens (`Unreadable`: the checks Turso's own open makes of
the database header, whole pages and a table b-tree first page in the main
file, the WAL magic, format and page size, and matching page sizes). Main and
WAL move under their new names, so committed WAL frames move
with them and no checkpoint is needed. Browsers without `FileSystemHandle.move`
report `Unsupported` and move nothing.

Before the first move the owner writes a marker beside its own files
(`<identity>-adopting`, a reserved suffix) recording the older identity and the
size and header of its WAL, whose random salts change when it is reset. It
stays until the moved files have opened (`ConnectedOpfsSession::finish_adoption`).
`read_adoption` reports a pending adoption as `Complete` or, after a stop
between the two moves, `Split`; a marker this adapter did not write completely,
or one without a main file beside it, is removed. `complete_adoption` brings a
split's WAL over only while it still matches the marker (`WalLost` otherwise;
an empty one is recreated without the lock) and, when it held frames, only
under the older identity's lock (`LockNeeded` without one). `return_adoption`
moves a self-contained database (empty WAL, which a close leaves;
`WalNotEmpty` otherwise) back to an older identity that holds no database
(`Occupied` otherwise), and `discard_adoption` makes the files this owner's
own. `record_attempt` appends one byte to the marker per caller attempt, which
`Adoption::attempts` reports, so a caller can bound how often it retries a
decision. A failed WAL move moves the main file back. Wiping or resetting an
identity removes its marker with its pair. A `lock_previous` request dropped
before it returns lets the lock go as soon as the browser grants it.
`src/browser/test/adopt.rs` covers each outcome, the lock and a dropped request
for it, Turso-invalid headers, both stops, splits with a matching and a changed
WAL, stale and malformed markers, attempt counts, and refused returns in a real
DedicatedWorker.

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
