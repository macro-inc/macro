# Lexical WASM view

Browser rendering and input over `document_session_wasm`. `mountSessionView`
connects an initialized WASM module, host session options, node views and an
editable root to the existing collaboration I/O executor. Applications supply
session identity, transport URLs, authorization and telemetry.

The flat Diff applier owns immutable mirror records. A zero TextFromView result
acknowledges exactly the submitted DOM text through that applier. Other results
carry authoritative Rust text or full repair. Development builds compare mirror
text with Rust after each submission; production typing uses no per-node calls.

`createBuiltinRegistry` supplies core and rich views. `registerMacroViews` adds
all application node mounts and accepts the host's Solid component registry.
Decorators retain component identity by node key. Missing views fail explicitly.
Application factory/preset and plugin wiring live in the later app integration.

HTML import loads on paste/drop. Code highlighting is an optional lazy module at
`view/code-highlight`, using Prism and CSS highlights without model mutations.
Call `enableCodeHighlighting(view)` from the lazy editor path. The host styles `::highlight(code-<namespace>-<token>)`. Views sharing a namespace aggregate their highlight ranges by owner. Remote cursor points are resolved by Rust; overlays measure only
in animation frames after apply and follow scroll/resize. Table DOM helpers are exported for host resize/picker UI.

View algorithms are retargeted from Lexical 0.45.0 commit
`0cfcc169296723e07de2396cd42ea3434b5b79ed`; upstream MIT license is included.
Production modules import neither Lexical nor the development shim.

Build `document_session_wasm` before tests. Run `bun run check`, `bun run test`,
and `bun run test:browser` from this directory. Chromium tests launch a separate
browser; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using a system browser.

`view.clipboard.paste` reads every MIME entry before loading HTML converters;
it rejects a stale asynchronous result after selection or document changes.
Drag lifecycle commands expose browser facts and internal keys. Application
`INTERNAL_DROP_COMMAND` listeners dispatch atomic Rust move commands; those
application plugins are wired in WP-58. Unhandled internal moves keep the source.
Provide `parentSpan` to connect open/paste/reconcile phases to the host flow;
WASM module loading/preloading remains the host's existing responsibility.
