# New conversation composer browser regressions

From `apps/web`, run:

```sh
bunx playwright test --config src/features/agents-view/browser-test/playwright.config.ts
```

Install Playwright Chromium first, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`
to an existing Chromium/Chrome executable. `AGENT_MENTION_TEST_PORT` overrides
port 3007; the harness owns and stops its Vite server.

The fixture mounts the production `NewChatPage` over a fixed roster and blocks
hosted API traffic, so it needs no backend. It picks an agent from the `@` menu
and checks that the mode follows, no mention stays in the draft, the editor
keeps focus, and the send starts that agent. On a phone it checks that an
offline agent stays listed but cannot be picked.
