# Lexical WASM view

Browser rendering and input over `document_session_wasm`. `mountSessionView`
connects an initialized WASM module, host session options, node views and an
editable root to the existing collaboration I/O executor. Applications supply
session identity, transport URLs, authorization and telemetry.

`mountLocalSessionView` uses the same native model, view and executor for local
composers and read-only content. It starts and seeds an independent document
with transport, durability and cross-tab chatter disabled. The host loads WASM
and supplies the session factory for its node/plugin preset and browser platform.
Local read-only views retain native edit access for host content imports while
the view is non-editable; this never changes collaborative authorization.
Close the returned runtime when its owning surface is disposed. Closing twice
shares one completion and releases the native view before draining the executor.
Construction is synchronous once WASM is ready: builders may mount on a detached
root and later connect that same root without replacing its native session.

`@macro-inc/lexical-wasm-view/compat` exports the compatibility DOM adapter and
its runtime contract. It binds only the root supplied through setRootElement;
reconcile then publish mutations before core update listeners. Its current oracle
tests use the upstream model and do not establish Rust bridge compatibility.

The flat Diff applier owns immutable mirror records. A zero TextFromView result
acknowledges exactly the submitted DOM text through that applier. Other results
carry authoritative Rust text or full repair. Development builds compare mirror
text with Rust after each submission; production typing uses no per-node calls.

`createBuiltinRegistry` supplies core and rich views. `registerMacroViews` adds
all application node mounts and accepts the host's Solid component registry.
Decorators retain component identity by node key. Missing views fail explicitly.
Application factory/preset and plugin wiring live in the later app integration.

HTML import loads on paste/drop and includes source-compatible Macro node conversions
selected by registered type names. Host importDOM overrides remain available. Code highlighting is an optional lazy module at
`view/code-highlight`, using Prism and CSS highlights without model mutations.
Call `enableCodeHighlighting(view)` from the lazy editor path. The host styles `::highlight(code-<namespace>-<token>)`. Views sharing a namespace aggregate their highlight ranges by owner. Remote
cursor points are resolved by Rust; overlays measure only in animation frames
after apply and follow scroll/resize. Table DOM helpers are exported for host
resize/picker UI.

View algorithms are retargeted from Lexical 0.45.0 commit
`0cfcc169296723e07de2396cd42ea3434b5b79ed`; upstream MIT license is included.
Production modules import neither Lexical nor the development shim.

Build `document_session_wasm` before tests. Run `bun run check`, `bun run test`,
and `bun run test:browser` from this directory. Chromium tests launch a separate
browser; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using a system browser.
`local-session.browser.e2e.ts` exercises independent drafts, native undo/redo,
read-only host import, repeated close and absence of sync/storage effects.

`view.clipboard.paste` reads every MIME entry before loading HTML converters;
it rejects a stale asynchronous result after selection or document changes.
Drag lifecycle commands expose browser facts and internal keys. Application
`INTERNAL_DROP_COMMAND` listeners dispatch atomic Rust move commands; those
application plugins are wired in WP-58. Unhandled internal moves keep the source.
Provide `parentSpan` to connect open/paste/reconcile phases to the host flow;
WASM module loading/preloading remains the host's existing responsibility.

Text views preserve upstream semantic wrappers and resolve the nested text leaf
for DOM-first edits and selection. Stored link URLs use the pinned upstream
formatter and protocol allowlist before assigning browser attributes.

Android Chrome native backspace uses a typed composition clear and a bounded
30 ms re-clear timer. Selection updates carry recent collapsed typing style
(200 ms), DOM resolution and post-delete restoration facts when needed. Routed
modifier deletes obtain a browser layout target before sending the command.

On Linux hosts with route churn, isolate both test processes without changing
their assertions or retry policy:

```sh
unshare --user --map-root-user --net -- sh -c 'ip link set lo up && bun run test:browser'
```
