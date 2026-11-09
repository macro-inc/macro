# Native editor sessions

`just -f apps/web/justfile build-document-session-wasm` builds the native view
and headless artifact without compatibility or foreign-node features. It writes
matching glue, WASM and declarations under `wasm/`. Native/FFI/server production
graphs are checked by `check-native-editor-features`; development conformance
feature unions are not production profiles.

The explicit `build-document-session-compat-wasm` recipe enables `compat-web`
and writes its own complete artifact set under `wasm-compat/`, using a separate
Cargo target directory and feature-aware cache key. Its declarations belong to
the compatibility module; never add optional compatibility methods to native
types. Native build/cache reuse also checks actual WASM exports, so a previous
compatibility artifact cannot silently become the native module.

Native feature isolation replaces the former feature-on/off 5% timing gate.
The compatibility host still requires user-facing measurements against upstream
Lexical with the full application plugin set; feature isolation is not evidence
of typing, paste, bulk, startup, document-open or bridge-budget acceptance.

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


`native-android.ts` is the typed Tauri client for Android accounts and surfaces.
It requires the frozen Rust engine choice and Android runtime, serializes account
creation, and invalidates callbacks as soon as an account is replaced or closed.
Register the event sink before creating a surface; readiness events carry the
actual native model generation used by actions and queries. Closing waits for
in-flight creation and the native Stopped acknowledgement. Authorization uses the
same `SessionAuthorization` source and `session-socket-url.ts` route as WASM;
editor editability and content interaction remain independent permissions.
This client does not change application surface admission. Native menus,
decorators, draft handoff and fixture/device acceptance remain prerequisites.

A native surface's `mount()` returns a separate view lease with `layout()`,
`focus()` and `unmount()`. Each lease has a monotonic mount generation independent
of the retained document session. Queued callbacks recheck both lifetimes;
cleanup from an older mount cannot remove its replacement. Unmount also clears
pending placement/focus configuration so late model readiness cannot recreate
an abandoned view. Remount through the same surface to retain document/history.


Native menu events include their mount/model/invocation/query identity and actual
registered node types. Answer through `menuRows()` and `menuCommit()` on that
surface; both discard replaced queries before queued IPC. A late close cannot
clear a newer query. Providers retain typed identity/payloads, loaded counts,
loading/error state and pagination; native rows never carry executable callbacks.
Menu selection IPC is traced without query text or row labels.
`NativeMentionSources` mounts the actual `MentionsMenu` providers and controller
without its DOM presentation or keyboard listeners. It retains source ranking,
category expansion, pagination, loading/errors and typed insertion handlers.
Replies must match the current query, surface and selection attempt after every
async boundary; a rejected or unavailable row releases the native pending pick.
The source label helper supplies native row text without reducing insertion
payloads to labels. Complete source menu lifecycle parity and application mounting
remain prerequisites for admission.

`NativeEmojiSources` uses the same lazy Unicode catalog, ranking and usage store
as the application emoji menu, with its 200 ms lowercase query debounce. Rows
carry canonical Unicode choices through the typed menu bridge. Catalog failures,
query/surface replacement and failed commits cannot leave an active stale pick.
This adapter does not supply the model InlineSearch lifecycle or admit a surface.
