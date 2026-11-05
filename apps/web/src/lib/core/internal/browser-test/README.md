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

`/?calendar-guests=edit` and `/?calendar-guests=add` mount the real guest editor,
property selector and directory-window lifecycle over a virtual 100k source.
Desktop/phone cases cover the tail of each window, page replacement/scroll reset,
late and broader source matches, case-insensitive existing-guest exclusions,
selected-name preservation, fast custom-address entry and address/display-name
collisions. Closing/reopening retains selections without a directory catalog.
Event-details permissions and invitation/forwarding remain covered separately in
`features/calendar-view/browser-test`.

`/?list-filters=drive` and `/?list-filters=notes` mount the production Drive/CRM
filter models and desktop/mobile controls over bounded contact stand-ins. They
check lazy loading, Me, persisted unavailable IDs, broader-than-substring matches,
page replacement and viewport reset, checkbox preservation, and Only without
changing unrelated facets.

`/?task-filters` mounts the real Tasks filter adapter, desktop dropdown and mobile
drawer with bounded suggestion sources and selected-label reads. It preserves
semantic Me separately from fixed self, unknown IDs and other groups through
paging/search/Only. The desktop AI input uses the real planner/reference reader
with a synthetic completion and exact-name endpoint, including empty continuations.
Cases cover late matches, structured name boundaries, ambiguity, address aliases,
offline/retry and late replies after filter edits, navigation or replacement login.
Mobile retains its existing manual-only UI. Saved-view action chrome and task loading
are stand-ins; this fixture does not claim saved-view dialog or live model coverage.

`/?sql-people` uses the real SQL wasm compiler, live query controller, read-only
HTTP client and generated response validator. Playwright supplies the bounded endpoint
responses; tests cover routing without local people reads, write refusal before RPC,
missing endpoint failure, foreign-viewer rejection and session replacement. The local
fixture account is reactive. This is client composition coverage, not a live DSS or
PostgreSQL test; the native SQL suite separately exercises the real 100k database path.

`/?linear-import` mounts the real importer, CSV conversion, batched reference reader
and single-user property picker. It reuses the virtual 100k property window fixture;
contact transport, auth scope and task/history writes are stand-ins. Desktop/phone
cases cover exact/ambiguous/comma-bearing names, address aliases, explicit Unassigned
during late evidence and reconnect, file replacement, late file reads, paging/search,
single selection and stopping after replacement login. Unit coverage separately
checks 500-label serialization, storage-generation changes and the real task creation
helper's guarded local publication. No live imports or backend task writes are claimed.

`/?onboarding-contacts` mounts the real onboarding team step and bounded teammate
query source over synthetic membership pages. It follows five empty continuations,
stops after six eligible emails, excludes self/domain aliases, and keeps manual form
edits when the domain source refreshes. A declined domain issues no contact query.
Both desktop and phone are covered; auth scope and team writes are fixture adapters,
not a live authorization or invitation-delivery test.

`/?task-list-labels` mounts the real inline checklist bar and scoped label source
with supplied document/task data and persistence. It resolves 501 referenced IDs
in 500/1 batches, keeps malformed IDs local, filters by a late resolved name, and
releases old labels after reference replacement without clearing saved filter IDs.
It does not exercise Lexical reconciliation or task loading, which are unchanged.

`/?soup-filters=home` and `/?soup-filters=tasks` mount the real general Soup filter
menus, mobile drawer, refinements hook and consolidated chips. Predicate/query
stores and selected-label lookup are real; scope, transport and unrelated app
services are stand-ins. Pure entity predicates are re-exported without the app UI
barrel. Legacy full-directory hooks throw. Tests cover zero closed-menu browse
reads, explicit labels, Unassigned, unknown IDs, paging, query replacement, Only,
reopening at page one and restoring the Owned constraint when a creator is cleared.

`/?channel-recipients=modal` and `/?channel-recipients=panel` mount the real
channel invitation dialog and participant add control over a bounded virtual
100k source. Desktop/phone cases cover pre-limit roster exclusions, page/search
selection retention, a member joining while selected, external invitations and
whole-team selection. Picker portals remain inside their owning modal. The source
unit suite additionally covers oversized rosters and cursor resets when exclusions
beyond the native budget change.

`/?soup-filters=crm` adds the real CRM filter adapter and collection-chip bridge.
Its Owner header remains team-scoped; selected labels and paged personal chip
suggestions use separate readers. Desktop/phone tests retain No owner, unknown IDs
and unrelated Stage values through paging/search/Only. The chip pagination test
also catches focus scrolling that starts before virtual viewport measurement and
later snaps the user's wheel scroll back to the first selected item.

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
main email fields also use it, with composition coverage in
`features/email-compose/browser-test/recipient-directory.app.e2e.ts`.

`/?sql-people` mounts the real SQL compiler/controller over the production worker
host and Turso/WASM/OPFS, with 1,001 synthetically hydrated contacts. Desktop/phone
tests run fresh queries offline, reject writes/missing local capability, and fence
replacement sessions while a native reply is held. Neither SQL server endpoint is
used. Storage tests separately exercise 100k contacts plus self and persisted reopen.

This is synthetic UI/storage coverage, not whole-app memory acceptance, physical
mobile hardware or a live-backend trace. Further Turso/OPFS coverage lives in
`crates/client/cache-turso`.
