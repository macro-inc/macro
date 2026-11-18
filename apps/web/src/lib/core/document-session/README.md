# Native editor sessions

`just -f apps/web/justfile build-document-session-wasm` builds the native view
and headless artifact without compatibility or foreign-node features. It writes
matching glue, WASM and declarations under `wasm/`. Native/FFI/server production
graphs are checked by `check-native-editor-features`; development conformance
feature unions are not production profiles.

The explicit `build-document-session-compat-wasm` recipe enables `compat-web`
and writes its own complete artifact set under `wasm-compat/`, using a separate
Cargo target directory and feature-aware cache key. Its exact generated declarations
are copied to the type-only `@macro-inc/collaboration/session/wasm-compat` export.
The compatibility module owns those types; never add optional compatibility
methods to native types. Native build/cache reuse also checks actual WASM exports, so a previous
compatibility artifact cannot silently become the native module.

The compatibility host still requires user-facing measurements against upstream
Lexical with the full application plugin set; feature isolation is not evidence
of typing, paste, bulk, startup, document-open or bridge-budget acceptance.

`engine-selection.ts` binds `rust-editor-model` once from the environment
override or cached rollout at boot. Later rollout refreshes take effect on the
next page load so existing classes, commands and editor transactions stay on
one model. Only the document body switches engines. Titles, comment editors,
channel/chat composers, task/calendar descriptions and `StaticMarkdown` remain
upstream Lexical. `lexical` and `@lexical/*` imports always resolve to upstream
Lexical, whichever engine is selected.

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

Place `EditorEngineBoundary` directly around the components that construct
native editors (today `SessionMarkdownEditor`'s body), never around shell
chrome or route content: pages without a native editor render while the module
loads. The boundary's failure slot shows the shared load-error view and retry
action. Retrying reloads the same app-wide resource without switching to the
other engine. After readiness, `useEditorEngine().module()` returns the
initialized module synchronously. Never return a deferred stand-in for an
editor handle or add a separate readiness resource per editor host.

Compatibility classes and constants must evaluate without an initialized WASM
instance. Editor construction and updates require the ready module.

`createRustEditorSession` in `create-editor-session.ts` composes a collaborative
Macro editor from an authorized source identity, native view registry, platform
and loading span. Documents and collaborative surfaces use the same sync socket
route; their authorization adapters supply tokens from the appropriate endpoint.
Server-backed sessions always retain their actual access level.
Construction is synchronous after preload. Closing and failed-construction
cleanup drain terminal I/O asynchronously. A directly disposed view no longer receives Diff, input acknowledgements or asynchronous I/O errors. Its native observation retires at the next post-receiver output fence; the owning runtime still must close to drain I/O and release its session.

Document hosts may supply `loadCachedSnapshot` to race the same cached S3
bytes as the Source document path against native local-storage and socket
recovery. Capture the loader before installation callbacks. Submit its bytes
through the ordinary CachedS3 seed input; native owns seed ordering, WAL replay
and initialization. An unavailable cache leaves other sources running. Discard
a fetch result that arrives after owning close or view teardown. An already
accepted entry retains the executor's FIFO order, then Stop and free drain
normally. The `doc.snapshot.ingest` child span records the source, byte count
and submitted/unavailable/cancelled/error outcome; submitted is not a claim that
the seed won its race. No projection or rendered state substitutes for Initialize.


`createRustSession` (used by the readiness browser fixture) comes from the same module.
It requires the real session constructor and a raw `ViewApplier` output sink,
returns the actual executor, and allocates no DOM or native view. Normal editor
sessions retain native output with `headless=false`; headless callers may opt in.
Register JS classes and commands before calling its explicit `start()`. Access
notifications received during construction queue in order until that call. The
compat DOM adapter later binds the exact root supplied to `setRootElement`,
and root removal/rebinding preserves the same core and session. Never create a
temporary root or local model to satisfy construction.

The optional `installEditing` callback installs the surface's native UI port.
The independent `installOverlays` callback installs the document body's actual
overlay capabilities and returns `runtime.overlays`. Unimplemented renderers
remain absent; it supplies no placeholder toolbar/comment methods. The document
body installs the native checkbox pointer bridge and exterior-focus action
through this hook. Exterior focus retains the current focused-range guard,
admits `group-b.focus-end` through the real SessionPort and focuses the browser
only after command completion while the installation remains live and editable.
With `comments: true` it also installs `runtime.overlays.comments`: mark anchors
and caret mark ids from the native mirror, Source `selected` class toggling, and
mark publish/remove through `SessionPort.comment`.

The title handoff (`titleHandoff.atStart`/`prependParagraph`) admits
`group-b.focus-start`/`group-b.prepend-paragraph` the same way; `menuOpen`
reports the installed inline menus so TitleEditor can ignore arrows while one
is open. TitleEditor prefers `runtime.editing` when it is installed.
Existing `runtime.editing` consumers remain separate.

The returned runtime disposes overlays, then editing, then the view/session and
its own telemetry. A completed overlay installation is unwound if a later
installer throws; an installer must release partial resources before throwing.
Close retains one in-flight promise even when a dispose callback reenters it.
The document feature's old primitive path re-exports this shared implementation.

`mountLocalSessionView` from `@macro-inc/lexical-wasm-view` mounts a
transport-free local native view; tests and fixtures use it today, and app
composers and static views still use upstream Lexical. It disables transport, persistence and
cross-tab chatter and seeds a fresh local document before host imports. Supply
the correct native node/plugin preset; a title, calendar description and full
document do not share the same allowed nodes.

Pass the actual loaded ordinary module to the app view mount so its ordered Enter
dispatcher installs receiver guards before the native session factory runs.

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
fixture-only error boundary. The paste-preparation browser case holds the idle
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



The document host allocates its clipboard namespace through the same wrapper allocator as the source editor. Pass that exact value to both `view.namespace` and `EditorSession.createMacroWithNamespace`; cross-instance HTML fallback remains required when namespaces differ.

A host code tokenizer (`NativeCodeTokenProvider`: `loaded` runs on every code transform pass like Source `isCodeLanguageLoaded`, `tokenize` only for a loaded language) reaches `createMacroWithNamespace` only through `createRustEditorSession({ codeTokens })`, which fences it with the module's `NativeEnterDispatcher.fenceCodeTokenProvider` before construction: while it runs, every session receiver, static factory and `free()` of that module rejects before wasm-bindgen. Passing a raw provider to the constructor, or calling receiver functions cached before the dispatcher installed its guard, is unsupported. `RustMarkdownEditor` passes Source's tokenizer (`plugins/code/native-code-tokens.ts`: `@lexical/code-prism` `PrismTokenizer.$tokenize` in a private headless upstream editor), loaded in parallel with the WASM at `session.init`.

Code tokenizing stays in TypeScript by design, as HTML import does (`lexical-wasm-view` `view/html-import.ts`): Prism grammars are JavaScript regular-expression programs, and running Source's own tokenizer keeps native token nodes identical to flag OFF. The cost is that a native document session also loads upstream `lexical`, `@lexical/code-core`, `@lexical/code-prism` and `prismjs` for this bridge; the model only validates and applies the tokens it returns.
