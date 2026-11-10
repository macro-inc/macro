# Comment gate differential

Run `TMPDIR=/home/wolf/tmp cargo test -p macro_document_model --test gate -j4`,
then `TMPDIR=/home/wolf/tmp bun packages/lexical-conformance/diff/gate-fuzz/wasm.ts`.
The native test freshly generates the service oracle; the second command builds
and replays the actual WASM module with default features disabled.

`generate.ts` runs all twelve unchanged service tests through a recording wrapper
and creates 20,000 fixed-seed hostile JSON pairs with the exact service editor.
It includes synthetic per-node inputs, identity and content state, formatting,
missing/invalid fields, nesting, legacy code/list and type rewrites. Text split
mutations preserve valid UTF-16 edit boundaries. Every normalized result and
verdict is compared, including rejected states and errors.

Resolve the deterministic nanoid mock through Bun's ESM resolver, matching
AwaitNode's actual import. Before writing rows, verify the real service gate
fills a missing Await ID deterministically and compares repeated input equally.
Run this check after row capture so its editor allocations do not shift exact
parse-error node keys.

`loro.ts` generates 2,048 binary client updates using real Loro operations. The
native test imports the seed and calls sync_server_core::DocumentState::root_change,
checks the exact projected pair, then compares both normalizations and verdicts.
The same projected JSON pairs are replayed against actual WASM.

The reviewed fail-closed ruling intentionally refuses malformed imports that the
service logging error handler can partially accept. Every allowed divergence in
`macro_document_model/tests/corpus/gate-divergences.json` binds the complete source
oracle row (inputs, normalized outputs and source verdict) by SHA-256, requires
the exact Rust error, and requires Rust to fail. Changed, stale and unused entries
fail; there is no generic malformed-input exemption. The JSON failure artifact
is written under `target/lexical-conformance/` for diagnosis. Never automatically
refresh the ledger or weaken comparisons to make a new case pass.
