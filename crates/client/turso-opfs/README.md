# turso-opfs

Browser-only Turso `Clock`/`IO`/`File` adapter for DedicatedWorker-owned OPFS.

## Ownership and recovery boundary

`OpfsOwner::acquire(database_identity)` validates one direct-child canonical
identity (reserving the `-wal` suffix) and derives both the exclusive Web Lock
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
