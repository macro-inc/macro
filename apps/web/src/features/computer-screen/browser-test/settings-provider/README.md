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

The separate `keyboard.html` fixture runs the real noVNC client against a tiny
RFB peer routed inside Playwright. It checks complete URL key packets, isolation
from app capture shortcuts, toolbar tab focus, and restoring app shortcuts outside
the screen. Watch-only desktop and phone cases must not focus remote input or
send keyboard packets. Its WebSocket wrapper only exposes inherited public API
descriptors for noVNC's shallow transport inspection; keyboard behavior is real.
