# Native Database action browser check

This fixture compares the real native session/slash menu/Database controller
with the upstream wrapper, action plugin, menu and decorator renderer.
It uses the real native decorator projectors and Await component; card props
are recorded without mounting the network-backed preview. Only the
create-database service is replaced with a held response; mention
tracking is disabled in the action context. No backend is contacted. The test
checks menu availability, the create request and the resulting anchored card.
The four browser cases check insertion and the create-failure toast on both
engines; the upstream page must make no WASM request. `trackMention` is not
exercised in the browser. Real-session cancellation and tracking order are covered in
`../native-database.test.ts`.

Build the matched ordinary WASM with `just build-document-session-wasm` from
`apps/web`. Start this directory's Vite config on port 43829, then run
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/editing/database-browser-test/playwright.config.ts`
from `apps/web`, through the project build slot when required. Use an owned
headless Chromium with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. Test output and
report paths can be overridden with `DATABASE_TEST_OUTPUT` and
`DATABASE_TEST_REPORT`.

The version-admission page additionally seeds a real newer-version Loro snapshot
into a native session before readiness. Edit, read and comment cases compare
both engines: Source warning, visible read-only text, typing rejected and trusted
selection/copy preserved. The native page uses the same error-code mapper as the
document host. This isolated page has no
backend or production document context; the mounted-host tests separately cover
readiness, error-state wiring and disposal.
