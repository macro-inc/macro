# Channel composer browser regressions

From `apps/web`, run:

```sh
bunx playwright test --config src/features/channel/Input/browser-test/playwright.config.ts
```

Install Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to an existing Chromium/Chrome executable. `CHANNEL_DRAFT_TEST_PORT` overrides
port 3006; the harness owns and stops its Vite server.

Both fixtures mount the production `ChannelInput` over the app shell's providers
and block hosted API traffic, so they need no backend.

`draft` types a draft with a blank line, unmounts the composer and mounts it again
over the persisted draft, which is the round trip through internal markdown that
used to drop every blank line.

`universal-input` enables the composer's type offer and answers
`/universal_input/classify` and `/universal_input/extract` itself, so the pill,
the form above the composer, and the keys that open, close and submit it run
against fixed predictions. Identity is seeded into the shared query client —
`EntityProvider` supplies that client to everything below it — because the
fixture answers no auth calls. Route the property catalog by pattern, not glob:
`**/properties/definitions*` also swallows the app's own
`queries/properties/definitions.ts` module request and blanks the page.
