# Spreadsheet browser fixture

This isolated entry mounts the real `SpreadsheetEditor` with its local Loro
source, IronCalc calculation worker, Excel import/export worker, and shared Macro
styles and controls. It does not load authentication, hosted document APIs, or
product routes. Reloading resets the workbook. This verifies the editor and
worker integration, not network collaboration or persistence.

From `apps/web`, start the fixture on loopback port 3017:

```sh
bunx vite --config src/features/block-spreadsheet/browser-test/vite.config.ts
```

Open `http://127.0.0.1:3017/`. The seeded `B4` should calculate to `30`.
Use `?readonly` for a viewer. Test-only `window.spreadsheetFixture.snapshot()`
returns the current workbook and `setReadonly(boolean)` simulates permission
changes without replacing the editor.
The fixture applies the app's coarse-pointer touch attribute and keyboard viewport
handler, including the `--dvh` height used by the app shell.

Run the browser regressions (the configuration starts or reuses the fixture):

```sh
bunx playwright test --config src/features/block-spreadsheet/browser-test/playwright.config.ts
```

The tests exercise pointer formula references, autocomplete, menu/dialog focus,
sheet creation and rename, cross-sheet calculation, permission changes, and
XLSX import/export through native browser file APIs. They also verify atomic
import undo/redo, restoring a distant selection across tabs, and formatting
without a calculation-status flash or grid remount. Further regressions cover
immediate typing after adding or duplicating sheets, returning focus from toolbar
fields, range formatting/sorting, and footer controls down to a 360-pixel panel.
The imported workbook was
created independently with openpyxl; the exported file is reopened using ExcelJS
to check formula caches and workbook structure. Failure traces and screenshots
stay in this directory's ignored `test-results/` folder.

Install the Playwright Chromium runtime if needed (`bunx playwright install
chromium`) or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing Chromium
binary. The fixture and its configuration are separate from the production app
entry points.

To verify bundled workers as well, build the fixture with its Vite config and
serve that output with Vite preview. Set `SPREADSHEET_BROWSER_BASE_URL` to the
preview URL when running Playwright; the suite then uses that server without
starting the development fixture.

Run the separate phone regressions without repeating desktop tests:

```sh
bunx playwright test --config src/features/block-spreadsheet/browser-test/playwright.mobile.config.ts
```

The `android-chrome` (Pixel 7) and `iphone-webkit` (iPhone 13) projects exercise
touch taps, edit/apply/cancel, formula suggestions, selection/reference handles,
formatting menus, sheet creation/rename, find, viewer permissions, and the narrow
footer. Landscape and reduced viewport checks cover layout with less vertical
space. Chromium swipes and handle drags use CDP's trusted touch input, including
native scrolling and pointer cancellation; ribbon swipes must not format cells.
WebKit exposes touch taps but no trusted touch-drag API, so its handle tests use a
mouse pointer after touch selection. They do not verify native iOS drag gestures.
Reduced viewports do not simulate the operating system's keyboard; verify keyboard
resizing, keyboard retention during suggestion/reference picking, and pinch/scroll
behavior in iOS Simulator and on physical devices.

Manual verification in iOS 26.5 Safari on an iPhone 17 Pro simulator covered the
real software keyboard, the footer staying above it, touch autocomplete, and
tapping a formula reference while keeping the input focused. Native handle drags
extended a selection from A2 to B4 and a formula reference from B2 to B3; applying
`=SUM(B2:B3)` returned 30. Native vertical swipes scrolled without changing the
selection. Physical-device testing, including iPhone compatibility mouse events,
is still separate from these simulator checks.

Install matching browser runtimes with `bunx playwright install chromium webkit`.
Existing compatible runtimes can be selected with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH`.
`SPREADSHEET_BROWSER_BASE_URL` also works for the mobile configuration and allows
both suites to use the same bundled fixture server.

## Live collaboration regression

`collaboration.browser.e2e.ts` boots the compiled Rust sync Worker in an isolated
Miniflare instance and connects three independent browser contexts through the
production sync socket, source, spreadsheet session, and editor. Build
`services/sync-service/build/worker/shim.mjs` before running it. It uses only local
test JWTs and temporary storage; no hosted accounts or documents are touched.
The test verifies edit delivery, named/color-separated range overlays and their
geometry, idle presence beyond the ten-second TTL, sheet-local cursors, reconnect
recovery and departing-user cleanup. It saves a visual capture to
`/tmp/spreadsheet-live-collaboration.png`. This does not verify hosted authentication
or permission-token refresh. The ordinary fixture remains local-only unless the
explicit test document/socket query parameters are supplied.
