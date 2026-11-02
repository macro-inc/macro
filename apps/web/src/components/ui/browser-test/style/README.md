# Navigation style cost

Run against an owned regular Vite frontend and an authorized test session. Warm
all target routes first so dependency optimization does not reload the capture.
The runner only navigates; it does not sign in, change backend data or control
services. Keep session files and raw traces outside the repository.

From `apps/web`:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
STYLE_STATE=/tmp/test-session.json STYLE_OUTPUT=/tmp/style-normal \
node src/components/ui/browser-test/style/navigation.mjs

PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
STYLE_STATE=/tmp/test-session.json STYLE_OUTPUT=/tmp/style-selectors \
STYLE_SELECTORS=1 node src/components/ui/browser-test/style/navigation.mjs
```

`STYLE_BASE` defaults to `https://localhost:3008`. The initial Home split must
render before the 15-second startup settle; `STYLE_READY_SELECTOR` overrides
`[data-split-id]`. Chrome uses 4x CPU throttling and a 1440x900 viewport. Each
Drive/Tasks/Home/Mail navigation has a 2.5-second observation window. Captures
fail on page errors or reloads, and browsers close in `finally`.

The normal pass reports Performance-domain recalc/count/task deltas and trace
UpdateLayoutTree durations and element counts per navigation. Counts include
repeated calculations of an element, not unique DOM nodes. The diagnostic pass
adds the requested timeline/invalidation/Blink debug categories, SelectorStats
elapsed time, match attempts, successful matches and fast rejects. It also
reports invalidation reasons and high-ancestor attribute mutations. Selector
statistics substantially slow style computation; use the normal pass for timing
comparisons and the diagnostic pass for attribution. Compare identical modes.

To summarize an existing trace without launching a browser:

```sh
node src/components/ui/browser-test/style/navigation.mjs /tmp/style-normal/trace.json
```

The backend-free native-style fixture exercises the same platform stylesheet
loader and shared controls in web, Android and emulated native iOS paint states:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
bunx playwright test --config src/components/app/mobile/browser-test/playwright.config.ts native-style.browser.e2e.ts
```

Its screenshots can also be captured through the regular dev server at
`/src/components/app/mobile/browser-test/native-style.html?platform=ios&theme=light`.
Use `web`/`android` and `light`/`dark` for the other material states. This checks
browser paint and loading ownership, not a rebuilt native application's startup.
