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
binary response with streaming WASM. Flag off makes no native module request.
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
Construction is synchronous after preload, so a compatibility editor factory
can attach to this exact runtime before its first update. It never needs a
temporary local model. Closing and failed-construction cleanup still drain
terminal I/O asynchronously.

The optional `installEditing` callback installs the surface's native UI port.
The returned runtime disposes that port before the view and session and closes
its own telemetry. The document feature's old primitive path re-exports this
shared implementation.

Local composers and static views use `mountLocalSessionView` from
`@macro-inc/lexical-wasm-view` instead. It disables transport, persistence and
cross-tab chatter and seeds a fresh local document before host imports. Supply
the correct native node/plugin preset; a title, calendar description and full
document do not share the same allowed nodes.

Both view mount functions construct and seed synchronously after the module is
ready. Builders may supply a detached root, then connect that exact root from
their shared shell. Closing remains asynchronous so terminal native I/O drains.

Checks: `bunx vitest run --project core src/lib/core/document-session`
and `bunx playwright test --config src/lib/core/document-session/browser-test/playwright.config.ts`
from `apps/web`. The browser fixture uses the real production WASM and readiness
provider with a deterministic flag source. It checks shell visibility during a
held binary fetch, flag-off network behavior, a synchronous real durable
attachment with authorization refused, and failed-load retry without a
fixture-only error boundary. Resolver checks cover both bundling and the test
runner's SSR module pipeline.
