# Native editor sessions

`engine-selection.ts` binds `rust-editor-model` once from the environment
override or cached rollout at boot. Later rollout refreshes take effect on the
next page load so existing classes, commands and editor transactions stay on
one model. The resolver in `apps/web/scripts/lexical-engine-switch.ts` forwards
the existing `lexical` and `@lexical/*` imports to the selected package without
changing caller imports. `lexical-upstream:<specifier>` bypasses that resolver
for compatibility algorithms; their own Lexical imports remain switched.

`EditorEngineProvider` owns the app-wide readiness resource under the rollout
provider. When the cached choice is on, it starts the binary fetch and
glue import in parallel while the shell paints; initialization compiles the
binary response with streaming WASM. Before readiness resolves, it waits for two
animation frames and an idle callback (or a task when idle callbacks are
unavailable), then calls the real module's idempotent `prepareMacroPaste` export.
The shell can paint before the linkifier compiles; editors cannot accept a first
paste before preparation completes. Its work is traced under `paste.prepare`.
Flag off makes no native module request.
Failed loading clears the shared initialization promise so a later open can retry.

Place `EditorEngineBoundary` inside the shell above subtrees that construct
editors. It observes this same resource, leaving shell chrome outside the gate.
Primary shell content supplies the boundary's failure slot with the shared
load-error view and retry action. Overlay groups stay held on failure. Retrying
reloads the same app-wide resource without switching to the other engine.
After readiness, `useEditorEngine().module()` returns the initialized module
synchronously. Never return a deferred stand-in for an editor handle or add a
separate readiness resource per editor host.

Compatibility classes and constants must evaluate without an initialized WASM
instance. Editor construction and updates require the ready module. Resolver
checks preserve exact upstream object identity when off and reject incomplete
selected exports instead of quietly returning undefined API values.

`createRustEditorSession` in `create-editor-session.ts` composes a collaborative
Macro editor from an authorized source identity, native view registry, platform
and loading span. Documents and collaborative surfaces use the same sync socket
route; their authorization adapters supply tokens from the appropriate endpoint.
Server-backed sessions always retain their actual access level.
Construction is synchronous after preload. Closing and failed-construction
cleanup drain terminal I/O asynchronously.

Compatibility document factories use `createRustSession` from the same module.
It requires the real session constructor and a raw `ViewApplier` output sink,
returns the actual executor, and allocates no DOM or native view. Normal editor
sessions retain native output with `headless=false`; headless callers may opt in.
Register JS classes and commands before calling its explicit `start()`. Access
notifications received during construction queue in order until that call. The
compat DOM adapter later binds the exact root supplied to `setRootElement`,
and root removal/rebinding preserves the same core and session. Never create a
temporary root or local model to satisfy construction.

The optional `installEditing` callback installs the surface's native UI port.
The returned runtime disposes that port before the view and session and closes
its own telemetry. The document feature's old primitive path re-exports this
shared implementation.

Local composers and static views use `mountLocalSessionView` from
`@macro-inc/lexical-wasm-view` instead. It disables transport, persistence and
cross-tab chatter and seeds a fresh local document before host imports. Supply
the correct native node/plugin preset; a title, calendar description and full
document do not share the same allowed nodes.

The native view mount functions construct synchronously after the module is
ready. Their explicit root ownership is separate from the compatibility API,
whose `createEditor` starts with no root. Closing drains terminal I/O.

Checks: `bunx vitest run --project core src/lib/core/document-session`
and `bunx playwright test --config src/lib/core/document-session/browser-test/playwright.config.ts`
from `apps/web`. The browser fixture uses the real production WASM and readiness
provider with a deterministic flag source. It checks shell visibility during a
held binary fetch, flag-off network behavior, a synchronous real durable
attachment with authorization refused, session-only deferred start and close,
and failed-load retry without a
fixture-only error boundary. Resolver checks cover both bundling and the test
runner's SSR module pipeline. The paste-preparation browser case holds the idle
callback, observes the actual generated export calling the real WASM, and checks
that first contentful paint precedes preparation and editor readiness.

The readiness browser harness runs Chromium, Firefox, and WebKit by default.
Use `--project=chromium` for a focused iteration. Host environments may supply
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`, `PLAYWRIGHT_FIREFOX_EXECUTABLE_PATH`, and
`PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH`; use isolated headless browser processes.
When an engine lacks Paint Timing entries, the preparation proof captures its
compositor while idle is held before releasing preparation.

Engine timing uses the normal User Timing API: `macro.editor.engine.selected`,
`macro.editor.engine.preload-start`, and `macro.editor.engine.ready`. Readiness
includes initialization and real paste preparation. Upstream emits ready without
a preload mark; its engine-preload duration is not applicable. The existing boot
flow emits `macro.boot.interactive` at its actual completion time with an outcome;
only success is usable as an interactive timing.

Synchronous compatibility transactions use the returned executor’s `runSync`
method. It rejects reentrant, queued or closing work before admission; accepted
calls apply native output and invoke completion before returning. Session-only
factory bindings borrow host lifetime; unbinding a root does not close the host.
