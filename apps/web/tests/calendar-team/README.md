# Team calendar browser verification

This harness loads the complete bundled app and intercepts auth, team, and calendar HTTP traffic with synthetic identities. It blocks nonlocal requests and websocket traffic. It does not verify the Rust service or Google permissions. Own-calendar reads use the existing REST fallback; team projections use their production REST query, mapping, and UI paths.

It uses a live clock and checks that loading placeholders disappear and event chips are opaque and in the viewport before capture. It exercises sharing and availability settings, read-only event details, revocation, membership loss, a viewer without any connected Google account, and automatic data/popover expiry while refresh requests hang. The expiry check waits up to 65 seconds with the browser clock running normally.

From `apps/web`, with Chromium installed:

```sh
MODE=development bunx vite build -c tests/calendar-team/vite.config.ts
bunx vite preview -c tests/calendar-team/vite.config.ts --outDir /tmp/calendar-team-browser-dist --base /app --port 3037
# In another terminal:
bun build tests/calendar-team/browser.ts --target=node --packages=external --outfile=node_modules/.calendar-team-browser/browser.mjs
node node_modules/.calendar-team-browser/browser.mjs
```

Use `CHROMIUM_PATH` for an alternative binary. `CALENDAR_TEAM_BROWSER_CDP=http://127.0.0.1:9222` uses a new isolated context in an existing browser and closes only that context. `CALENDAR_TEAM_BROWSER_URL` overrides the preview origin. No existing browser contexts, sessions, or stacks are modified. Screenshots go to `/tmp/calendar-team-*.png`.
