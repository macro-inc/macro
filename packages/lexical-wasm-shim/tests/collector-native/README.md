# Production native lifetime boundary proof

These tests use an actual `document_session_wasm` compat-web artifact and its
unchanged wasm-bindgen declarations. They exercise `VersionCollector`, the exact
capture-lease queue, and the existing sole `NodeHandles` version finalizer.
There is no conformance model, initializer substitute, second version finalizer,
handwritten WASM declaration or full `ShimBackend` mock.

The fixture is state-only: it implements the actual minimal `NodeHandleBackend`
port. `nodeLifetime` rejects raw node construction rather than fabricating capture
ownership or reading a not-yet-bound node. Actual native snapshots issue versions
and exact record refs. Local graph leases and native pending updates protect
retirement; captured records use independent acknowledged native leases.

Build the exact native source at
`3386e986871fe7bca32c3c0ca96d1e7de07a7fe2` into an owned target with
`--no-default-features --features compat-web`, `-j2`, `nice 19` and an owned
`TMPDIR`. Use the matching Cargo.lock wasm-bindgen CLI, `--target web`, and normal
`wasm-opt -Oz --converge`. Preserve all four generated files together. The
artifact's `artifact.json` records source, features and file hashes; preparation
checks the source/feature identity and actual bytes. No assets are promoted.

From this package, set explicit paths to the artifact, exact source archive,
actual wasm-dis binary and a private output directory:

```sh
export COLLECTOR_NATIVE_ARTIFACT_ROOT=/absolute/compat-web-artifact
export COLLECTOR_NATIVE_SOURCE_ROOT=/absolute/exact-native-source
export COLLECTOR_NATIVE_PROOF_DIR=/absolute/private-proof-output
export COLLECTOR_NATIVE_WASM_DIS=/absolute/bin/wasm-dis
export TMPDIR=/absolute/private-tmp
nice -n 19 bun tests/collector-native/prepare.ts
nice -n 19 node node_modules/typescript/bin/tsc \
  -p "$COLLECTOR_NATIVE_PROOF_DIR/tsconfig.json"
nice -n 19 node node_modules/vitest/vitest.mjs run \
  --config tests/collector-native/vitest.config.mts
```

Preparation instruments the actual generated module and independently checks its
binary ABI inventory. It generates an external TypeScript configuration pointing
to the **actual generated artifact declarations** and source-matched Bebop
schemas. Missing paths fail before collection; no ambient stubs or alternative
models are accepted. The source archive needs normal Bebop dependency resolution;
a read-only dependency link is sufficient. Do not install into a live integration
worktree. Vite caches and proof files stay under the explicit private directories.

The deterministic tests inject collection requests, not native acknowledgements.
All successful retirement and lease receipts come from real native calls. Failed
preflight uses a real rejected native lease request and checks unchanged epoch.
Post-ack failure retains lease cleanup debt, then retries without repeating graph
retirement or callbacks. Reentered requests do not inherit an earlier receipt.
The preservation case reads an exact leased record after its graph is retired,
then verifies that the acknowledged final lease release makes it unavailable.

The smoke test runs with `--expose-gc`, drops a known historical version token,
crosses the WeakRef job boundary, and awaits the real V8 asynchronous major-GC
completion promise. It separately awaits the actual existing NodeHandles finalizer
and its native cleanup. There is no sleep, polling, manual finalizer invocation
or substitute registry. A real empty native lease/prune fence follows both
completion observations. Actual before/after audit snapshots must keep the same
active version, advance `retirementEpoch`, and satisfy
`retainedCaptures <= 2 * liveNodes` with an observed capture decrease.

Raw proof files preserve typed lifecycle events, issued snapshot/capture identities,
actual API and physical call IDs, both byte directions, reference slots and native
audit fields. All trace validation issues must be empty. Uint64 observations are
serialized as lossless decimal strings. Session disposal remains in the raw trace
outside the completed barrier. Inputs, measured glue/ABI manifests and source
hashes are retained for independent inspection.

This is a **production native state-lifetime boundary proof**, not full Macro or
facade acceptance. It does not establish the production backend's raw capture-owner
finalizer, installed plugin profile, document route, DOM parity, initializer or
performance gates. `captureFinalizerProven` remains false and
`fullMacroAcceptance` remains false. A successful bounded proof must not register
an accepting full-application GC producer.
