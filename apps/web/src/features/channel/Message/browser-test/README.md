# Channel message browser regressions

From `apps/web`, run:

```sh
bunx playwright test --config src/features/channel/Message/browser-test/playwright.config.ts
```

Install Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to an existing Chromium/Chrome executable. `CHANNEL_MESSAGE_TEST_PORT`
overrides port 3051; the harness owns and stops its Vite server.

The fixture mounts the production `ChannelMessage` over the app shell's
providers with synthetic messages and blocks hosted API traffic, so it needs no
backend. The test answers the unfurl service and both image proxies itself.

The link preview regression runs on desktop and phone. A message shows one
card per linked page, in the order the text links them, with the page's site,
title, description, and image. A page linked twice gets one card, a page with
no metadata gets none, and a Macro app link stays a plain link. The card fits
the message column, and clicking it opens the page.
