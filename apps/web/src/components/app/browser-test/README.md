# App startup browser smoke

Run the complete `/app` development entry with Solid refresh enabled. This
catches import cycles whose component bindings are safe as production function
declarations but hit the temporal dead zone as refresh-transformed constants.
Entity model and query consumers import their defining leaves; UI selectors
import the specific extractors they render, avoiding eager namespace evaluation.
The anonymous browser blocks external traffic and all API reads; no backend or
login is required. Both initial navigation and reload must show sign-in without
any `pageerror`.

Run from `apps/web`:

```sh
bunx playwright test --config src/components/app/browser-test/playwright.config.ts
```

`APP_SMOKE_BROWSER_PORT` selects the isolated regular Vite server's port.
`APP_SMOKE_BASE_URL` uses an existing development server instead.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects a locally installed Chrome.
The existing `just test-signup-browser` CI gate includes this smoke before the
focused auth/onboarding fixtures, which exercise smaller module graphs.

The Drive admission case invokes the real lazy route preloader after the
anonymous app mounts. It permits URL-only asset metadata but rejects Loro runtime/WASM admission, catching helper
imports that pull a full detail renderer into the Drive shell. Detail preloading/rendering
owns editor runtime; warming the Drive shell must not evaluate its renderers.

The Markdown preparation case invokes its real block loader and requires one Loro
WASM load while Welcome remains mounted, no editor appears, and APIs stay blocked.
It distinguishes safe code/runtime preparation from editor/document construction.
