# Flagged document session acceptance

Start an isolated stack using `docs/development/running-locally.md`, seed a
synthetic signed-in persona and markdown document, and start two frontends over
that stack with `VITE_ENABLE_RUST_EDITOR_MODEL=true` and `false` respectively.
Supply these explicit test settings:

- `EDITOR_SESSION_ON_URL` and `EDITOR_SESSION_OFF_URL`: local frontend origins.
- `EDITOR_SESSION_LOGIN_EMAIL`: synthetic local passwordless persona.
- `EDITOR_SESSION_DOCUMENT_ID`: seeded markdown document.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: own headless Chromium executable.

From `apps/web`, run
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/browser-test/playwright.config.ts`.
The test refuses nonlocal origins and blocks external HTTP/WebSocket traffic.
It launches its own browser; never attach to a person's browser.

Both variants prove no session WASM is requested at startup. Off opens the
existing editor without session assets. On opens and types, waits for the real
durable snapshot checkpoint, edits offline, closes/reopens through the resident
router, reconnects, and verifies server persistence from a fresh browser context
with no writer IndexedDB or BroadcastChannel. The development server does not
provide an offline application shell, so this test does not reload its assets
while offline. Existing core browser suites remain separately runnable.
