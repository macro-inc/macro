# Contact inspector browser regression

Run from `apps/web`:

```sh
bunx playwright test --config src/lib/core/internal/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using system Chromium and
`CONTACT_BROWSER_PORT` to choose a free port (default 3096).

The desktop and phone fixtures exercise the production contact reader, TanStack
window, and inspector. Cache/network stand-ins synthesize bounded windows from a
100k directory without constructing a full fixture array. Tests cover replacing
browse pages, target IDs, search, account switches, empty server-budget pages,
offline partial data, query-history collection, and layout overflow.

This is UI/adapter coverage, not a WASM memory measurement or live-backend trace.
Real Turso/OPFS hydration/search coverage lives in `crates/client/cache-turso`.
