# Channel composer draft browser regression

From `apps/web`, run:

```sh
bunx playwright test --config src/features/channel/Input/browser-test/playwright.config.ts
```

Install Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to an existing Chromium/Chrome executable. `CHANNEL_DRAFT_TEST_PORT` overrides
port 3006; the harness owns and stops its Vite server.

The fixture mounts the production `ChannelInput` over the app shell's providers
and blocks hosted API traffic, so it needs no backend. It types a draft with a
blank line, unmounts the composer and mounts it again over the persisted draft,
which is the round trip through internal markdown that used to drop every blank
line.
