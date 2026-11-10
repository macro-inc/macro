# Lexical WASM view

## What it is

Production browser rendering and input over document_session_wasm. The dev shim
shares this view through EditorPort; it does not supply production model code.

The `./compat` export provides the lazy exact-root DOM adapter; read
[src/compat/AGENTS.md](src/compat/AGENTS.md) before changing it. Its upstream-model
tests are separate from Rust-backed production compatibility acceptance.

## Boundaries

- Capture ViewOptions.owner before asynchronous mounts so native decorator roots inherit application providers; dispose each decorator root when its keyed node is removed.
- Install common Macro element views once; register group-owned decorators through registerMacroDecoratorViews and keep full registerMacroViews completeness checks strict.
- Let NodeView.createDecoratorHost preserve application mount wrappers; Macro uses the Source Portal div and mount class while portable views retain their default host.
- Keep opted-in decoratorRevision metadata outside JSON; unchanged revisions preserve captured props, and changed revisions dispose and remount the component inside its retained Portal host, matching Source.
- Set the HTML-render mount display before its mount class to preserve the Source block wrapper and Chromium-observed attribute order; verify other engines against their own captures.
- Project Await's local class from node state: only boolean false disables it; missing, null and nonboolean values use the Source local default.
- The Diff applier owns mirror writes; renderers and view plugins read it.
- Assemble wholly created subtrees off DOM in the existing slot-walk order; keep reused-node moves and trees with DOM-slot hooks on the ordinary path and resolve dynamic slot boundaries when attaching, before selection and commit notifications.
- Attach one synchronous view before subscribing to authorization; apply each native output immediately, never buffer pre-mount packets, and retire view observation once before disposal and terminal close.
- Admit renderer-derived normalization through inputIfSessionEdit so current native access is checked inside the queued turn; local editability and initial configuration never grant authority.
- A successful flags=0 TextFromView may acknowledge exactly the submitted edit
  through that applier. Authoritative Rust corrections take precedence.
- Resolve terminal element carets before the managed line break; it is DOM scaffolding, not a model child.
- Read managed terminators through managedLineBreak and the dynamic slot.before getter; preserve BR identity and resolve deferred insertion anchors after cleanup.
- Mark successful own DOM range writes with the module-wide pinned selection-change guard; consume only after anchor-owner routing, before point normalization, preserving boundary and post-delete processing.
- Cache authoritative selection feedback while honoring skip-dom-selection commit tags before DOM writes.
- Debug builds compare mirror text with Rust node text after every TextFromView.
- Keep Android timing/native deletion in events.ts and composition clearing in Rust.
- Admit an actual first DOM range before Click listeners, route Click through Rust with KeepModel, and let Image/HR components select their nodes instead of selecting every decorator.
- Carry ephemeral clipboard host facts through registerFacts; release them after native admission or cancellation, and deliver typed plugin host requests through onPluginEvent after Diff.
- Capture window Shift state at paste invocation and send typed intent on additive input tag 10 only when true; preserve legacy tag 4 for ordinary paste/drop and retain MIME precedence across lazy HTML import.
- Route application special keys with registerKeyRoute and one EditorApplication input; preserve Rust KeyDown/Key command priorities and ordinary view listener tie checks. Set preventDefault=false for layout-dependent routes that leave unhandled movement to the browser, and consume native prevention plus short-circuiting after-listeners.
- Complete cold input callbacks after Diff/IO consumption so unhandled keys reach
  lower-priority view listeners, including queued inputs.
- Send marked typing style for 200 ms and Android post-delete context through the
  selection-change input; primitive caret moves stay available without context.
- Preserve the production lexical/@lexical compatibility API over Rust; native optimizations must retain existing JS node hooks and plugins.
- Retarget copied DOM code from Lexical 0.45.0; preserve its MIT notice and pin.
- Keep HTML import and code highlighting off the startup path.
- Publish dirty code block ranges into retained native Highlight sets; do not rebuild other blocks' ranges on an edit.
- Use CommitInfo sparse mutations for native geometry and grid invalidation; measure dirty comment blocks and ResizeObserver-moved anchors, and rebuild table rows only while rowspan carries change.
- Read maintained Mirror.isEmpty through EditorView.isEmpty for blank paragraph/watermark status; do not scan root children on commits.
- Match pinned importDOM conversion and append policies before emitting drafts; resolve artificial inline wrappers before native insertion and preserve decorator-owned payload children.
- Validate serialized HTML-render attributes even when a shadow template supplies the content, preserving Source conversion errors.
- Use mountLocalSessionView for local composers and read-only views; keep transport, durability and chatter disabled and seed before importing content.
- Construct native helper views synchronously after the shared engine resource is ready and keep close asynchronous; the compat adapter binds the actual setRootElement root on the same core/session.
- Manage terminal placeholder line breaks only on block elements; inline links and marks keep their original children.

- Resolve text leaves through dom.ts so nested semantic wrappers remain editable.
- Keep native keys in the namespace-scoped DOM property and WeakMap; omit new empty class/style attributes while preserving upstream class/style clearing behavior.
- Resolve code aliases through theme.code so Macro custom-code retains the Source block layout and margins.
- Match pinned link URL formatting and parsed-protocol filtering before painting href.
- Handle session effect kind 9 before painting: end native composition and suppress
  its redundant synchronous input/end events; Rust already merged the accepted text.

Keep table pointer selection tied to its pointer id; cancel it on pointercancel or loss of editability, and leave touch selection to the long-press adapter.

Keep drag source validity tied to documentRevision; selection-only commits do not invalidate a drag. Lazy clipboard imports retain the broader revision guard.

