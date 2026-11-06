# Settings computer screen browser checks

Run from `apps/web`:

```sh
bunx playwright test --config src/features/computer-screen/browser-test/settings-provider/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for a system Chromium installation and
`SETTINGS_SCREEN_BROWSER_PORT` to override port 31479.

The fixture drives the real `SettingsComputerScreen`, its context, screen split,
screen pane, and access-request composer. Only rollout state, query transports,
screen URL resolution, and the VNC connection are scripted. No live computer
receives input, grants, or access requests. Projects cover desktop, 390px phones,
and 320px phones; Read and Resident watch, User and Owner can control on desktop,
and phones always watch. Agent request levels come from the server's View-only
choices; ordinary runtimes also expose Edit.
