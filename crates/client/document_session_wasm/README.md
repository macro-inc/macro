# Portable document session boundary

`document_session_wasm` is the production WASM entry point for `EditorSession`,
`DocSession` and `SyncRouter`. Native sessions retain all sync and editing policy;
the host executes owned effects on the main thread.

`abi/session.bop` generates Rust and TypeScript cold messages. Primitive editor
methods avoid Bebop on keystrokes. The MSES output header contains ABI major,
Diff format, Diff words/string lengths and effect count. Each aligned effect is
`tag, correlation, detail, payload length, payload`. `takeOutput()` returns an owned
copy; the next call or WASM memory growth cannot invalidate it. UTF-16 primitives
reject lone surrogates. Byte arrays decoded by Bebop retain subarray views.

ABI major 2 carries the exact source records selected for WAL adoption, including
delivered flags and bytes. The browser holds the source owner's lease and a
per-document snapshot lock through cover validation and the WAL transaction.
Legacy snapshot writers share that lock so cover validation cannot race a save
or delete. A changed nonempty selection or cover is refused without mutation.

The default registry includes core and portable rich nodes. The application
registry remains a later integration through the native registry builder.
Markdown queries reuse lexical_markdown; HTML and clipboard use portable native
exporters. No browser or storage APIs live in this crate.

Release WASM compiles tracing at INFO, matching the host subscriber's existing
filter. Native builds keep their normal tracing levels. Size changes must retain
the model, projection and session keystroke work-counter checks.

Run `just -f apps/web/justfile build-document-session-wasm` to build glue and the
optimized binary, then report its raw/Brotli size against a 1,600,000-byte soft
Brotli ceiling. Retain measured speed gains; size reductions must not cost speed.
Start the shared streaming preload at boot when the engine flag is ON without
blocking first paint; require startup p95 <50ms and document-open p95 no slower
than the current app. Nix
uses the same size profile and Binaryen convergence pass. No SIMD override is
needed. The flag-off application continues to preload Loro; the session package
is emitted as an optional asset and initialized lazily.

Generate/check the schema with
`bun packages/collaboration/scripts/generate-session-schema.ts --check`.
The Rust ABI samples are also decoded and re-encoded by TypeScript. Deliberately
refresh them with `RECORD_SESSION_ABI=1 cargo test -p document_session_wasm -j4`.
Generate the 20 native executor traces using
`cargo run -p document_session_wasm --example record_effect_traces -j4`;
`CHECK_SESSION_TRACES=1` verifies the committed fixtures without rewriting them.
Their JS replay executes real WASM with fake socket, timers and IndexedDB and
compares the exact native callback arguments and sequence.
