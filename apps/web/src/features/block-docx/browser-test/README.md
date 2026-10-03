# DOCX editor browser tests

These tests run the production `DocxEditorView` in real Chromium against the
real sync service. They do not use the app shell. The compiled Rust sync
Worker runs in Miniflare (`sync-server.ts`), so they need no dev login,
backend or Docker.

- `fixture.tsx` mounts one editor per tab with `createDocxSession`. Its
  comment threads are stored in a Loro map in place of the message service,
  and it exposes `window.docxFixture` for assertions.
- `collaboration.browser.e2e.ts` opens several people on one document and
  tests:
  - live and concurrent edits, formatting and lists;
  - read-only viewers and header edits;
  - an offline merge;
  - comments, including table cells;
  - the downloaded `.docx`.

```sh
(\cd services/sync-service && just worker-build)   # once, builds build/worker/shim.mjs
\cd apps/web
bunx playwright test -c src/features/block-docx/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when Playwright's bundled Chromium
is not installed. The fixture serves on port 3018 and must be reached as
`localhost`, because the sync Worker only accepts `http://localhost:3000-3999`
origins.
