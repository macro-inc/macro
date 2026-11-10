# Channel message browser regressions

From `apps/web`, run:

```sh
bunx playwright test --config src/features/channel/Message/browser-test/playwright.config.ts
```

Install Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to an existing Chromium/Chrome executable. `CHANNEL_MESSAGE_TEST_PORT`
overrides port 3051; the harness owns and stops its Vite server.

On a machine with many network interfaces, run it in its own network namespace
(`unshare -rn`, then `ip link set lo up`, or `bwrap --dev-bind / / --unshare-net`):
Chromium otherwise aborts module requests with `ERR_NETWORK_CHANGED` and the
page never renders. On a machine without system fonts, point `FONTCONFIG_FILE`
at a fontconfig file that names any font: text is otherwise laid out at zero
height and the check that a message's text is visible fails.

The fixture mounts the production `ChannelMessage` over the app shell's
providers with synthetic messages and blocks hosted API traffic, so it needs no
backend. The test answers both image proxies itself.

The link preview regression runs on desktop and phone. Previews come with the
message, so each message's cards must already be in place when its text first
appears: a card added later grows the row under the channel's virtual list.
Cards follow the stored order, a message whose previews are not computed yet
shows none, a long description shows three lines, each card fits the message
column, and clicking a card's title opens its page.

The fixture's viewer sent all but one message. Their cards carry the remove
button (always shown on touch, on hover with a pointer); the other sender's do
not. Removing asks first, Cancel keeps the cards, Remove takes every card of
that message and no other, and Shift removes without asking. The fixture
empties the previews itself where the app would ask the server.
Which links get previews is decided on the server; that rule is tested in
`packages/lexical-core/tests/link-previews.test.ts`.
