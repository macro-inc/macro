# Static entity collection profile

This page renders 1,000 real `ListEntity` rows, half documents and half pull
requests with compacting pills. It supplies the static metadata provider and
anonymous app contexts. Empty PR links keep linked-session queries disabled.
The fixture rejects a browser with a login hint; use a fresh context.

Run the regular web dev server on port 3009 (`PORT=3009 bun run dev`). The
fixture uses that server's real module/WASM configuration. It needs no backend.
From `apps/web`:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
LIST_OUTPUT=/tmp/runtime-long-list \
node src/features/entity/browser-test/measure.mjs
```

`LIST_URL` overrides the default HTTPS URL on port 3009. The tool blocks
unexpected API requests, including same-origin proxies, and fails on page errors,
reloads, missing rows, or wheel input that did not scroll. It runs one fresh
browser at a time and closes each in `finally`.

Each default/`--disable-gpu` capture uses 4× CDP CPU throttling: 10 seconds idle,
40 wheel steps, then 80 pointer moves across visible rows. Results include
Performance-domain task/style/layout deltas, bounded timer/rAF/long-frame counts,
raw paint/raster/compositor traces and viewport screenshots. Missing legacy
`CompositeLayers` or `GPUTask` events do not establish zero compositor/GPU work.
Use Node for this Playwright runner; the Bun process close path can stall between
browser launches.

This deliberately mounts every row without virtualization. Its CPU numbers are
a stress baseline, not representative of a production Soup viewport. Keep
virtualization and application providers out of performance conclusions drawn
from this collection. Use authenticated application profiles for those paths.

## Row creation and updates

`row-cost.mjs` uses the same real components with `?benchmark&count=200`,
including store-backed models, selection checkboxes and shared Button actions. From `apps/web`:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome \
ROW_OUTPUT=/tmp/entity-row-cost \
node src/features/entity/browser-test/row-cost.mjs
```

`ROW_URL` overrides the default HTTPS URL on port 3008. Use the regular dev
server and a fresh anonymous browser. No login or backend is required; the
runner fails on API requests, reloads during capture or browser errors. It warms the component/variant
paths, then records five rounds of mounting 200 rows, toggling selection,
renaming models, reconciling new snapshots by id, and disposal. Updates must
preserve row, checkbox and action DOM identity, update the displayed model,
and propagate selection to every checkbox. Synchronous action time excludes the
runner's identity checks; ScriptDuration and TaskDuration include two animation
frames after each action. Divide 200 by mount time in milliseconds for rows/ms.

A separate pass samples allocated bytes with CDP HeapProfiler at a 16 KiB
sampling interval, including allocations collected during that action. These
are statistical byte estimates, not allocation counts or retained heap sizes;
they and the Performance deltas include driver validation.
A final diagnostic pass writes a CPU profile for each action; profiler overhead
is excluded from the five timing rounds. Results also contain element classes
and a viewport screenshot for before/after appearance comparisons. Run captures
sequentially on the same browser, viewport and CPU settings; host contention
can affect elapsed times. This fixture isolates row work, not full-app routing.
