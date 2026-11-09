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
- The Diff applier owns mirror writes; renderers and view plugins read it.
- A successful flags=0 TextFromView may acknowledge exactly the submitted edit
  through that applier. Authoritative Rust corrections take precedence.
- Resolve terminal element carets before the managed line break; it is DOM scaffolding, not a model child.
- Cache authoritative selection feedback while honoring skip-dom-selection commit tags before DOM writes.
- Debug builds compare mirror text with Rust node text after every TextFromView.
- Keep Android timing/native deletion in events.ts and composition clearing in Rust.
- Carry ephemeral clipboard host facts through registerFacts; release them after native admission or cancellation, and deliver typed plugin host requests through onPluginEvent after Diff.
- Route application special keys with registerKeyRoute and one EditorApplication input; preserve Rust KeyDown/Key command priorities and ordinary view listener tie checks. Set preventDefault=false for layout-dependent routes that leave unhandled movement to the browser, and consume native prevention plus short-circuiting after-listeners.
- Complete cold input callbacks after Diff/IO consumption so unhandled keys reach
  lower-priority view listeners, including queued inputs.
- Send marked typing style for 200 ms and Android post-delete context through the
  selection-change input; primitive caret moves stay available without context.
- Preserve the production lexical/@lexical compatibility API over Rust; native optimizations must retain existing JS node hooks and plugins.
- Retarget copied DOM code from Lexical 0.45.0; preserve its MIT notice and pin.
- Keep HTML import and code highlighting off the startup path.
- Use mountLocalSessionView for local composers and read-only views; keep transport, durability and chatter disabled and seed before importing content.
- Construct views synchronously only after the app's shared engine resource is ready; reconnect the same detached root and keep close asynchronous.
- Resolve text leaves through dom.ts so nested semantic wrappers remain editable.
- Match pinned link URL formatting and parsed-protocol filtering before painting href.
- Handle session effect kind 9 before painting: end native composition and suppress
  its redundant synchronous input/end events; Rust already merged the accepted text.

Keep table pointer selection tied to its pointer id; cancel it on pointercancel or loss of editability, and leave touch selection to the long-press adapter.

Keep drag source validity tied to documentRevision; selection-only commits do not invalidate a drag. Lazy clipboard imports retain the broader revision guard.

## Checks

- `bun run check`, `bun run test`, `bun run test:browser`
- `bun run test:browser group-b.browser.e2e.ts` checks native block moves, cross-editor copy, touch swipe, atomic drop paste, nested-editor ownership, one-snapshot table resize/restore and primary-touch long-press selection.
- `heading-enter.browser.e2e.ts` compares literal heading-shortcut typing, Enter, and successive DOM-first characters against upstream with the app native input configuration; assert model children and model/DOM caret paths, without installing extra key routes.
- Set LEXICAL_WASM_VIEW_TEST_PORT to reserve a private harness port on shared hosts.
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
Dispose DOM listeners before awaiting session close; continue terminal native I/O.

The static paired-input regression runs on Chromium, Firefox and WebKit with
`bunx playwright test --config browser-test/input-parity.playwright.config.ts`.
It builds its own fixture bundle before serving it; set each browser's
`PLAYWRIGHT_<BROWSER>_EXECUTABLE_PATH` independently on hosts with wrapped browsers.
Set `EDITOR_INPUT_PARITY_DIST` and `EDITOR_INPUT_PARITY_REPORT` for isolated output.
