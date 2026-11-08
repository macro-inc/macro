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

The default registry includes core and portable rich nodes. The application
registry remains a later integration through the native registry builder.
Markdown queries reuse lexical_markdown; HTML and clipboard use portable native
exporters. No browser or storage APIs live in this crate.

Run `just -f apps/web/justfile build-document-session-wasm` to build glue and the
optimized binary, then enforce the 8 MB raw gate and provisional D5 cap of
1,130,000 Brotli bytes. The cap may tighten; WP-59 measures real startup cost. Nix
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
