# Source slash action control

From `apps/web`, run:

```sh
VITE_ENABLE_RUST_EDITOR_MODEL=false VITE_ENABLE_DATABASES=false bunx playwright test --config src/lib/core/component/LexicalMarkdown/component/menu/ActionsMenu/browser-test/playwright.config.ts --workers=1
```

The fixture mounts the actual source markdown wrapper, action plugin, catalog
and menu with the real analytics/flag providers. It selects a default heading
and an overridden action through browser input, checking their exported node
shapes and removal of the inline query. This protects the source merge behavior
shared with the native catalog adapter; it does not execute an Android popup,
prove native InlineSearch lifecycle or admit a native application surface.

For a bundled source control, build the fixture with the application Vite
configuration, then run the same assertions against its preview:

```sh
ACTIONS_MENU_TEST_BUNDLE_DIR=/absolute/task/output VITE_ENABLE_RUST_EDITOR_MODEL=false VITE_ENABLE_DATABASES=false NODE_OPTIONS=--max-old-space-size=12288 bunx vite build --config src/lib/core/component/LexicalMarkdown/component/menu/ActionsMenu/browser-test/vite.config.ts
ACTIONS_MENU_TEST_BUNDLE_DIR=/absolute/task/output PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/absolute/path/to/chromium bunx playwright test --config src/lib/core/component/LexicalMarkdown/component/menu/ActionsMenu/browser-test/playwright.config.ts --workers=1
```

The bundle directory selects only the test server; it does not change application
feature flags. The input fixture must be built with the explicit source flag OFF.
