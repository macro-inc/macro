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
backend. The test answers both image proxies itself.

The link preview regression runs on desktop and phone. Previews come with the
message, so each message's cards must already be in place when its text first
appears: a card added later grows the row under the channel's virtual list.
Cards follow the stored order, a message whose previews are not computed yet
shows none, each card fits the message column, and clicking one opens its page.
Which links get previews is decided on the server; that rule is tested in
`packages/lexical-core/tests/link-previews.test.ts`.
