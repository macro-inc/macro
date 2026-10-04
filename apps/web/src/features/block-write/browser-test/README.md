# DOCX editor browser tests

These tests run the production `DocxEditorView` in real Chromium against the
real sync service. They do not use the app shell. The compiled Rust sync
Worker runs in Miniflare (`sync-server.ts`), so they need no dev login,
backend or Docker. Pages are drawn by the native DOCX engine (Rust compiled
to wasm, `crates/docx_engine`) in a worker; build it first.

- `fixture.tsx` mounts one editor per tab with `createDocxSession`. Its
  comment threads are stored in a Loro map in place of the message service,
  and it exposes `window.docxFixture` for assertions: the engine's paragraph
  texts, the shared document's blocks and parts, comment marks, and `place`
  to put the caret in (or select) a paragraph by its first words.
- `collaboration.browser.e2e.ts` opens several people on one document and
  tests:
  - live and concurrent typing (including at the same spot), Enter, peer
    carets, bold and lists as shared marks and properties;
  - comments with highlights, kept on their text through edits;
  - the downloaded `.docx` and reloading the merged document;
  - undo and redo of one person's own edits;
  - header and footer editing in place;
  - tracked changes recorded per author, then rejected for everyone;
  - read-only viewers following along;
  - an offline merge.

```sh
(\cd services/sync-service && just worker-build)   # once, builds build/worker/shim.mjs
\cd apps/web
just ensure-docx-engine-wasm                       # builds the engine's wasm when sources changed
bunx playwright test -c src/features/block-write/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when Playwright's bundled Chromium
is not installed. `DOCX_E2E_SHOTS=<dir>` saves screenshots and the downloaded
file along the way. The fixture serves on port 3018 and must be reached as
`localhost`, because the sync Worker only accepts `http://localhost:3000-3999`
origins.

Without the sync service, `http://localhost:3018/?local` opens the fixture
document in one editor and `?local=pair` in two editors that exchange
updates directly; add `&fixture=complex-msa.docx` for the document with a
table, picture, header and footer.
