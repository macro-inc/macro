# Share message attachments

Run from `apps/web`:

```sh
bunx playwright test --config src/lib/core/component/ForwardMessageComposer/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using an existing Chromium binary,
and `SHARE_BROWSER_PORT` if port 3097 is occupied.

The fixture mounts the production Share message composer and editor over a
controlled uploader. It exercises real clipboard paste, file input, drop events,
removal, failure recovery, and serialized inline-image payloads on desktop,
phone, and tablet. Requests to hosted services are blocked. It does not test a
live backend upload or delivery; `ForwardToChannel.test.tsx` checks the share
send boundary and its upload guard. Screenshots are saved with test results.
