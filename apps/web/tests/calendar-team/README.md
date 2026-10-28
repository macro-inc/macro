# Team calendar browser verification

This harness loads the complete bundled app and intercepts auth, team, and calendar HTTP traffic with synthetic identities. It blocks nonlocal requests and websocket traffic. It does not verify the Rust service or Google permissions. Own-calendar reads use the existing REST fallback.

It uses a live clock and checks that loading placeholders disappear before capture. It checks that no surface reads teammate calendars or shows team calendar controls, that the `Team out of office` checkbox hides and restores a teammate's out-of-office chip while the sidebar keeps listing it, and exercises the Team sharing select and the account-grouped "Calendars that count as busy" list, failing if any change flashes a loading state.

Imported own point events must render compactly with a single time,
without drag/resize. Editing the point's title must omit time from its request.
Adding a Macro call to a point must show a duration error before any mutation.

From `apps/web`, with Chromium installed:

```sh
MODE=development bunx vite build -c tests/calendar-team/vite.config.ts
bunx vite preview -c tests/calendar-team/vite.config.ts --outDir /tmp/calendar-team-browser-dist --base /app --port 3037
# In another terminal:
bun build tests/calendar-team/browser.ts --target=node --packages=external --outfile=node_modules/.calendar-team-browser/browser.mjs
node node_modules/.calendar-team-browser/browser.mjs
```

Use `CHROMIUM_PATH` for an alternative binary. `CALENDAR_TEAM_BROWSER_CDP=http://127.0.0.1:9222` uses a new isolated context in an existing browser and closes only that context. `CALENDAR_TEAM_BROWSER_URL` overrides the preview origin. No existing browser contexts, sessions, or stacks are modified. Screenshots go to `/tmp/calendar-team-*.png`.
