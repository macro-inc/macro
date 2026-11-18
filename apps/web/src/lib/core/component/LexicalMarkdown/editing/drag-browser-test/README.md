# Block drag handle checks

This fixture uses the real Source editor/plugins and the same shared handle UI
as the native overlay installer. Native inputs run through an actual local Macro
session, SessionPort and the supplied generated WASM module. No Source context
or Lexical node is supplied to native UI. The two imported native inputs are raw
JSON captured through Source's Save state control.

From `apps/web`, with the checkout's matched five-file native package present:

```sh
NODE_OPTIONS=--max-old-space-size=16384 GOMAXPROCS=2 \
  DRAG_SOURCE_INPUTS=/tmp/drag-source-inputs \
  bunx playwright test --config src/lib/core/component/LexicalMarkdown/editing/drag-browser-test/playwright.config.ts

NODE_OPTIONS=--max-old-space-size=16384 GOMAXPROCS=2 DRAG_ENGINE=native \
  bunx playwright test --config src/lib/core/component/LexicalMarkdown/editing/drag-browser-test/playwright.config.ts
```

`DRAG_ENGINE=native` runs the unchanged eight drag cases against the native
entry. Source additionally captures paragraph/list inputs. Each run owns its
build and preview; `DRAG_SKIP_BUILD=true` explicitly reuses the emitted output
with a fresh preview process. Set `DRAG_OVERLAYS_PORT`, `DRAG_TEST_REPORT` and
`DRAG_TEST_OUTPUT` for independent runs. The Chromium executable override is
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Controls use real mouse HTML5 drag events, target geometry, undo/redo,
save/reset/reopen, nested checklist groups and read-only transitions. Readiness
waits for the actual fixture's settled initial import; DOM assertions use
Playwright's awaited locator checks. A mouse drag in a touch viewport is still
a mouse drag. This cohort does not establish a touch drag gesture, a click
block-actions menu, document transport/durability, or an installed-app result.

`?second` mounts a second editor beside the body with the app's drag handling:
for Source the block handle and drag-insert plugins over a listener container,
for native (`native.html`) the body drop owner `createNativeEditorDrop`. Both
render the real insertion indicator. `cross-editor-drag.browser.e2e.ts` runs for
both engines: a handle drop into the second editor fires, is consumed with its
indicator hidden, and changes neither document. The native `group-b` browser
test in `packages/lexical-wasm-view` checks the same outcome without the app
drop owner.

The fixture keeps real providers and rewrites only analytics script/pixel
origins to local inert assets in its build configuration. Every other external
HTTP/WebSocket attempt fails the test. Static source maps must be checked for
the exact compiled Lexical/code-core bytes before counting Source evidence;
installed package integrity alone is insufficient. Preserve raw saved native
and Source JSON separately: their export defaults differ.
