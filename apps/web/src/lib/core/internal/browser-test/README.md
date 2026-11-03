# Contact inspector browser regression

Run from `apps/web`:

```sh
bunx playwright test --config src/lib/core/internal/browser-test/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using system Chromium and
`CONTACT_BROWSER_PORT` to choose a free port (default 3096).

The desktop and phone fixtures exercise the production contact reader, TanStack
window, and inspector. Cache/network stand-ins synthesize bounded windows from a
100k directory without constructing a full fixture array. Tests cover replacing
browse pages, target IDs, search, account switches, empty server-budget pages,
offline partial data, query-history collection, and layout overflow.

`/?filters` mounts the production Calendar organizer/attendee filters, bounded
query state and exact selection resolver over stand-in transport/profile services.
It covers selected names outside the page, unknown/custom emails, broader server
matches, page replacement, input focus and arrow navigation on desktop/phone.

`/?list-filters=drive` and `/?list-filters=notes` mount the production Drive/CRM
filter models and desktop/mobile controls over bounded contact stand-ins. They
check lazy loading, Me, persisted unavailable IDs, broader-than-substring matches,
page replacement and viewport reset, checkbox preservation, and Only without
changing unrelated facets. They do not instantiate Tasks' full AI-filter catalog.

`/?recipient-ranking` mounts the real recipient selector over small supplied
options and stand-in identity/profile services. It verifies that exact addresses
win over recent word matches and Enter preserves selection across searches.
It checks deterministic scoring for explicit scoped options.

`/?recipient-directory` mounts the real recipient selector and its per-picker
contact window over a virtual 100k source. Desktop/phone tests cover lazy opening,
replacement pages by keyboard or touch, empty continuations, a late match, custom
selection preservation and input focus. The source unit regression additionally
checks twenty replacements, close/reopen reset and query-history collection.
New message/channel, call, routine-template and sharing pickers use this source;
email and AI-planner pools still require their separate migration.

This is UI/adapter coverage, not a WASM memory measurement or live-backend trace.
Real Turso/OPFS hydration/search coverage lives in `crates/client/cache-turso`.
