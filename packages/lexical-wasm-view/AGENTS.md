# Lexical WASM view

## What it is

Production browser rendering and input over document_session_wasm. The dev shim
shares this view through EditorPort; it does not supply production model code.

## Boundaries

- The Diff applier owns mirror writes; renderers and view plugins read it.
- A successful flags=0 TextFromView may acknowledge exactly the submitted edit
  through that applier. Authoritative Rust corrections take precedence.
- Debug builds compare mirror text with Rust node text after every TextFromView.
- Keep Android timing/native deletion in events.ts and composition clearing in Rust.
- Complete cold input callbacks after Diff/IO consumption so unhandled keys reach
  lower-priority view listeners, including queued inputs.
- Send marked typing style for 200 ms and Android post-delete context through the
  selection-change input; primitive caret moves stay available without context.
- Keep lexical and @lexical packages out of the production dependency graph.
- Retarget copied DOM code from Lexical 0.45.0; preserve its MIT notice and pin.
- Keep HTML import and code highlighting off the startup path.
- Resolve text leaves through dom.ts so nested semantic wrappers remain editable.
- Match pinned link URL formatting and parsed-protocol filtering before painting href.
- Handle session effect kind 9 before painting: end native composition and suppress
  its redundant synchronous input/end events; Rust already merged the accepted text.

## Checks

- `bun run check`, `bun run test`, `bun run test:browser`
- Set LEXICAL_WASM_VIEW_TEST_PORT to reserve a private harness port on shared hosts.
- Browser tests launch their own headless Chromium; never connect to a person's
  browser or the shared CDP instance. No existing-server reuse.
- Isolate Vite and Playwright in a private user/network namespace with loopback
  enabled when host route churn causes ERR_NETWORK_CHANGED; keep checks strict.
- Build document_session_wasm before session browser tests, with TMPDIR and -j4.
- `just check`, `just pr-privacy`

## Related

S12 section 1 in the port specs; packages/collaboration/src/session for execution
and the generated ABI; packages/lexical-core for retained source node behavior.

Pass the application loading span through ViewOptions.parentSpan; mount and the
first native Initialize reconciliation stay under that span without ending it.
Dispose DOM listeners before awaiting session close; continue terminal native I/O.
