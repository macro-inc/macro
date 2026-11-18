# Quick Access scale measurement

Run the existing standalone Vite frontend, then from `apps/web`:

```sh
URL=https://localhost:3009 OUT=/tmp/command-scale \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/google-chrome-stable \
node src/features/command/browser-test/measure.mjs
```

No login or backend is required. Each size uses a new browser context and a
random cache namespace, with 1k/5k/20k synthetic notes written through the real
worker host. Closing Chrome releases the contexts. Seed fields are complete for
the history projection; missing materialized rows fail the run. Page errors also
fail the run. Freeze source and restart the owned frontend between revisions;
do not combine samples interrupted by dependency reloads.

At 4× CDP CPU throttle the runner records:

- Synthetic candidate construction and cache seed time separately.
- Cold search plus selected-record materialization, then 54 warm searches.
- 126 local filter + final Cmd+K ranking calls over 18 short prefixes.
- A separate CPU profile of those prefixes, outside timed samples.
- Main-thread heap before/after forced GC and outgoing worker/port message kinds.

JSON and CPU profiles go to `OUT`. Heap deltas include the fixture's candidate
objects and main-thread host, not worker/WASM memory or isolated app-index memory.
Construction time is not QuickAccessSource activation. Message counts cover web
worker transport, not desktop native IPC. JS CPU timings are not input-to-paint.
The profile and synthetic candidate stress test intentionally exercise a full
local corpus: the cache-enabled app normally ranks a bounded selection in JS.

Compare revisions with identical corpora, throttle, and queries. For causal scorer
comparisons, counterbalance revision order and hold wall-clock timestamps fixed;
compare complete result ordering outside the timed section. Mixed entities,
aliases, comma queries, dynamic labels, people priority and boosts are covered by
`freshSort.test.ts` and `rank-command-search-items.test.ts`.

The engine's `quick-access-v1` policy and JS `NAME_MATCH_RANKING` are different.
These timings do not establish ranking parity or justify replacing final contextual
ranking with the engine's existing order. The app already searches the complete
cache there, materializes up to 500 hits, then combines local commands and people.
