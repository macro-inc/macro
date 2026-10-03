# Presentation editor browser fixture

This entry mounts the real `PptxEditor` with the wasm engine in its module
worker, over decks from `crates/pptx_engine/tests/corpus`. It loads no
authentication, document storage, or product routes: saves are kept in memory
and exposed to tests. It verifies the editor and engine integration, not
storage or permissions.

From `apps/web` (build the engine first with `just ensure-pptx-engine-wasm`):

```sh
bunx vite --config src/features/block-pptx/browser-test/vite.config.ts
```

Open `http://127.0.0.1:3018/?deck=generated/kitchen-sink-financial.pptx`. The
header switches between corpus decks or opens a local `.pptx`. Query
parameters: `readonly` for a viewer, `autosave=<ms>` (`0` saves only on
demand). Test-only `window.pptxFixture`:

- `saved()` / `saves()`: bytes and count of saves;
- `engine()`: the open `PresentationEngine` (outline, render, apply…);
- `errors()` / `notices()`: messages the editor reported;
- `externalEdit(ops)`: applies `EditOp`s to the stored copy with a second
  engine instance and announces the change, as an AI `EditPresentation` call
  does in the app.

Run the browser regressions (the configuration starts or reuses the fixture):

```sh
bunx playwright test --config src/features/block-pptx/browser-test/playwright.config.ts
```

They cover rendering (thumbnails, native charts, real-world decks), typing
with undo and autosave, dragging and resizing, inserting text boxes, adding
and deleting slides, reloading after an outside edit with and without unsaved
local changes, and read-only viewing. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
when the bundled browser is not installed. Failure traces and screenshots stay
in the ignored `test-results/` folder.

## Collaboration

`collaboration.browser.e2e.ts` opens several people (each on its own
`<name>.localhost` origin) on one deck over the real sync service: the
compiled Rust sync Worker in Miniflare (`sync-server.ts`). Build the Worker
once before running it:

```sh
(\cd services/sync-service && just worker-build)
```

It covers live edits and selections, concurrent edits to one slide, slides
added at the same time, undo of only your own change, and a late joiner. With
`document`, `user`, `worker`, `socket`, and `token` query parameters the
fixture is one collaborator (`collab-fixture.tsx`); `window.pptxFixture.collab`
exposes the connection status, peers, and shared entries.
