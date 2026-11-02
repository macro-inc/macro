# Agent session browser checks

Run the existing notification, mention and transcript checks with:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
bunx playwright test --config src/features/block-agent/browser-test/playwright.config.ts
```

For session-open performance, use a regular owned Vite frontend, an authorized
local session and histories created through the local session API. Keep login
state, session IDs, raw logs and capture artifacts outside the repository. Never
seed a shared database or reuse another person's session to build a workload.

From `apps/web`:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
SESSION_STATE=/tmp/test-session.json SESSION_ID=<owned-session-id> \
SESSION_MESSAGES=500 SESSION_OUTPUT=/tmp/session-open-long \
node src/features/block-agent/browser-test/session-open.mjs
```

`SESSION_BASE` defaults to `https://localhost:3008`. Warm the routes/dependencies
before capturing. `SESSION_READY_SELECTOR` overrides the initial Home split
readiness selector (`[data-split-id]`). The runner uses 1440x900 Chrome with 4x CPU
throttling, a 15-second initial settle and five opens separated by Home. The first
open has a fresh browser cache and samples CPU; subsequent opens can use the
persisted GraphQL log. Compare corresponding cache/profiler states. Use
`SESSION_SAMPLES` to change the count.

Results contain existing `agent.session.load.*` measures, navigation admission
time, decoded response bytes/timing, mounted virtual rows, end-scroll geometry,
main-thread CDP durations and main-thread heap after forced GC. The historical
`fold` phase includes listener projection; the nested `projection` measure splits
out synchronous snapshot publication to surface stores. Do not add these
inclusive durations together. Render/paint measures start at session acquisition;
subtract navigation admission separately to include lazy view startup. Virtual
lists render the visible tail, not every message in the folded history.

`SESSION_MESSAGES` optionally verifies that the last row mounts and overflowing
history is pinned to the end. Captures fail on page errors, reloads, failed loads
or missing final rows. Each sample saves a screenshot, the first saves a CPU
profile, and the completed run saves JSON. The 500 ms post-paint observation and
screenshots are outside the load/paint measures; CDP task totals include driver
observation/GC overhead. Main-thread heap does not measure WASM worker memory.
