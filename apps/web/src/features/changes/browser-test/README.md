# Agent code links browser regression

From `apps/web`, run:

```sh
bunx playwright test --config src/features/changes/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an existing Chromium.
`CHANGES_TEST_PORT` overrides port 3007; the harness owns its Vite server unless
`CHANGES_TEST_EXISTING_SERVER=1` points it at one already serving that port.

The fixture mounts the real agent `Message` beside the Changes pane over an
in-memory changeset, with hosted traffic blocked. It checks that inline code
naming a changed file becomes a link that opens Changes on that file with the
line lit and scrolled into view, that a `file://` link into the agent's checkout
opens the same changed file with its range lit, and that a link to an
unchanged file opens on GitHub at the head commit.