- Opt into ordered Enter only with the actual generated native module; preserve Source Set registration and per-priority snapshots, reject ordinary receivers before bindgen and Port queue admission during callbacks, and use issued scoped operations without querying published caches.
- Drain exact failure-ordinal output and I/O before rethrowing the original callback value; detach immediately on callback close, retain current snapshot functions through the enclosing native return, and defer ordinary cleanup to its post-call fence.

## Checks

- Preserve the previous model selection when projecting non-range selections: clear only an owned DOM range after a non-null model selection, retaining readonly, nested-editor and captured-input selections.
- Register actual external editor roots from their root-listener lifecycle through `view/editor-roots`, releasing the listener and current registration on disposal; keep stale cleanup from removing a newer owner.
- `selection-projection.test.ts` compares real Source and native sessions for owned, foreign, initial-null, nested and readonly DOM ranges; image-click browser parity also requires the actual native Click dispatch.

- `selection-change.test.ts` and `selection-change.browser.e2e.ts` preserve the first-event interior-range skip, ordinary next-event admission, boundary/post-delete conditions and actual nested Source root ownership.
- `bun run check`, `bun run test`, `bun run test:browser`
- `new-subtrees.test.ts` checks connected insertion work, literal HTML, managed slot boundaries and retained DOM/caret identity across native block splits.
- `performance.browser.e2e.ts` exercises the real facade exporter and shared browser observer over native paste/reconcile/scroll, current-task long-task delivery, content-free attributes and exact model Undo restoration.
- `commit-work.browser.e2e.ts` counts real mark measurements and native Highlight range mutations with 8/128 comment/table/code groups, and checks downstream anchors after a block resizes; table observer tests cover merged rows and 8/256-row edit work.
- `bun run test:browser group-b.browser.e2e.ts` checks native block moves, cross-editor copy, touch swipe, atomic drop paste, nested-editor ownership, one-snapshot table resize/restore and primary-touch long-press selection.
- `heading-enter.browser.e2e.ts` compares literal heading-shortcut typing, Enter, and successive DOM-first characters against upstream with the app native input configuration; assert model children and model/DOM caret paths, without installing extra key routes.
- `history-keyboard.browser.e2e.ts` loads the same initial paragraph into both actual engines and clears their real histories before trusted typing, Ctrl-Z and both redo shortcuts; assert DOM, model JSON and model/DOM caret restoration. The three-engine input-parity configuration includes it. Native code-subtree cases repeat deletion and recreation twice and require exact durable IDs, raw JSON and caret offsets without normalization.
- Let synthetic decorator fixtures own explicitly declared reserved dimensions; assert their component box and keep Macro media outer wrappers plain, matching the source renderer.
- Compare paste against the app plugin configuration, including trailingParagraphPlugin, and the external Markdown export; keep raw model and DOM evidence even when text matches.
- Verify resolved Source dependency bytes against the pinned packages and use fresh owned Vite/Vitest caches before parity runs; source-file pins alone do not prove the executable module graph is pristine.
- Treat managed-browser paste timings as diagnostic; performance acceptance uses stock browsers, and Linux WebKit is an engine proxy.
- Require a committed WAL write, the matching server acknowledgement and exact warm/fresh reload content before treating a large paste as persisted; visibility or a saved snapshot alone is insufficient.
- Set LEXICAL_WASM_VIEW_TEST_PORT to reserve a private harness port on shared hosts.
- Set LEXICAL_WASM_VIEW_TEST_CACHE_DIR to a fresh owned directory for cold-cache browser checks; the harness prebundles its scheduled utility before loading fixtures.
- Run browser/performance coverage in owned Chromium, Firefox and WebKit instances; never connect to a person's browser or shared CDP. No existing-server reuse.
- Match upstream layout; do not add content-visibility or intrinsic containment without three-browser pixel/scroll parity and a measured speed benefit.
- Assert saved table column widths on the declared col styles and rendered cell geometry; WebKit exposes no layout box for col elements.


- Isolate Vite and Playwright in a private user/network namespace with loopback
  enabled when host route churn causes ERR_NETWORK_CHANGED; keep checks strict.
- Build document_session_wasm before session browser tests, with TMPDIR=/home/wolf/tmp and -j2.
- `just check`, `just pr-privacy`

## Related

S12 section 1 in the port specs; packages/collaboration/src/session for execution
and the generated ABI; packages/lexical-core for retained source node behavior.

Pass the application loading span through ViewOptions.parentSpan; mount and the
first native Initialize reconciliation stay under that span without ending it.
Keep editor performance spans in the `perf` cohort, use the host's shared browser observer, and bound scroll frame sampling; export counts and sizes without document content.
Dispose DOM listeners before awaiting session close; continue terminal native I/O.

The static paired-input regression runs on Chromium, Firefox and WebKit with
`bunx playwright test --config browser-test/input-parity.playwright.config.ts`.
It builds its own fixture bundle before serving it; set each browser's
`PLAYWRIGHT_<BROWSER>_EXECUTABLE_PATH` independently on hosts with wrapped browsers.
Set `EDITOR_INPUT_PARITY_DIST` and `EDITOR_INPUT_PARITY_REPORT` for isolated output.

Admit the current DOM range before native copy/cut export when selectionchange has not arrived; update the submitted-selection cache, preserve explicit node/table selections and never export from a stale collapsed model range.

Use the configured HTML importer for foreign namespaces, malformed JSON or non-array clipboard nodes; preserve matching-namespace JSON priority.

Pair submitted DOM selections with their acknowledged model selection when deduplicating events; a programmatic model move must not suppress a returning DOM caret.
