## Development Commands

- Use `bun` as the package manager and script runner (`bun run build`, `bunx tsc`).
- `bun run test`: run tests 
- `bun run test` keeps a module cache in `.cache/vitest-modules` that keeps resolved import paths across a rename: delete that directory when tests fail with `Cannot find module` naming a file's old path.
- `bun run check`: check generated entity catalogs, cache contracts, TypeScript, and Biome; `bun run check-entity-icons` runs the catalog guard and generator regression tests.
- Forward `CacheHost.people` through the app's retiring host, resolving the current host on each call even for captured methods; retired reads return unsupported and context writes reject rather than acknowledge discarded publication.
- `CacheHost.people` contracts come from cache-core models: `bun run gen-cache-people-schema --rust` regenerates Rust JSON plus Zod/types; `--check --rust` verifies both. `bun run check` verifies JSON-to-frontend generation, while cache-core tests verify Rust-to-JSON drift. Missing native person commands mean unsupported, never permission to issue an unscoped write.
- `bun run lint`: lint with biome 
- `bun run format`: format changes with biome 
- `bun run knip`: to check for dead code
- Run Linux native cache-plugin tests from the repository root with `nix develop .#tauri-linux --command cargo test --manifest-path apps/web/tauri/Cargo.toml -p graphql_cache_plugin`; the [Tauri platform shell](../../docs/development/running-locally.md) supplies the required desktop libraries.
- Refresh `nix-support/node_modules-hashes.json` for Linux and Darwin when dependency manifests, the lockfile, or dependency patches change.
- `bun run lint:oxlint` (repository root): type-aware oxlint. `typescript/no-floating-promises` is an error with no suppressions and `ignoreVoid: false` (FE-13), enforced in `just check` and CI; start detached work with `fireAndForget` from `@core/util/fireAndForget`, not `void`. Plain `oxlint` without `--type-aware` skips that rule silently. The ast-grep rule `ts-no-expression-void` covers `() => void p()`, which the lint can't see.
- Email and calendar against the real email services and the Gmail and Outlook
  emulators, in a built bundle in Chromium: `just email-e2e-browser` from the
  repository root (`tests/email-e2e/README.md`). `just email-e2e-full-stack`
  runs its tests tagged `@any-stack` or `@full-stack` against a local stack
  instance, through the real gateway and sign-in; it clears the sign-up
  counter in that instance's Redis (README, "The full-stack tier"). Add a test there for an email
  bug only the whole path can decide; one component's logic stays in its
  feature's `browser-test/` suite.
- Email rendering is isolated in `packages/email-renderer` at the repository root. Run `just test-email-rendering` for its Node and Chromium suites. Add fixtures under `packages/email-renderer/tests/fixtures`, run `just test-email-rendering-update`, and review changed images. These are renderer tests, not inbox e2e.
- Supported browsers are the `browserslist` in `package.json`. Safari and iOS
  16.4 is the oldest WebKit the app starts on: startup code, including
  `@pierre/diffs`, evaluates regex lookbehind. `vite.base.ts` builds to it,
  and the ast-grep rules `ts-browser-floor-apis` and `tsx-browser-floor-apis`
  ban APIs that turned out to be newer; add one there when it bites, or raise
  the floor.
- The app does not register a service worker. Keep `public/sw.js` as a retirement
  endpoint for existing installations; see the [startup bundle rule](../../.agents/rules/web/startup-bundle.md).
  Loro uses async WASM loading and HTML preloads independently of service workers.
- Web asset publication and cache headers are covered by
  [web-app delivery](../../infra/stacks/web-app/README.md); its publisher tests
  are backend-free, and its Pulumi tests must not run real staging/cloud commands.

## Account-scoped source queries

Treat CRM access changes as rare session transitions. Detect them from response
hints, CRM 403s and one `/crm/member-access` read on boot, focus and reconnect;
ordinary HTTP requests, subscriptions and local cache reads never wait for proof.
A hint that keeps differing from the recorded policy backs off: the wait doubles,
up to five minutes, after each check that fails or does not converge, counted
from the end of that check, and resets when the server sends a hint that agrees
or the session changes. A response without a hint agrees with nothing and resets
nothing.
On web startup without a mirror or owner snapshot, an extra short proof can open
CRM UI before storage is ready; only the post-baseline proof may commit policy.
Fence this early evidence by login, host and every owner observation, including
mismatches. Native retains its baseline gate because independently persisted
Soup pages can restore before owner readiness.
Install the cache host before request producers mount, but run its bounded
initialization in the background; Root and first render never await storage or
the owner handshake. Keep the host's phase deadlines and classified startup
failures; an extra owner deadline can interrupt valid retries and permanently
block the preserved draft queue. Read account, policy and generation from the
profile's localStorage mirror only as a startup hint; update it only from validated owner
observations. Missing or unreadable hints send an explicit nonmatching UUID,
never an omitted generation. A first non-denied owner without a mirror initializes
stamps while keeping existing query observers, rows, menus and persisted snapshots,
including on upgrades. Do not cancel or refetch active TanStack reads; urql rereads
only queries whose copied writes the owner rejects, preserving visible rows during
that background recovery. Dispatch rejected-write recovery inside the exchange
so queued cache rereads cannot replace or suppress its network request. A denied
or incomplete owner and known account/policy
changes still retire visible and
persisted content. Preserve captured stamps through
initialization waits and queued settlement. An unchanged ready proof without
failed cleanup never refetches. With the same account and policy,
a stale generation hint changes only new write stamps: keep in-memory responses
and recover rejected copied writes with fresh reads of their own queries. A
changed account or policy retires visible content normally. An empty account or
policy in a mirror at the owner's generation is not a change: within one
generation the owner only fills them, by the first bind and the first proof that
is not a denial, and issues a new generation for anything else. Compare a denied
owner exactly, whatever the mirror leaves empty. Mirrors may lag
across windows and never grant admission or replace the owner's fresh generation
after reset. On web, a ready allowed hint for the signed-in account may open CRM
UI before the owner arrives. A matching durable denial closes entry points
immediately; mismatching or missing hints keep the workspace pending until the
early server proof or normal owner baseline answers.
Keep `crm-access-authority.ts` as the policy state machine and
`crm-access-cache.ts` as detection and visible/persisted retirement glue.
The urql browser suite covers open row menus across fresh, upgrade and allowed
startup baselines, plus clearing for denied and different-account owners.

Fence all response content with one owner-issued generation. Capture it before
HTTP or subscription dispatch and retain it through decoding and cache writes;
never stamp already-fetched data with a newer generation. Every content write
(query, hydration, queued command, calendar commit, people update, contact
reconciliation) takes that captured generation as a required argument; a host
supplies its observed generation only for reads and for removals, which carry no
fetched content. `cacheRequestStamp` is the one place that decides this for the
worker host and the worker: a request kind it does not list must carry its
captured stamp. Compare it under the shared native owner lock or browser worker
before writing. Discard old query
results and subscription frames and refetch active queries once per transition.
Do not classify GraphQL fields or REST routes for admission. Preserve socket
frame generations through payload helpers and keep differently stamped batches
separate; never replace their stamp when the payload reaches a local consumer.

Recover a superseded in-flight Block or Drive detail load once from its source identity after
local retirement settles; reacquire metadata and credentials instead of replaying
a presigned URL or preload token. Do not reload an already-open editor on every
transition. Check the captured generation again at resource publication; disposal,
a newer load or a second superseded attempt ends that recovery. Keep bundle
invalidation in the query adapter, supplied to Drive's load gate as a capability.
Fence storage response chunks and body decoders with the same generation. Other
origins keep their native stream: their decoders (`json()`, `text()`, `blob()`
and the like) are checked after decoding, and code that reads `response.body`
itself checks the generation where it publishes. Do not let a post-transition
preview join or settle an older pending batch.
Clear decoded service-helper caches on real session transitions, preserving them
on matching startup baselines; a late error may remove only its own cache entry.
Release PDF proxies discarded before publication without taking ownership from a
mounted viewer.

Write the durable denied policy before selective CRM retirement and resume an
interrupted retirement before serving cached content. Preserve email thread
persistence for allowed or pending members; exclude and retire it only on a
proven denial. Initial allowed/team-less proofs preserve offline records and the
existing generation. Keep the account fence independently of access policy.
Retire all TanStack memory snapshots on permission changes. If disk pruning
fails, unpause live queries and refetch while keeping the affected persistence
scope quarantined against restore and writes until a later prune succeeds.
While access is denied, or the startup mirror says so and this page has no
recorded policy yet, restore and save nothing but the identity snapshot: any
family can hold what was fetched before the denial, and another window can write
its copy after this profile was pruned. A durable denial is found again on every
start. A start that began under that exact denial therefore retires nothing and
only sweeps excluded entries from disk; any other start retires what it restored.
Read the access state untracked in a persistence predicate: cache events run
inside the computation that caused them.

Keep mutation outcomes and authored queue state through retirement. Stale queued
commits settle identities without copied content, projections or link recipes;
the draft journal receives the actual server result before that discard. Keep
fresh server-query revalidation descriptors with authored commands so stripped
parent-link recipes can repair their current data before the next edit. Capture
a new generation only for a new HTTP attempt, not a confirmed local settlement
retry. Preserve the original generation of copied optimistic input. Wait only
for affected publications before returning a committed mutation, including the
ones a link repair's own write changed; unrelated reads must not hold its notice
open.

Keep initial CRM access pending until proof succeeds or bounded retries fail;
then show the existing retry state and retry on reconnect. Retry only stale
proof generations or network failures, once, with a short second timeout.
Preserve the last proven state across transient failure; show denial and tear
down CRM dialogs only on proven denial. A proven denial the owner cannot record
still retires this page's snapshots once. A denial holds for the owner and
generation it was proven against or recorded as: a committed grant or a newer
generation of that owner supersedes it, so a regrant another window commits
reopens every window, while a replacement owner that still records access does
not. Gate the admin switch
with the server's
remote `enable-crm-member-access-changes` flag, never denial enforcement.
Use `crmAccessAllowed` for navigation and create entry points, and
`crmAccessAuthority.allowed` for record data and `CrmContext.canAccess`; pending
or failed proofs keep entry points visible while workspace content shows its
loading or retry state. Preserve the team-less join-team empty state. Exercise
the real workspace and shell in `features/crm/browser-test/member-access`, with
synthetic records and the privacy preview adapters, rather than duplicating its
permission gate in the fixture.

Keep personal privacy controls available without CRM access. Preserve authored
drafts and queue variables independently of optional cached enrichment. Derive
whole-list team-view mutations from a fresh settings read inside the serialized
mutation and retain its authoring account/session through the write.

Offline or idle devices retain cached content until a fresh proof succeeds;
already-rendered content stays until its next render. This design has no TTL.

## Verifying a change in a real browser

Channels (team chat) have an end-to-end suite over a whole local stack, with
several people in separate browser profiles: `just test-channels-e2e <instance>`
(see `tests/channels-e2e/README.md`). CI runs it on pushes to `main` and nightly,
not on pull requests; run it on a branch by hand
(`gh workflow run channels_e2e.yml --ref <branch>`).

`just test-functional` builds a production-like bundle of its fixtures and runs
Playwright against it, not a dev server: each page otherwise fetches thousands of
modules through the test's own routes, which limits how many tests can run at
once. A fixture that depends on dev-only behavior won't work there. CI sets
`FUNCTIONAL_TEST_WORKERS` and retries a failed test once; locally it defaults to
one worker and no retries.
Cache fixtures must mount `useSyncLoginCookie`, serve fresh identity and CRM
access-proof responses, and preserve the source generation on direct cache
writes so they exercise the real worker/WASM generation fence.
Include the production `cacheSessionExchange` in controlled GraphQL clients so
imperative refreshes carry the same observer and storage stamps as app requests.
Model host retirement with authority detachment and a fresh proof before continuing.
Call `initializeLexical()` before mounting isolated editor fixtures so decorator nodes use the app's renderer registry.

ID-only user mention rendering, name lookup failure, and composer save/reopen
are covered on desktop/tablet/phone by `user-mentions.browser.e2e.ts` in the
LexicalMarkdown core browser suite (see its README).

During iterative visual tweaks, use focused browser verification; defer full typechecks and CI checks until the batch is ready or the user requests them.

After a pre-commit hook restores unstaged frontend files, verify the dev server serves the final source; touch affected files if its transform cache still serves an older version.

Any user-visible change should be exercised in a browser before you call it fixed — type-check, biome, and vitest all pass on code that still has the interaction bug.

Keep the view-shell browser fixture's Vite cache separate from the native preview so simultaneous servers cannot invalidate each other's optimized modules.

On Linux, run Vite and Playwright together through `tests/view-parity/isolated-network.sh` when host interface changes cause `net::ERR_NETWORK_CHANGED`; pass an empty port list for fixture-only suites or forward the explicit host service ports needed by a stack suite.

Give browser fixtures the app's viewport metadata and assert the CSS viewport width when verifying phone layouts; mobile device emulation can otherwise retain a desktop layout viewport.

Desktop sidebar and list-header titles, saved-view icon alignment, unclipped
switcher triggers, and scrolling list controls have a backend-free regression:
`bunx playwright test --config src/components/view-shell/browser-test/playwright.config.ts sidebar-title.browser.e2e.ts`.
The same suite's `list-search.browser.e2e.ts` drives the list header's search
field, and the sidebar's (`?surface=sidebar`), over the real hotkey engine and
list controller: ArrowDown and Enter move to the first result, and Escape keeps
the search in the field and clears it from the list after a selection. In a real
`ListHeader` (`?surface=header&width=<px>`) the open field narrows, down to its
96px minimum, before the header's other actions would push its end out of view,
and keeps its full width when there is room. Inside an `@container/split-header`
600px or narrower, the toolbar New (`ViewCreateButton`) drops its label, keeping
its icon, its caret when it opens a menu, its name and its tooltip, as header
actions do. `list-split.browser.e2e.ts` resizes a list view (`asideList`) opened
as a second split across 720px: the list docks beside the empty preview above it
and fills the split below it, never leaving an empty preview behind Show
navigation.

A project's Tasks header keeps search, filters and Add existing tasks on screen at
320–430px phone widths, with search closed and open, by collapsing Add existing
tasks to an icon and narrowing the open search on phones only; tablet and desktop
keep the labels. Its icon buttons share one size on phones (the filter trigger is
`inline`), and on touch Add existing tasks picks in a `PickerSheet`. On touch,
New task is the project's own floating `+ Task` pill on every project tab,
which replaces the Tasks view's (that one creates outside any project and stays
hidden on project routes), and read-only viewers get none. Its backend-free
regression renders the real row and float host with a stand-in for the task
filters (the real phone filter trigger, which `?filters=12` gives a two-digit
count, one button on desktop) and for the Tasks view's pill:
`bunx playwright test --config src/features/projects/browser-test/tasks-header/playwright.config.ts`.

The Reviews list header (the real `ReviewsListHeader`, status tabs, New and
Search) has a backend-free regression for making room as the pane narrows:
labelled tabs while everything fits, icon-only tabs and then no scope name only
when the actions would overflow, each step undone once there is room again, an
open search taking the tab labels, icon tabs keeping their names, tooltips
and distinct icons, keyboard focus staying on a status as the tabs switch, and
list/board switches:
`bunx playwright test --config src/features/reviews-view/browser-test/playwright.config.ts`.

Search facet chip sizing, text alignment, and filter interactions have a backend-free
regression: `bunx playwright test --config src/features/universal-input/browser-test/playwright.config.ts global-search.browser.e2e.ts --project chromium`.

Agent image attachments preserve external and inline image URLs; only configured
static-file endpoints receive thumbnail sizing. The backend-free regression is
`bunx playwright test --config src/features/block-agent/browser-test/attachments.playwright.config.ts`.

Split dragging and composer reflow have a backend-free browser regression:
`bunx playwright test --config src/lib/core/component/Resize/browser-test/playwright.config.ts`.
It exercises the real resize solver, scroll container, and Lexical layout primitive.

Stacked splits have a backend-free browser regression over the real split
router and tiled layout: splitting keeps the pane mounted, stacked gutters drag
and nudge to the minimum height, closing hands the column back, and a document
keeps its reading position as the splits beside it close (WebKit has no CSS
scroll anchoring; see `keepScrollAnchorOnResize`):
`bunx playwright test --config src/components/app/split-layout/browser-test/playwright.config.ts`.
Keep panes in one keyed list positioned by the layout tree; nesting a
`Resize.Zone` per split remounts a pane whenever its split changes.

Directional split focus (`Shift+H/J/K/L`, `Shift+Arrow`) has a backend-free
browser regression over the real split manager, `SplitLayout`, and hotkey
engine, with stand-in panes: moving through two stacked splits beside three,
returning to the split you came from, a list keeping `Shift+Up/Down` for its
selection, and a grid marked `data-owns-arrow-keys` keeping `Shift+Arrow`:
`bunx playwright test --config src/components/app/split-layout/focus-browser-test/playwright.config.ts`.

One document open in two desktop tabs has a backend-free browser regression over
the real router, tab manager, split layout, and orchestrator: each tab mounts its
own instance and keeps its own state, and reopening within a tab reuses it. The
same suite checks that a menu's Open in new tab opens a new active tab:
`bunx playwright test --config src/components/app/tab-layout/browser-test/playwright.config.ts`.

Desktop app switches open the requested list in the target split when the
retained detail is claimed by another pane or preview. Keep this check in view
restoration and preserve entity deduplication and native dock stack restoration;
`split-layout/tests/view-restoration.test.tsx` covers Chat and Tasks lists in
either pane, keeping the other pane's detail and history independent.
Resolve collection-provider ownership from the committed router entry before
mounting its outlet; the layout's mount metadata can still describe the previous
view. `split-layout/tests/SplitPanel-collection-navigation.test.tsx` covers CRM
to Calls, history, and split reuse while that mirror is stale.

Links in database text and URL cells open without editing the cell, on desktop
and touch, while the rest of the cell still edits:
`bunx playwright test --config src/features/block-database/browser-test/playwright.config.ts links.browser.e2e.ts`.

Wrapped and multi-line text cells have backend-free regressions in a plain
database and a CRM pipeline: Shift+Enter and Alt+Enter add lines without leaving
the row, a trailing new line takes the caret, arrows move through wrapped lines
before leaving the cell, the closed cell shows every line, and the editor keeps
the value's weight and line height:
`bunx playwright test --config src/features/block-database/browser-test/playwright.config.ts multiline.browser.e2e.ts`
and `bunx playwright test --config src/features/crm/browser-test/playwright.config.ts editor.browser.e2e.ts`.

Database document-reference cells have a backend-free desktop/touch regression:
`bunx playwright test --config src/features/block-database/browser-test/playwright.config.ts references.browser.e2e.ts`.
It uses the real records view with a local source and picker to exercise opening,
replacement, cancellation, keyboard editing, and read-only references. Navigation
adapter tests separately check file types, access failures, and split selection.

Poll cards in messages (the real `DocumentCard` around `FormCardView`) have a
backend-free desktop/phone regression: while loading, the card draws its
header with the question (the card's name, so it wraps as it will) above a body
reserved from `previewData.poll.optionCount`, keeps that height through load,
and never scrolls or clips inside. With the real form block held suspended,
the card shows the form's loading skeleton (`FormBlockLoading`, which needs no
effect to appear), then after ten seconds "Couldn’t load this form." with
Reload; that state also logs `form.card.stalled`, which the test doesn't check:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/component/decorator/browser-test/playwright.config.ts poll-card.browser.e2e.ts`.

Contact mention chips (`<m-contact-mention>`, which agents write) are one
unbreakable box, so a long address truncates at the message width instead of
scrolling the channel sideways, and the hover card wraps it whole. The
backend-free regression mounts the real message body on desktop, a narrow
split, and phone:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/component/decorator/browser-test/playwright.config.ts contact-mention.browser.e2e.ts`.

Pinch zoom on opened image files (Drive details and image splits) has a
backend-free phone and tablet regression:
`bunx playwright test --config src/features/block-image/browser-test/playwright.config.ts`.
Keep the zoomed image laid out at its zoomed size, translating only: WebKit
rasterizes an `<img>` at its layout size, so a `scale()` transform blurs it.

The emoji reaction picker renders only the rows in view (about 1,900 emojis
otherwise); its backend-free regression opens it, scrolls to the last group,
searches, and picks by keyboard:
`bunx playwright test --config src/lib/core/component/Emoji/browser-test/playwright.config.ts`.
Size its glyphs off the row, never off a cell: a cell's width comes from `1fr`
track sizing, which its own contents can push out, so a glyph sized off the cell
feeds that loop and can settle with one emoji filling the picker. The same suite
checks that widening a cell leaves the glyph alone.

The email reminder menu reads typed times through the real natural-time wasm
package; its backend-free desktop/phone regression, at a fixed New York clock,
checks both readings of a guessed hour, saving either, the reasons shown for
unreadable, passed and daylight-saving-skipped times, and the presets:
`bunx playwright test --config src/features/reminders/browser-test/playwright.config.ts`.
Run `just ensure-natural-time-wasm` first.

Focus rows have a backend-free browser regression over the real row and mapping
at wide, one-line, stacked, phone, and tablet widths: one reason per row, no
extra height or lost subject, touch rows of at least 44px, and the importance
meter on every row except on phones, with the direction in its label while
importance moves, and a preview cut short ending in an ellipsis (its box must
not be a flex container, whose text never gets one):
`bunx playwright test --config src/features/email-view/browser-test/playwright.config.ts`.
The same suite's `row-styles.browser.e2e.ts` covers Mail's row styles over the
real row: Minimalist unchanged, and Classic's shared line between rows (plus
the one above each date group's first row), lifted unread fill, weights and
always-visible checkbox on desktop and tablet, with phones kept on Minimalist,
and the Settings → Email sample following the Row style tabs.

A channel call's row and its call panel (the real `Channel` over synthetic service
responses) have a backend-free desktop and phone regression: the collapsed row, the
blank slate, a plain composer bound to the call discussion, explicit quote replies
and the outside-message popup:
`bunx playwright test --config src/features/channel/Call/discussion/browser-test/playwright.config.ts`.
The same fixture exercises the real call panel and resize hosts with empty/populated
threads, tab changes, and reopening; check composer geometry in the browser, not jsdom.
Set `CALL_FULL_HOST=true` for the real CallOverlay host, Work gating against
`origin/main`, and desktop toggle geometry; only call media and Work transport
boundaries are substituted. No hosted account data is accessed.
Keep the desktop discussion card attached across docked/overlay changes, and
verify wrapped-thread reading gaps, drafts, fullscreen navigation, and local-volume
indicators across call surfaces. Verify call-panel changes in the full call host
with screenshots; list signed-in call checks separately instead of blocking on
authentication.
Keep participant-volume fills inside their stationary track and desktop media-permission badges above the device-settings arrow; place avatar microphone-mute badges at bottom-right and personal-volume mute badges at bottom-left, with each bounded to half the avatar width so both stay visible. Verify these in the full call host.
Keep participant-volume popovers limited to the slider and volume readout, and render inline mute statuses as bare icons so tile labels retain their height.
Keep phone audio settings reachable from the microphone caret; supported participant volume uses a touch sheet, while unsupported output/volume controls stay hidden behind capability checks.
New call files use `Call/core/` for pure geometry and payloads, `Call/primitives/` for reactive media and interaction controllers, `Call/components/` for presentation, `Call/views/` for composition, and `Call/context/` for shared capability providers. Keep pre-existing main files at their paths. Call controls compose root-owned state with microphone, camera, screen, leave, layout, and shortcut parts; do not restore configurable monoliths. Shared camera-preview and background persistence logic live under `src/lib/core/media/`.
Keep the call chat card opaque on `surface-2`; omit docked borders, add its soft shadow only in light mode, and retain the narrow-pane shadow and phone sheet surface.
Initialize browser fixtures with the app's `data-touch-device` root attribute and
`applyTheme`; setting `data-theme-light` alone does not apply the theme tokens.
On a machine with many network interfaces, run it under `bwrap --dev-bind / / --unshare-net`:
Chromium otherwise aborts module requests with `ERR_NETWORK_CHANGED`.
A call's own chat on a meeting page has backend-free desktop and phone
regressions for both `CallDiscussionContent` and `CallChat` under only the
providers `Root` gives every page. The first sent message appears in the panel,
and a guest's message renders for a member without the app's notification state:
`bunx playwright test --config src/features/channel/Call/chat/browser-test/playwright.config.ts`.
A meeting page has none of `AppProviders`; only `ChannelCallPanel` goes inside
`MeetingDiscussionHost`, created by the host's render function. `CallChat`
renders directly for both member and guest access.
The stored discussion chooses one of two paths: `channel_thread` uses
`ChannelCallPanel`, while `call_chat` uses the call's own shared message thread.
Quick and scheduled calls use `call_chat`. Guests use the same `MessageThread`
and `ChannelInput` composer as members; they can send text, quote replies,
react, and edit or delete their own messages.
Signed-out meeting guests get initial avatars in tiles and the roster; do not
mount account profile-picture queries for them.

A channel's request-to-join row keeps the height it mounted at through loading
and every answer, on desktop and phone, and wraps from the requester name stored on
the event (backend-free):
`bunx playwright test --config src/features/channel/browser-test/playwright.config.ts`.

The desktop channel gutter's Mark done checks and notification list (docked in
a wide pane, a popover in a narrow one, hidden when the gutter has no room)
have a backend-free regression over the real checks, list and stacking:
`bunx playwright test --config src/features/channel-notification-stacks/browser-test/playwright.config.ts`.

Channel history keeps the message being read in place when a split opens or
closes beside the channel (the pane rewraps every message); the backend-free
regression over the production `ThreadList` is
`bunx playwright test --config src/features/channel/Channel/browser-test/playwright.config.ts`.

Discussion link scrolling has a backend-free browser regression:
`bunx playwright test --config src/lib/core/messages/browser-test/playwright.config.ts`.

Adding an agent teammate from Team → Members (its Invite Agent button,
behind `enable-agent-teammates`; members see only Invite Human): the dialog waiting until the agent is
online, falling back to the row after five seconds, a declined card and a size
with no room in place, its row's Setting up step and failed Retry, the ready and failed notifications (Message, Connect Claude plan for
admins only, Retry), Connect Claude plan's one-screen sign-in with its
expired, rejected and unreachable states, its row's Claude sign-in and switch
back to credits, the DM status banner, and its removal have a backend-free
browser regression at desktop 1440 and phone 390 over a scripted auth
service. `TEAM_AGENTS_SCREENSHOT_DIR` also copies its screenshots there. It launches Chromium with
`--disable-web-security` because the scripted services answer for other origins:
`bunx playwright test --config src/features/settings/browser-test/team-agents/playwright.config.ts`.

Members rows (owners, admins, members and agents) share one shape at every width, like a Machines row: picture, name, email, one summary line (role · plan, plus **Pro at renewal** or **No CRM access** when they apply; an agent's status), and a ⋯ that holds everything the viewer can change in the order plan, role, CRM access (named `CRM access for <name>`), Remove. The ⋯ is a `Dropdown` on desktop and a `MobileDrawer` sheet on touch, switched in `TeamMembers.tsx`. A setting the viewer can't change stays in place, disabled, with its reason written under it; don't use `disabledReason` there, whose tooltip takes the Escape that should close the menu. Names and emails wrap on rows under 480px, as Machines' names do, breaking an address before its `@`. Person rows are keyed by `user_id` (`Key`), so a refetch keeps each row and an open ⋯; don't give `useTeamQuery` `reconcile`, which writes into TanStack's cached object and so into the remove mutation's rollback snapshot. The same suite checks the rows at 1440, 820 (touch), 390, 360 and 320px, and each ⋯ item for owner, admin, member and agent rows. CRM settings' **Who can use CRM** (`views/crm-member-access.tsx`, which CRM receives as `CrmContext.MemberAccess`) lists the same person rows with `TeamMemberRow` and a CRM access switch, sharing Members' roster helpers in `primitives/team-roster.ts`; keep the two lists on those helpers. The suite's `?crm` page checks a change there seen in the ⋯ and back, a failed save and its retry, admins, and that members and flag-off owners see no list.

Phone sheets stacked on each other (Connect email over Settings, Add guests,
RSVP scope and the delete confirmation over event details), and event details
and the Share drawer over the page, have a backend-free
browser regression for backdrop taps that must not press what the scrim covers,
including mixed pointerdown/pointerup dismissal, for taps inside the top
sheet that must still press its own controls, and for swipes whose owner keeps
the sheet open (a discard prompt, a pending confirmation, event details under a
stacked sheet), which must bring it back on screen. It also keeps a persistent
prompt under an open sheet and its picker, above a transient notice, and that
notice on top of the sheet:
`bunx playwright test --config src/components/app/mobile/browser-test/playwright.config.ts`.
The same suite covers where a sheet puts focus as it opens: on itself, leaving
its first row unringed, unless the first tab stop is a text field, the sheet
focused something itself, or it names its own target; Tab then moves into the
rows, which do show the ring.

CRM creation has backend-free desktop/phone coverage for name-only companies,
personal-email contacts, contacts added by name alone, explicit company selection,
and Unicode contact names at the server's character limit:
`bunx playwright test --config src/features/crm/browser-test/creation/playwright.config.ts`.
Nested picker selection must keep its containing drawer open when the option
unmounts during the tap; drawer dismissal checks the original event path.

A record's Pipelines card (the real card over `GridCell`, with a 21-field
contact row) has a backend-free desktop/phone regression: one label column with
every value on one edge, prose under its label on a narrow card, an email cut
to one line with an ellipsis, the empty-fields row, and editing in place:
`bunx playwright test --config src/features/crm/browser-test/playwright.config.ts pipeline-card.browser.e2e.ts`.

A record page's Add to pipeline menu (the real company and contact headers and
Pipelines card over a local source) has a backend-free desktop/phone regression:
nothing read before it opens, the in-pipeline check, view-only and
already-in rows disabled, adding at a stage into the card, a second company
deal, a required stage opening Add deal, the empty state, and a refused add
(`ADD_TO_PIPELINE_VIDEO=1` records each test):
`bunx playwright test --config src/features/crm/browser-test/playwright.config.ts add-to-pipeline.browser.e2e.ts`.

Collapsible document sections (the real heading-folds plugin and its gutter
controls) have a backend-free desktop/tablet/phone regression: placement in
the 24px phone gutter, hover and touch visibility, nested folds, reload, and
Mod+Enter:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/component/misc/browser-test/playwright.config.ts`.

Composer typeahead menus choosing the side with room for their full list
(`floatWithSelection`'s `fullHeight`), above a composer at the bottom of a
phone screen and below one near the top, and the floating format menu staying
beside a scrolling editor whose selection runs past its visible bottom
(`clipToVisible`), have a backend-free browser regression:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/directive/browser-test/playwright.config.ts`.

The machine Share menu (teammates, team access, access requests, and the warning
before shutting down a resident) and Settings → Machines' Teammates' machines
section (Request access), and its Pending requests section (one-click Approve
with rows that stay mounted across refetches), have a backend-free
desktop/phone regression:
`bunx playwright test --config src/features/runtime-sharing/browser-test/playwright.config.ts`.
It runs the real queries and service client over a scripted network. The warning
opens under an owner from inside the sheet; one captured outside it closes the
menu on the first tap.

Every agent session composer (the Agents view and a session opened as a split
block) uses `AgentComposerAddMenu` (`features/block-agent/ui`) for its plus
button, so connections stay one tap away; don't give a session input its own
attachments-only menu. The block composer's plus menu has a backend-free
browser regression on desktop and phone:
`bunx playwright test --config src/features/block-agent/browser-test/playwright.config.ts composer.browser.e2e.ts`.

Composer `/` menus list Connections between Skills and Pull requests. Keep native
and hosted providers aligned with `mcp_select::select_connections`, prefer native
credentials per provider, and preserve editor focus on pointer and touch selection.

Undo in a large collaborative Markdown document (Loro undo, mirror, reconcile,
caret mapping) has a backend-free timing regression:
`bunx playwright test --config src/lib/core/component/LexicalMarkdown/collaboration/browser-test/playwright.config.ts`.
Keep reconcile and caret lookups linear in the document: no `getChildren()` or
container scan per node.

Collaborative Markdown editing across several peers has a fast-check fuzzer and
the fixed scenarios it found; see
`src/lib/core/component/LexicalMarkdown/fuzz/README.md` before changing
`CollabProvider`, caret mapping, or Loro undo.

Event details placement has a backend-free browser regression: the desktop
popover stays beside its event when join requests arrive after it opens, and
slides into a short window; the phone drawer shows late requests. The same
suite covers the Add guests and Forward invitation editors (the real
`EventGuests` over a stand-in contact picker) on desktop and phone, and long
guest addresses wrapping in both: `just test-calendar-details-browser`. CI runs
it when calendar details or `src/lib/queries/calendar` change. Its fixture
aliases those query modules to `preview-adapters.tsx`, so a module export or
callback argument the adapters lack leaves every page blank; mirror it there.
Keep the popover's `flip` limited to `left-start`: an end fallback re-places it
above the event whenever a late section changes its height. Keep the guest
editors' `overlap`: without it their height follows the room below the button,
so they never overflow, never flip, and squeeze the chosen people to nothing.

Email invitation cards have a backend-free desktop/phone regression for long
descriptions wrapping inside the card, collapsed and expanded, the guest row
lining up with its icon, and `+N more` keeping a 44px tap target on touch:
`bunx playwright test --config src/features/email-message/browser-test/playwright.config.ts`.
Use `wrap-anywhere` alone on wrapping text: `break-words` is emitted later and
overrides `[overflow-wrap:anywhere]`, which then no longer shrinks min-content.

The desktop app's local runtime setup (find an agent, connect, create the
agent, retry, open a session) has a backend-free browser regression over a
scripted runtime:
`bunx playwright test --config src/features/local-runtime/browser-test/playwright.config.ts`.

Connect Cursor's API-key field (`SecretInput` from `@ui`, which every secret
field uses) has a backend-free desktop/phone regression over a scripted auth
service: masked while typing, the reveal toggle keeping focus, excluded from
session replay, and saving on Enter:
`bunx playwright test --config src/features/settings/browser-test/cursor-connect/playwright.config.ts`.

Share message image paste, drop, removal during upload, and
upload failure have desktop, phone, and tablet browser coverage:
`bunx playwright test --config src/lib/core/component/ForwardMessageComposer/browser-test/playwright.config.ts`.
Keep the shared uploader from restoring removed attachments or publishing after
the composer is disposed. The Share button and shortcut use the same upload guard.
Keep Share composers free of a paperclip button on desktop and mobile; preserve image paste and file drop.

Non-personal entity rows in typed-name menus (Command-K, mobile name search, @
mentions) rank with `NAME_MATCH_RANKING` in `@core/util/freshSort`: names equal
to the query first, then names starting with it, then other matches, with tight
matches near the start scoring higher. Each menu's recency weights and type
boosts (Cmd+K's channel and DM boosts) order rows within those groups and never
lift a row past a better name match. Cmd+K and mobile name search
(`rankCommandSearchItems`) put relationship first among names with a word
starting with each typed term (`startsWordsOf`, the native word-prefix rule),
as people policy 6 does: the viewer's own results and the people they know
(teammates, a DM row, or a person with an interaction time, which comes only
from DMs) lead, ordered by match, and people the viewer never messaged, CRM
contacts included, follow however exactly their name matches. Names that only
contain the query come last, with strangers after the other rows of each tier.
Among equally good matches Cmd+K lists teammates, then other people the viewer
knows, before other rows. Within a run of adjacent people rows in one of those
groups, Macro users and DMs lead CRM contacts whatever their match; no person
moves past another result or into a better group to do it. Personal contact
rows keep the native window order among people in the same group, matching
equally well and equally close to the viewer, so a recent weaker match never
takes a better match's slot. People outside the viewer's team (a person, CRM
contact or one-to-one DM whose person is not on the team's roster) follow every
row from the team, typed or not (before typing, `listOutsidePeopleLast` puts
them after the recent rows and the used commands among them, ahead of the
command catalog that starts at the first never-used command after the team's
other rows), in the same groups among themselves; group DMs stay with the team's
rows. Each side keeps its own window order, so a window person the ranking
left out stays on their side. A query that is exactly such a person's email
address or full name of two or more words ranks them among the team's rows as a
stranger, even one the viewer messages. While the roster loads, nobody is
outside.
A row whose letters merely appear in order ranks below every row containing the
typed words.
Soup's local search pool (`createSearchState`) stays lazy: it builds only when
local search has text. Its cache rows (`SearchProvider`'s `entityPool`) are
read only while a caller passes a `searching` accessor that is true
(`readsCache` on the list), because a pool reading the cache rereads it on every
change and queues behind every other read; its in-memory rows stay listed, so
the first keystroke does not rebuild them. Quick Access's history and recent
channel sources follow cache changes promptly only while one of its lists reads
the cache, and at most once a minute otherwise (`intervalWhileRead`). Never
read them as a list opens: the read lands after the first paint and reorders
rows already on screen. Measure Quick Access ranking at scale with the
[scale fixture](src/features/command/browser-test/README.md).
Ordinary DM entity matching in Cmd+K and mobile name search treats the first
name as exact, so it reaches a full-name DM; personal contact windows count an
exact first name as exact the same way, in their native tiers, after leading with
people the viewer has a direct message with. `commaSeparatedChannelMatch` (Cmd+K, mobile name search,
Quick Access, and Soup search including the Chat sidebar) matches channels and
DMs by terms in any order, adding to uFuzzy's in-order matches, because names
are generated from participants and people type them in any order. It also
ranks a conversation whose participants the query names, by name prefixes,
right after exact names. Each participant needs a term of their own, so a group
with more people than the query names stays below it.
Commas separate query terms like spaces in the cache search
(`cache-core/search.rs`, mirrored by `matchesTokenSubsequences`) and in the
server's channel name search; keep the three together.
Name scores are per-row (a fixed 0–100 scale), not normalized against the current result corpus. Rust/browser fixtures in `crates/subsequence_match/src/ranking` keep match quality and recipient tiers aligned; surface weights and boosts remain caller-owned. Command-keyword eligibility keeps its dedicated matcher.
Name groups and match position use the row's label (`getDisplayName`), so search
text can add emails, aliases, or command keywords before or after it. Mention
menus rank loaded entity sources together with `MENTION_RANKING_CONFIG` in
`MentionsMenu/utils/mention-ranking.ts`: name relevance, viewed recency,
brevity, and type boosts. Task projects use the `initiative` bucket; `project`
means a Drive folder. Preserve broader cache/server matches and the existing
People preview/pinning. Group company and contact records under
Contacts & Companies, separate from People; keep contact selection as a CRM link
even for a matching Macro user.
Only Macro users and groups participate in mobile People pinning.
Rank scoped mention people by exact full or first name, prefix, literal match,
then subsequence before recency and mobile pinning; preserve native directory order.
The channel browser suite below also checks project
ranking and insertion on desktop and phone.

Channel composer draft persistence has a backend-free browser regression:
`bunx playwright test --config src/features/channel/Input/browser-test/playwright.config.ts`.
It checks draft blank lines across remounts, one shared draft for a channel
mounted twice (two desktop tabs), that a sent message renders its
lines with the spacing the draft showed, that the one-line composer centers its
buttons on the text line, and pending sends on desktop and phone: clear immediately, restore failed sends, and preserve a new draft typed during delivery.
It also pastes a Macro link and Markdown into a code block, which must keep both as literal text.
`layout.browser.e2e.ts` checks, on desktop, tablet and phone, that the one-line
layout follows the draft after every keystroke, deletion and paste, across
resizes, and on the first frame after switching channels. It also fails if
caret moves or one-line edits copy the composer to measure it:
`createComposerLayout` reads the live editor's lines and probes a copy only
when the expanded layout can't answer, so keep the per-keystroke measure free
of clones (a copy per editor update once cost about 40% of each keystroke).
Its long-mention case taps a long document mention in a phone's collapsed pill, which must open the composer, so keep the pill's draft preview inert down to every descendant (mention chips turn pointer events back on and stop the click).
`caret.browser.e2e.ts` taps (press and release sent together) into a typed and
a restored draft and checks the caret moves there: a click that reaches
`MarkdownShell` before Lexical has read the selectionchange must not call
`editor.focus()`, which writes the previous caret back. Editor shells focus on
click only through `focusEditorFromClick` (`LexicalMarkdown/utils.ts`), which
skips the call while focus is already in the editor; the Markdown core suite's
`caret.browser.e2e.ts` (composer on desktop and tablet, with a padding tap; phones
never re-focus there) and the Universal Input suite's (the `MarkdownTextarea`
email body, desktop/tablet) cover the same tap, sent by the core suite's
`quick-tap.ts`.
It also covers phone attaching: the add drawer opens the file picker within the
tap, and when the iOS app's native photo library fails, a toast's Choose files
button opens it, because WKWebView ignores a file input click made after the
native round trip. Route iOS photo picks through `pickPhotoLibraryMediaOrFiles`.
Its phone formatting regression opens the ribbon from the add drawer in the
production message editor, removes selected strikethrough, and saves; keep
the ribbon horizontally scrollable and preserve editor focus on its controls.
The desktop app's channel picker carries no `accept` filter
(`channelFilePickerAccept`): in the macOS app a filtered picker attached nothing.

Shared GraphQL query metadata has a backend-free desktop and iPhone WebKit regression:
`bunx playwright test --config src/lib/urql-solid/browser-test/playwright.config.ts`.
Publish data and metadata atomically. Reconcile result data only; replace
operation metadata so shared documents,
cached query text, and operation names remain consistent across query changes.

Block formatting passes a forward copy of the selection to Lexical's
`$setBlocksType` so backward selections include their first paragraph and keep
the editor's actual selection direction. The Markdown core browser suite's
`quotes.browser.e2e.ts` checks Quote through the floating toolbar and after saving.
The same suite checks multi-paragraph plain-text, HTML, and Lexical pastes into
empty quotes and selections within a quote on desktop, tablet, and phone.
Selections across adjacent quotes stay quoted; ranges containing unquoted blocks
retain normal paste behavior.
Keep pasted paragraphs quoted through the shared clipboard insertion command.

A frontend dev server runs against the **dev** backend, so this needs no local stack, Docker, Rust build, or `sudo`:

```sh
cd apps/web && PORT=3003 bun run dev   # any free port in 3000-3009
```

`import.meta.env.MODE === 'development'` resolves the service clients to `https://dev.macro.com` through Vite’s same-origin development proxy. Sign in on the development hostname; existing `.macro.com` cookies are separate. Vite prints `https://<hostname>:<port>/app/`; `https://localhost:<port>/app/` also works. Trust `infra/local/certs/ca.pem` once in the visiting browser (see `infra/local/certs/README.md`). `MACRO_DEV_HTTPS=false` restores HTTP for workflows that require it. Notes:

- On a remote devbox, open `https://<hostname>:<port>/app/` directly. The dev server serves HTTP/2, gzips modules and links source maps instead of inlining them, so a cold load of the ~7k dev modules moves ~13 MB instead of ~100 MB. Trust the CA on the visiting machine: Chrome caches nothing from a site whose certificate warning was clicked through, so every reload re-downloads every module. Tailscale Serve is an alternative that needs no CA: `sudo tailscale serve --bg --https=443 https+insecure://localhost:<port>`, then open `https://<devbox>.<tailnet>.ts.net/app/` and sign in again there (Serve offers HTTPS ports 443, 8443, and 10000). `MACRO_DEV_COMPRESSION=false` and `MACRO_DEV_INLINE_SOURCEMAPS=true` restore Vite's defaults.
- Never assume port 3000 or 3002 is yours. Check with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` and confirm the owner's worktree via `lsof -p <pid> | awk '$4=="cwd"'`. Take a free port instead of killing another session's server, and reuse one only if its cwd is this worktree.
- The `.cursor/*.sh` scripts and the `run-app` skill are **Cursor Cloud** entry points. On a local machine they prompt for sudo and are the wrong tool. Only backend (Rust) changes need the local stack.

### When the change needs a local backend

`bun run dev` talks to the deployed dev backend, so a change that adds or alters a backend endpoint can't be fully verified that way (the new route 404s against dev). Start the full local stack from the repository root:

```sh
nix develop --command just run_local --instance <name>
```

- Launch it through `nix develop` on Linux: the services are built natively against the dev shell's libraries, and the stack mounts `/nix/store` into their containers.
- `--instance <name>` gives an isolated Compose project, volumes, and a deterministic per-name port window, so it never clashes with another worktree's stack. `just status_local --instance <name>` prints the endpoints without starting anything; `just stop_local --instance <name>` stops it (volumes kept) and `just destroy_local --instance <name>` removes it.
- First bring-up is slow (a build of every service plus the agent-harness sandbox image); later runs reuse the caches. It needs no terminal: without one it runs in the background and returns once ready, and survives your shell dying. `just run_local rebuild --instance <name>` rebuilds changed Rust services in place (`r` while attached); add `--services <name>` (comma-separated compose or binary names) to rebuild and restart only that one, then `stale_services` in `status --json` lists the services left on older code until a `rebuild` with no flag catches them all up. `just run_local status --json --instance <name>` reports its state. See [Run without a terminal](../../docs/development/running-locally.md#run-without-a-terminal).
- No accounts are pre-created: passwordless login registers any email on demand, and the one-time code lands in the instance's Mailpit (endpoint in `just status_local`). `just seed-scenario apply --file seed/scenarios/team-perms.json` seeds multi-user team fixtures with printed login links.
- Full details, Doppler vs no-Doppler modes, and port-conflict debugging: `docs/development/running-locally.md`.
- `just run_local` prepares the wasm packages (`bun run dev:prepare`) while the services build, from a machine-wide cache keyed by each package's sources (`~/.cache/macro-local/wasm-pkgs`); only a package no worktree has built yet compiles, which takes a few minutes. A bare `bun run dev` doesn't use that cache.
- That tab is pointed at **real dev data**. Treat creates, edits, and deletes as real, and discard drafts you open.

### Instrumenting a flash, blank, or remount

A screenshot cannot distinguish a repaint from a remount, and automated browser tabs usually run with `document.visibilityState === 'hidden'`, where `requestAnimationFrame` never fires — do not sample per frame. Tag the nodes you care about and let a `MutationObserver` record every change to a summary string:

```js
window.__inst = { log: [], seq: 0 };
const I = window.__inst;
const tag = (el) => (el.dataset.instId ||= String(++I.seq));
const snap = () => [...document.querySelectorAll('.fc')].map(tag).join(',');
I.last = snap();
new MutationObserver(() => {
  const s = snap();
  if (s !== I.last) {
    I.log.push({ t: Math.round(performance.now()), from: I.last, to: s });
    I.last = s;
  }
}).observe(document.body, { childList: true, subtree: true });
```

Then trigger the interaction and read `window.__inst.log`. `'1,2,3' → '' → '1,2,3'` (the same ids coming back) is a `<Suspense>` detach and re-attach. Fresh ids are a true remount. Nothing at all means the subtree never moved and the cause is elsewhere. Re-running the same interaction a second time is the cheapest way to prove a cold-cache cause: a once-per-session query settles after the first attempt, so the second attempt stays clean.

Keep each imperative dialog inside its own Suspense boundary in `ImperativeDialog`;
lazy popup code and popup queries must never detach the surrounding app.

Remote database selections have a backend-free desktop/phone regression that
measures every row and cell while collaborators move, share a cell, or select a
range, and checks their name labels above the header and under it once
scrolled, and keyboard (Shift+Arrow) ranges whose moving corner stays in
view: `just test-database-browser`. Keep the outline an overlay, never a
border on the cell. Virtual rows are transformed, so each is its own stacking
context: a row carrying labels rises above the header only while its top edge
is in view.

The database timeline (the real view over an in-memory host) has a desktop/phone
regression in the same suite, `timeline.browser.e2e.ts`: a bar too short for its
title shows it beside the bar, inside the calendar clip, until zoom makes room
(a truncated bar field does not count), and the view menu sits with the chart's
controls. CI runs it when
`components/gantt` changes too. A bar's beside title widens its
`GanttCalendarClip`; without that the clip cuts it off at the bar's end. Only a
cut `Gantt.BarTitle` (or the label itself overflowing) counts as a cramped bar,
so wrap a bar's title in it.

Column renames have a backend-free desktop/phone regression using the real
schema query and mutation adapter with delayed service responses:
`bunx playwright test --config src/features/block-database/browser-test/playwright.config.ts rename.browser.e2e.ts`.
It checks the optimistic name, header identity, and persistence across reload.

## Canvas collaboration

Document sync uses the `sync-via-gateway` PostHog flag in both deployed dev and
production. Off or unknown flag values use direct sync sockets.
Local stacks with the updated DSS can opt in with `VITE_SYNC_VIA_GATEWAY=true`;
`false` forces direct sync. The choice is made when a sync source is created
and stays fixed for its lifetime. PostHog can serve a cached value on reload;
recreate document sessions after the client receives the updated flag to change
transport. This is not an immediate kill switch for open sessions. Finish deploying the updated
DSS before enabling; the dedicated `/sync/ws` socket hosts routing independently
of the connection-gateway notification socket. The PostHog key keeps its historical name.

Saved canvases use the shared Loro runtime; the stored JSON is only the original
migration seed. Keep whole-file simple-save out of scene editing. Canvas
initialization, WAL/snapshot recovery and teardown live in
`features/block-canvas/queries/canvas-session.ts`; presence is ephemeral and
reference bookkeeping is excluded from scene undo. Run the feature tests and
`bunx playwright test --config src/features/block-canvas/browser-test/playwright.config.ts`
for multiplayer changes.

Canvas **Ask Macro**, including the Drive detail header, attaches the current canvas to the existing agent composer
on desktop and mobile. Tool results render through
`lib/core/component/AI/component/tool/Canvas.tsx`; edits arrive through live sync.
The shared plain-text Lexical codec is `packages/lexical-core/canvas-text.ts`.

## Notifications inbox filters

Read `src/features/notifications-inbox/AGENTS.md` for the selected-category filter
contract, legacy storage conversion, and focused checks.

## Group chats in the notifications inbox

A group chat's message row shows the chat (its picture or the channel kind)
and its name, with the sender in the body, never whoever wrote last as the
row's author; unnamed group chats shorten to two names and a count
(`features/channel/group-chat-name.ts`). The backend-free desktop/phone
regression is
`bunx playwright test --config src/features/notifications-inbox/browser-test/playwright.config.ts`.

On touch, a done row or stack notification folds away (`SwipableRow`'s
`collapseRow`, through `setCollapseEntity`) before the feed hides it; the feed
hides rows at once, so removing first drops the row before it can animate. The
same suite's `swipe-done.browser.e2e.ts` swipes a row in the real
`NotificationsView` at phone width and checks it folds over frames before the
feed takes it, the row below slides up without a jump, Undo restores it, and
reduced motion skips the fold.

Its `stacks.browser.e2e.ts` runs the same view with a pointer: an open stack's
row keeps its toggle in place as Hide (beside the Hide under its last
notification), hovering a row swaps its time for Mark done without moving
anything, and an open stack leaves the other rows undimmed, on phones too.

A swipe row folds only what is inside it: draw a row's divider inside its
`SwipableRow` (as `InboxListEntity` does), or the folded row leaves its line
behind. A list that can keep a row after a done unfolds it through
`setExpandEntity`: touch Notifications' Signal/Noise list (`HomeList`, whose
work feed keeps own work) passes `expand` to `toEntityActionListState`, and
`executeWithSoup` calls it once the done settles. Its regression is
`bunx playwright test --config src/features/next-soup/soup-view/views/inbox/browser-test/playwright.config.ts`.

## Message notification reads

Gate automatic message notification reads on the actual message element
intersecting the visible scroll area, excluding floating chrome and background
tabs. Share visibility observers per thread list, including standalone threads;
never treat virtualized overscan or a visible thread parent as seeing its replies.
The backend-free desktop/phone/tablet regression is
`bunx playwright test --config src/features/notifications/browser-test/playwright.config.ts`.

## Development Patterns

CRM pipeline schema adapters supply `currencyColumnId`, `fixedOptions` and
`defaultValue` to the shared database editor. Pass the complete row to cell
formatting and group monetary calculations by currency; CSV keeps amounts and
currency codes in separate columns. See the [outcome/currency design](../../docs/design/crm-outcome-currency.md).
Keep locale-aware money input separate from strict first-entry inference, and
exclude non-nullable fields from bulk clearing.

Route database row rename and delete through `renameDatabase` and
`trashDatabase`; use the row grant for rename, delete, and sharing permissions.

Shared diff and Changes views expand files with at most 40 additions + deletions
by default; keep saved per-capture choices and explicit toggles authoritative.
Use `/app/debug/diff-view-ui` to exercise the 40/41-line boundary.

Project grouping in Soup and its live cache projection uses the system Project
property (initiative membership), with an empty key labeled No Project. The
server labels each project group with the initiative name the viewer can read;
headers resolve a name themselves only while a group is still labeled by its
key, and projects sort by name with No Project last. Data a grouped list shows
about its groups (labels, order, membership) is computed on the server and
mirrored by the cache's local grouping projection; never add a side cache in
feature code to cover a remount.
Project identity chips use cache-first reads and the shared `GraphqlUser.visibleInitiative`
entity resolver to reuse complete authorized records from project lists or details.
A missing or hidden project reads as `null`, and a cached null outranks a record
that arrives later, so project reads ask the server once before showing it.
Keep cold row metadata reads non-suspending so virtual scrolling never detaches
its list; permission revalidation remains independent of row mounts. Project
reads retain client-scoped denial state across remounts and immediately reauthorize
previous-viewer cache hits; older requests never clear newer denial decisions.
A project view mounts one full project read (`createProjectSource`): breadcrumbs
and labels use the identity read, and embedded lists take the view's source.
Keep editable breadcrumb icons on that identity read, including owner metadata;
never load project counts or task membership just to open the appearance editor.
Project reads refresh only through the activity registry (pushes, websocket
connects, the app's own project writes; `registerProjectRevalidation`); never
add a timer or focus refetch to them.

Resolve server date-group keys through the shared `DATE_GROUP_BUCKETS` metadata
in `lib/queries/soup/grouped/api.ts` for labels and display order; cached Mail
uses the same metadata.

Keep persistent list hotkeys free of mounted-view closures, and clear
virtualizer accessors when their view unmounts.
Keep editor newline handling local; result-opening handlers must yield
Shift+Enter while an editor owns focus instead of adding shared hotkey flags.
A composer renders paragraphs with the spacing its sent message renders with,
so a draft reads as what it will send; drop only the draft's first and last
margins, which the compact single-row layout measures.

- Reuse `src/components/WorkspaceTexture.tsx` for the onboarding and Create
  detail panel grain; pass the surface accent and a unique SVG filter ID.
- Keep shared database card rendering in `features/database`; CRM supplies
  pipeline-authorized positions. Exercise both editor and board fixtures with
  `bunx playwright test --config src/features/crm/browser-test/playwright.config.ts`.

### Pipedream native authorization

Keep native Pipedream consent in the system browser: the desktop navigation
plugin redirects external popups and breaks the embedded iframe's return path.
The native webviews load only the app's own origins; never add an exception
for a third-party page (WebKit asks the navigation plugin about iframes and
pages alike, so one would also let that page replace the app).
`pipedream-connect.html` is a separate Vite entry, served at
`/app/pipedream-connect.html`, without a Macro browser login. The Connect token
and one-time state travel only in its URL fragment, which the page removes on
load. When Connect finishes it opens the `macro://` callback itself, keeping
**Return to Macro** as a fallback link; the Tauri navigation bridge consumes it
without changing the active route. Backend registration still verifies account
ownership. Done, logout, and the ten-minute timeout retire pending callbacks.

Connect can close without reporting success (an OAuth provider severs its
consent popup's opener) even though Pipedream created the account. Every close
without success, on web and native, asks `/pipedream/mcp/recover` to register
the user's newest account for that app from the last fifteen minutes.
Desktop Home and Agents new-conversation and active-session composers show the shared **Run agents
on this computer** invitation until this installation is paired or the current
user dismisses it locally. Keep the invitation tied to bundled macrod support,
not to account-wide paired machine count; a user can pair several computers.

### General

- Reuse `InlineTitleEditor` for borderless entity renames; use a bare shared `Input` with focus styling for borderless draft names.
- Keep contact removal and restoration beside Copy contact link in both record
  headers; keep company actions on Overview. Reuse the hidden mutations and
  confirm company contact/email-sync effects.

- Keep selection controls on shared `Checkbox`, `ToggleSwitch`, and `RadioGroup`;
  preserve their native input semantics and use root sizing instead of internal
  control/glyph overrides. See the [selection-control contract](../../.agents/rules/web/ui-primitives.md#selection-controls).

- Keep model picker triggers bounded with full-name title tooltips; wrap model names in catalog rows, including effort submenus and touch sheets.

- All Mail previews exclude spam/junk and trash. Keep draft edits from restoring
  an excluded preview or timestamp, including synced Macro drafts; Drafts and
  Sent retain their own canonical membership.
- Spam and Trash use scoped REST pages without shared preview normalization or
  service search; restore through the provider-neutral thread-state mutation.
  Refresh these isolated lists after read-state writes, provider sync events, and
  settled Outlook operations; shared-cache updates cannot reach them. Preserve
  newer selections when a pending folder restore finishes.

Agent split headers show live viewers through `BlockLiveIndicators` with the
resolved session ID; keep the existing `AgentSessionProvider` subscription to
`agent_session` rather than enabling legacy block tracking of placeholder IDs.

- Share URL recognition with `packages/lexical-core/utils/auto-link.ts`; preserve explicit unlink markers when saving and rendering messages. See `packages/lexical-core/README.md` at the repository root.
- `openExternalUrl` opens only a link scheme (`isAllowedLinkUrl` in `packages/lexical-core/utils/link-url.ts`), a relative URL, or a scheme in its `OPENABLE_PROTOCOLS` (`core/util/url.ts`); add a scheme there when a caller needs one. Renderers that draw an anchor from saved content check the URL the same way.
- Keep ordinary hyperlinks on the theme's link colors (blue by default), including Markdown renderers/editors and calendar descriptions; preserve mention decorators' separate styling.
- Keep contact address edits (add, remove, make primary) and company edits (personal-provider
  link/switch, Remove company unless an address is on the company's domain) in shared CRM field views, using Tasks
  property primitives and committed-response/session-fenced cache updates. Close
  direct cache-write admission on logout and login replacement, and drain admitted
  durable writes before clearing storage, while starting independent local/server
  sign-out immediately. Retain the exact physical cache owner through cleanup even
  after its public wrapper retires. On login, remove only session-written contact
  records before refetch; recover typed owner/bootstrap failures only through the
  original backend/scope factory. Preserve queued offline edits, report failed
  repair, release email verification's busy state on failure, and retry only local
  completion after a code has been consumed. New address/back/send attempts must
  verify anew. Keep admission closed until cleanup succeeds; serialize login behind every logout wipe;
  `browser-test/archive/contact-edit.browser.e2e.ts` covers desktop and touch flows.
  `browser-test/archive/selector-pagination.browser.e2e.ts` covers shared
  task/contact/mixed/thread/generic source pagination on desktop and touch.
- Keep **Exclude thread from CRM** beside sharing in both thread menus and
  immediately before the reminder bell in desktop thread headers. Disable it
  with the same reason unless the member contributes that exact mailbox; show
  excluded state and allow removal even after consent is withdrawn.
  Render **Excluded threads** with the existing email mention component,
  including its preview and split navigation, and dismiss the phone Settings
  sheet after opening; keep **Remove** independent of the mention. Supply the
  owner-authorized row title inline and load full previews only on interaction.
  Read only the consent projection and exact thread lookup for thread controls;
  keep their owner/session CRM cache keys synchronized by the privacy mutation.
  Use the shared privacy mutation so contact/company contribution email readers
  and owner exception pages refresh even when another reader fails; report
  refresh failures separately from a successfully saved change;
  gate thread actions and exception settings with `enableCrmThreadExclusions`,
  which has no dev/local override while backend ingestion rolls out;
  another contributor's copy remains eligible. Desktop/phone coverage lives in
  `src/features/crm/browser-test/privacy`.
- Keep selective CRM settings reads side-effect free, validate on **Save and share**, preserve drafts across conflicts until explicit policy review, and retain inspection/history/withdrawal when the gate is off; see `src/features/crm/README.md`.
- Show CRM mailbox-domain block refusals beside the submitted input and existing
  matching-entry explanations in the shared settings row description; retain
  removal and distinguish company domains from personal providers.
- CRM creation accepts name-only companies and full contact email addresses.
  Company selection is explicit; a matching domain only suggests a company.
  Keep the standalone and pipeline forms consistent (see
  `docs/agent-guide/crm.md` at the repository root).

- Empty human DMs use the shared centered conversations graphic and explain email delivery to nonusers; keep this state out of agent DMs, loading/error states, and populated timelines.
- Keep CRM database discovery row-linked and permission-scoped; use horizontally
  centered actionable list states raised toward the toolbar and shared skeletons,
  with separate search-empty and retry states. Company/contact touch headers use a
  Switch view drawer that honors host collapse and square copy-link islands; keep
  phone breadcrumbs above the switcher and leave the workspace view strip unchanged.
  Open linked items under their Customers source URL; typed record sections append
  only `<id>` and reject redundant typed URLs. Workspace activity and record
  Files/overview notes retain item metadata on their own scoped routes. Keep
  source and record breadcrumbs without section labels or extra preview-title
  separators, retain entity menus and sharing, and return the current record
  breadcrumb to its captured section and history entry.
  Record search fills the row beside filters with header spacing; section creation
  replaces the default floating dock action through FloatRegion. See
  `src/features/crm/README.md` and `docs/agent-guide/crm.md` at the repo root.
  Keep Files scoped to the contact when it has no email; emit one
  email-attachment participant literal per address the contact holds.
  Put Archive beside Copy link for visible CRM records; put the Archived chip and
  separate compact secondary Restore button in the identity heading for archived records.
  Match record metadata to the 24px property-control scale while reserving separate
  44px touch targets; see the CRM README for the visible-face and hit-area contract.
  Keep explanations on the chip and retain company-only Email sharing controls.
  Use the explicit Visible/Archived filter for People, Companies and company Team;
  reset its admin-only choice on account/team/role/list changes and preserve search.
  Apply confirmed visibility changes to detail, list and normalized search caches;
  fence in-flight pre-write responses and refresh only affected CRM readers.
  Declare CRM membership dependencies from each Soup query's initial filter scope
  on every page so empty late responses are fenced without refreshing excluded types.
  Recover missing dependencies before forwarding durable/imperative revalidations;
  a later observer may share an in-flight request without forwarding its context.
  Preserve company cascade semantics and require company restoration before a person.
  Run desktop/phone controls with `bunx playwright test --config src/features/crm/browser-test/archive/playwright.config.ts`;
  `browser-test/people` and `browser-test/team` additionally cover synthetic query adapters;
  `browser-test/team` also scrolls a 120-person company through three Team pages.
- Main Tasks mounts reusable GraphQL saved views; keep embedded Project/CRM task lists unchanged. Read `src/features/tasks-view/AGENTS.md` for filter, draft, navigation, and browser checks.
- Email mounts the same saved views (`kind: "email"`); read `src/features/email-view/AGENTS.md` before changing its definition, sidebar section, or mobile picker.
- Enable persisted email/calendar review controls only for the review’s saved acting account; historical reviews fall back to the session owner. Require session edit access on desktop and mobile.
- Email draft reads compare server generations before choosing cached delivery state over a restored working copy; only a definitive first-submission rejection permits local send recovery without server cancellation.
- Show email draft sync failure UI (the composer banner, a failure toast, a **Not synced** row) only when the user has to act: the server refused the write for good, or local storage needs a reload. A write that is in flight, queued, superseded by its own send, or failing in a way that can be retried stays silent and retries itself first; a false alarm costs more trust than a late one.
- Email draft sync is tested whole in `src/lib/queries/email/draft-sync.scenarios.test.ts` and `draft-sync.fuzz.test.ts`, over the simulated server and queue in `tests/draft-sync-world.ts`. Add a scenario with every change to draft saving, discarding or sending, and run `bunx vitest run src/lib/queries/email/draft-sync` from `apps/web`. A fuzz failure prints a seed and path; replay it with `EMAIL_DRAFT_FUZZ_SEED` and `EMAIL_DRAFT_FUZZ_PATH`, and run more sessions with `EMAIL_DRAFT_FUZZ_RUNS`. The banner itself is covered in a browser by `bunx playwright test --config src/features/email-compose/browser-test/playwright.config.ts sync-status.browser.e2e.ts`.
- Compose settings pages with `features/settings/primitives.tsx` so section headings,
  raised composer cards (`SettingsSurface`), row spacing, and control shapes stay
  consistent; never hand-build a flat `bg-ink/*` card. Integrations is the one
  settings page that spans nearly the full width, for its list columns.
- Preserve email signature HTML through import, preview, and source editing;
  mount Quill only for explicit Rich text editing and confirm custom-layout
  conversion. Keep the settings and composer preview on the same sanitized HTML
  renderer. Phone settings show the preview with desktop-only editing. See the
  [signature walkthrough](../../docs/agent-guide/settings.md#email-signatures)
  for browser coverage. Keep signature commit callbacks on the mutation hook
  so account-list remounts cannot leave an already-cleared draft behind. Offer
  Gmail signature import only when the inbox provider is `GMAIL`, regardless of
  its email domain; keep shared signature instructions provider-neutral.
- Keep personal accounts, team imports and agent tool connections together in
  Settings → Integrations: one searchable list row per integration, styled like
  the Drive/Tasks lists, custom MCP servers then connected ones first,
  described by what each does in Macro; preserve `agent-connections` and `team-connections` as aliases for existing links.
- Keep Macro computers (`features/settings/computers`) team-only. Gate purchase
  and Claude account surfaces with `useMacroComputersRollout`
  (`@queries/computers/computers`: the backend's `enable-macro-computers` plus
  dev allowlist answer, never a client PostHog read); keep existing lists in Runtimes and Billing and
  management actions available with rollout off. `useTeamComputers` loads by
  team membership and exposes `canPurchase` separately. Members read; admins
  buy and manage. Show the exact price before buying, send one `purchaseKey`
  per Buy dialog on every retry and a new one only after a declined card,
  wait in the dialog up to five seconds for the computer (or agent) to come
  up (`computers/primitives/wait-for-progress.ts`), offer no power,
  billing or release while `purchasing`, confirm Restore before billing again,
  and release only after the computer's name is typed. A row's usage line
  (`computers/components/computer-usage.tsx`, `useComputerUsageQuery`) never
  holds the row back: a pending or failed read shows none. See the
  [Macro computers walkthrough](../../docs/agent-guide/settings.md#macro-computers).
- Keep bot setup focused on the token-and-SDK workflow; Agent and Ownership
  controls live under collapsed Advanced settings. See the
  [Bots walkthrough](../../docs/agent-guide/settings.md#bots).
- Label the notification permission toast **Enable notifications** on every
  platform, and keep the desktop and Android Enable actions on the native
  notification provider.
- Share one notification mute menu across entity rows, detail headers, conversations, and sections; offer permanent mute, timed presets, and the existing custom-time picker, with icon-free mute and unmute actions, matching mobile drill-in choices, and no separate Snooze notifications row. Channels other than one-to-one DMs also get **Only @mentions** at the top of that menu (`mentionsOnly` on the menu props, from `makeMuteAction`); a mentions-only item is not muted (`isMutedItem` is false, `isMentionsOnlyItem` true), so give it the `@` indicator, never the muted bell. With `enable-channel-notification-settings`, Mute drops Only @mentions and covers section mute, and channels and sections get a **Notification settings** choice (`NotificationSettingsMenu`, `notificationSettingsMenuFor`, `sectionNotificationMenus`); resolve both through `createChannelNotificationSettings`, which mirrors ingress's `channel_delivery`, and show no row indicator for settings.
- Keep toast behavior in `@core/component/Toast/Toast`: desktop notices stack, mobile transients replace, and persistent notices use their own regions. A process that moves through states (an email send) shows one toast and passes its id as `replace` to change it in place, never dismissing and reopening it. Mobile notices omit the close icon and support swiping left or right. Follow the [toast presentation contract](../../.agents/rules/web/design-system.md) for shared surfaces, compact mobile notices, aligned content, and optional close controls.
  Review current toast specimens under **Current app toasts** at `/app/component/ui?ui=toast`; keep the gallery's actions inert, regions isolated, and account details synthetic.
- Keep signed-out Drive document routes on the shared detail viewer without
  mounting private list/sidebar sources; let document access checks decide visibility.
- Gate account-only queries, comment readers, and account WebSockets on confirmed
  authentication; keep public document loading independent of those services
  and distinguish unresolved identity from confirmed sign-out in UI prompts.
- Probe identity on deploy-preview origins even without a local login hint;
  shared HttpOnly dev cookies are not visible to JavaScript or localStorage.
- Leave the login hint (`syncLoginStorage(true)`) before a full-page hosted
  SSO redirect, and as soon as a native sign-in redeems its session code; the
  cookies are HttpOnly or in the native jar, and a load without the hint never
  checks identity, so the user sees sign-in again over a valid session.
- Hold automatic reloads (`holdAutomaticReload`) across anything a reload would
  lose. `createNativeAuthSession` holds them for the sheet: its result reaches
  only the JavaScript that opened it, and leaving the app for a sign-in code
  hides the page, the moment OTA bundles apply. Native sign-in (`useSsoLogin`)
  holds them on until the session code is redeemed and the login hint is down.
  Holds also reach the native updater, whose foreground handler never asks the
  page. See
  [reload diagnostics](tauri/src-tauri/README.md#diagnosing-unexpected-webview-reloads).
- Disable GraphQL cache sessions and clear login hints on confirmed auth 401s,
  even with retained user data; preserve session state on transient failures.
- Bound shared cookie-auth refresh (`core/auth/session-refresh.ts`), including
  proactive socket setup, to 12 seconds and native network availability; let
  each caller cancel its wait independently, and keep refresh timeouts retryable.
  On foregrounding, expire a pending refresh older than that deadline by wall
  clock; suspension can pause its timer.
- Treat a repeated worker-ready frame as a coordinator restart: retire the old
  engine and re-register in place, preserving durable storage and never replaying
  uncertain enqueues. Space failed coordinator registrations with bounded,
  cancelable waits; a missing startup frame is not proof of untouched storage.
  See `docs/graphql-normalized-cache-plan.md`.
- Reject already-routed optimistic enqueues with missing replies as uncertain on
  every owner departure; never forward them through network fallback, because
  their durable queue entries may survive the old engine.
- Dispatch live GraphQL notification callbacks before cache persistence so hidden
  tabs can show browser alerts; keep cache-dependent channel reconciliation
  behind ordered writes and never replay alerts when the cache resumes. Link
  cache queue/apply spans to receipt and mark listener failures without stopping
  the remaining callbacks.
- The Soup GraphQL websocket pings when the app returns to the foreground or
  comes back online, and terminates a socket that does not answer within five
  seconds (close 4499, retried). A phone can wake to a socket that reads open but
  is dead; the reconnect is what tells followers such as agent sessions
  (`subscribeGraphqlSoupReconnected`) to refetch what they missed.
- The page that owns the cache engine keeps the engine's compiled WebAssembly
  and hands it to each new engine worker (`worker/compiled-engine.ts`), keyed by
  the asset it was compiled from: the browser compiles the engine's functions
  lazily in every new worker, which cost more than reopening the database on
  each tab return. The exchange has its own port, so a failure only costs the
  shortcut; never put the module in the activation message.
  A reused engine records `graphql_cache.wasm_download` with 0 bytes and no
  `wasm_compile`. The dev server never reuses: its asset URL outlives a rebuild.
- Drain browser cache engines when their last visible consumer hides, then park
  without retiring clients; queue background work until a visible owner reopens
  storage, retaining accepted mutation settlements even if their caller leaves.
  Publish recovery reset outcomes before parking while retaining the read pause.
  A typed search held across an engine restart reaches the new engine first, and
  one already sent is not refused when the read budget expires; it has no
  network fallback. It still ends after the ordinary read timeout, Quick
  Access stops reporting it as pending after `UNANSWERED_SEARCH_LIMIT_MS`
  (while still replaying it if the engine arrives), and a list aborts the
  search it has superseded.
  Bound foreground resume reads to one second without killing an owner, stealing
  its lock, replaying writes, or treating intentional parking as a failure.
- Snapshot cache generation subscribers before dispatch and skip removed listeners;
  reactive observers may resubscribe during notification and must not extend it.
- Coalesce broad browser cache-change hints across the coordinator's in-flight
  backlog, not the engine's per-message queue; keep reset fences, mutation
  settlements, and query-specific invalidations immediate.
- Open tabs share one cache engine, so a source that reads on cache changes must
  not read while hidden: use `createVisibleRefresh` to throttle too, or
  `createHiddenDeferral` when its own reads already coalesce. Initial and
  explicit reads still run.
- Report cache operation failures through `createCacheErrorThrottle`: one owner
  loss rejects every queued operation, and each report reaches the console and
  session replay. The next report for that kind carries `cache.suppressed_count`.
- Retry still-current query reads once when engine replacement invalidates their
  snapshot; do not strand urql's in-flight key or revive torn-down or superseded reads.
  Keep network forwarding deduplicated and cache-only reads off the network.
  Fence affected cache rereads against newer published results too; reconcile
  pending edits against the persisted server snapshot instead of replaying an older one.
- Mobile dock customization shares the navigation island’s measured capacity; persist ordering per user with `mobile-dock-order.ts`, preserve gated destinations, and keep Search and More fixed. Reorder handles drag without a hold delay; the rest of each row scrolls.
- Native iOS navigation follows UIKit's preferred vertical-bar edge through `tauri/layout_plugin`; place it in UIKit's bar layout region within the system column, not beyond the content safe area. Keep the same dock mounted while its axis changes, size overflow along that axis, and leave independent safe-area clearance for content and composers. Keep JS compact-width behavior and the `mobile:` CSS variant aligned with the native size class.
- Share sidebar and mobile dock unread state through `components/app/use-navigation-unread.ts`. Gate numbers separately so unified dots can keep following the unread subscription. Keep badges reactive to read/done changes, guard query data with `queryReadyGate` so pending preferences or paused queries cannot suspend the shell, and avoid fetching extra pages for counts.
- Show notification unread dots on favorite rows in Chat, Tasks, Drive, and Reviews; reuse Chat's channel activity and the existing Soup entity hydration plus `getEntityNotifications` elsewhere, without a separate notification query or refresh registry. Never paginate favorites or the global notification feed just for dots.
- Name Home thread rows from their latest scoped notification, including document mentions and reactions; use the thread author only when no notification exists. Document rows whose newest outstanding notification is a comment, and calendar event rows whose newest is a join request, say who did it (`row-notification.ts`).
- Use `ChannelTitleIcon` for conversation breadcrumbs so DMs retain participant or agent avatars and named channels retain their pictures; suppress avatar actions inside breadcrumb buttons.
- Normalize thread-only conversation URLs in `channelsSearch` before Home, Chat, or touch views derive their message target.
- Mobile dock search owns transient category/mode state in `features/command/mobile`; reuse the shared entity source and explicit full-text adapter rather than overlaying the dock query on view tabs or saved facets. See `docs/agent-guide/search.md` at the repository root.
- Include known Macro users in typed All/People name searches without requiring a DM or CRM contact; resolve a matching person against both recent DMs and DMs found by the current search while preserving name/email matching.
- Key mobile name-result history ordering and scroll anchors by the other participant for one-to-one DMs, preserving a person's position when their conversation is created; keep group DMs keyed by channel.
- Keep mobile Search history lightweight: save query/category/mode, account-scoped item anchors, and at most 200 ordering IDs per mode; never save row objects or virtualizer caches. Restore from current sources with at most three additional pages, fall back when an anchor disappears, and stop restoration on user interaction or scope changes. Dock navigation starts a fresh search session; cached rows belong to the source, not history.
- Release per-history-entry state when its router entry is replaced, pruned, or closed; retain only the latest per-view session snapshot and the latest split event outside reachable Back/Forward history.
- Cmd+K, mobile name search, and the desktop Search page find routines by name from the Quick Access `routine` bucket (the scheduled-action list, which holds top-level routines only: sub-routines, which another routine's run created, are reached from their creator); keep them out of `entityPool`, which Home, Drive, and Tasks searches share, and use `routinePool` for workspace Search only.
- Keep Quick Access cache availability reactive to `getGraphqlSoupCacheHost()`; the host can appear, change or be disabled after the provider mounts, and email has no legacy source fallback.
- Browser storage schema 12 enables covering-index search through a fresh versioned cache; native upgrades reset incompatible caches, including queued writes. Preserve the historical unversioned tuple and existing old-queue cleanup safeguards; see `../../crates/client/README.md#streaming-text-search`.
- Contact backfill shares Soup's authenticated tab leadership and account/session ownership. Capture contact admission before each fetch, hydrate with `contactFence`, then verify cached IDs in 500-record keyset windows through the existing exact lookup. Checkpoint v2 completes only after verification; with `enable-contact-lists` the backfill and exact lookup select `GraphqlContact.lists` (the `…WithLists` operations, never the fetch-only pages) and scan under checkpoint v3, so only clients the flag turns on rehydrate; persist cursors after acknowledged writes and generation checks. Never delete from scan omissions or failed/foreign evidence, and never downgrade unsupported fencing. Keep the 15-minute coalescing floor and hourly name refresh. An invalidation naming `changed` contacts also tops up just those ids through the exact lookup (`contacts/top-up.ts`), taking turns on the contact fence with scan pages (`write-turn.ts`); top-ups never delete. Deploy canonical-ID lookup fixes before client removal checks; see `../../docs/design/disk-backed-contacts.md`.
- A surface orders its personal people window by contact list through `ContactPeoplePolicy.listPriority` (`QuickAccessListOptions.peopleListPriority`); with `enable-contact-lists` only @mention windows pass one (`useMentionListPriority` in `queries/contacts/lists.ts`, the order itself in `list-priority.ts`). `readContactDirectory` sends list fields only to a host that has answered a search with people policy 7 (5 and 6 refuse them); the first search on a host goes without and is resent once it answers 7. Keep orders within the host's bounds (16 groups, 64 keys, 128-byte keys). The real-engine regression is `people-list-order.browser.e2e.ts` in `bunx playwright test --config src/lib/graphql-cache/worker/browser-test/playwright.config.ts`.
- Use bounded contact windows and separate exact selection lookup; copy primitive inputs/cursors out of reactive query data and keep history at `gcTime: 0`. Pass resolved `UserIcon.name` to avoid redundant shared-name lookups. `/app/debug/data`, Calendar search, Drive creators and CRM Notes creators exercise this on desktop/phone: `bunx playwright test --config src/lib/core/internal/browser-test/playwright.config.ts`. DM-ranked pickers still need before-limit ranking/exclusions.
- A tab without a usable local cache lists server contact pages, which the server does not rank. On the first page of a typed search `readServerWindow` (`queries/contacts/directory.ts`) also reads who the text names: the server's exact matches (its scan stops after 2,000 contacts), plus the team roster or a whole typed address looked up by ID, and it classifies them and the page's own rows with the local ranking's exact and word-prefix rules (`namedBy`). One of those extra reads failing never fails the page, and one still unanswered two seconds in never holds it once its own rows have landed (`NAMED_READ_BUDGET_MS`): it lists without the people that read would have added, and still ranks everyone it has. `createContactDirectoryList` orders that page: direct-message partners, then teammates, then everyone else, exact before word-start matches, with the looser matches after them in the same groups; later pages are never reordered. Give every people list `teammates` (`useTeammateIds` in `queries/team/roster`, which observes the roster the app shell keeps loaded and never fetches it), and `directMessages` where the surface has them.
- Cmd+K and mobile name search show **Searching…** under the listed rows (`isSearchingEntities`, through `createSteadyFlag`) while the cache has not answered the typed query, since contacts, sessions and commands list first; only a slow search says so. A replay of an answered window is not a pending search, and `isLoadingEntities` still means an empty list is loading. A search refused while the cache changes owner (`owner-handoff-blocked`) stays pending and `createProjectedList` replays it when `onCacheGenerationChanged` reports the replacement engine; nothing else would until the next cache write.
- Cmd+K and mobile name search take task projects from the Quick Access `initiative` bucket (typed All queries and the Projects category), searched from the GraphQL cache like other entities. Don't give them a per-query server search: its rows drop out while each new query loads, so projects flash as you type.
- Merge the complete channel list into Quick Access even with the GraphQL cache enabled; preserve newer viewed timestamps and apply the channel boost before the extra DM boost in shared command/mobile name ranking.
- Include all channel metadata in Quick Access item versions; record complete, cached-recent, and merged channel counts plus the last index-build duration on cache-search traces.
- Virtualize mobile name results like desktop Command Menu; local Quick Access sources are unbounded, and mounting them all stalls iOS keyboard focus during layout. Load additional search pages near the scroll end instead of reserving a paging bar.
- Reconcile mobile full-text rows by entity ID so appending a page preserves DOM rows and scroll position; restore item anchors after responsive row measurement and disable browser scroll anchoring so layout changes cannot override restoration.
- Reserve the safe area plus the category row above mobile Search, and only the safe area above flag-off Channels; let the flagged Channels header own its top inset without reserving it again in the list.
- Follow [mobile layout and chrome](../../.agents/rules/web/mobile.md#layout-and-chrome) for full-frame views and record tabs; verify their first controls below the navigation with a nonzero safe area on phones and tablets.
- Keep the floating entity split header 0.5rem below the safe-area edge on touch, matching collection controls; include that gutter in its measured height so content clears the controls.
- Keep Email's touch filter row inside its list pane with the explicit 0.5rem top gutter used by Drive; reserve the row and its following gap in the list inset.
- Keep selected Mail routes in the workspace when folding. Use `CollectionPanes.onBack` for the narrow detail's top-left Back button and interactive left-edge swipe over the mounted, inert list.
- Use `ViewShell`'s shared 720px container breakpoint: list-aside workspaces keep their list beside details on wide touch; collection workspaces opt into `contentLayout="collection"` and compose `CollectionPanes` so their list stays left, an empty or selected preview stays right, and sub-view navigation opens through the list's Show sidebar button in a shared sheet that slides from the left over the list pane. Host touch collection navigation in the global modal layer at every width so it covers floating chrome. Keep selection/query state in the host and desktop/narrow item navigation unchanged; sheet visibility must not overwrite desktop sidebar preferences. Chat at 720px or narrower has no sidebar or navigation row.
- Keep the Home composer desktop-only; Notifications uses a full-frame feed and standalone item navigation on touch at 720px or narrower, and docks its feed beside inline previews above that breakpoint.
- Show the desktop 1px pane dividers between docked navigation, lists, and inline details on wide touch layouts.
- Scale docked wide-touch workspace sidebar widths and bounds to 1.57421875 times their base sizes; preserve the wider navigation while space permits and normalize saved manual widths across desktop and narrow overlays.
- Keep wide touch channel previews on `ChannelDetailLayout` with floating title/menu and call/invite islands, measured message clearance, and interactive navigation controls.
- Anchor mobile floating page chrome to its owning workspace pane (`ViewShell.Main`, `ViewShell.Detail`, or a `CollectionPanes` frame), including composers and action bars; keep app navigation global and preserve mounted editors while resizing or collapsing navigation.
- Use `MobileListLayout` for floating touch collection controls and their list-local fade; reserve its measured inset inside the scroller so sidebars stay clear and rows scroll behind the chrome. Give the outer wide-touch collection header twice the standard left chrome gutter to clear the bezel curve; retain the standard right gutter and narrow-touch spacing.
- Limit whole-surface glass press scaling to nearly square controls; give horizontal and vertical navigation pills the bounded paint expansion in `glassPress.ts`.
- Keep split chrome portal targets reactive so cached views can mount before their header, and clear a retiring header's targets only while it still owns them.
- Opt views into session restoration with `split-layout/view-restoration` and set `resume: true` on ordinary layout navigation; publish captured state only through the leave guard's `onCommit`, keep explicit links and new splits fresh, and reuse entry-state captors rather than hidden mounted views.
- Agent-opened panes (`features/agent-navigation`) open with `router.open` beside the agent's pane and never replace one; keep the person's active pane and focused element, the Undo toast, and the read hold (`useReadsHeldByAgentArrival` in read markers) when changing split opening, read markers or `TiledSplits` (its `data-split-pane` attribute drives the arrival motion). Undo keeps the read hold until the pane is gone, and plays the departure back when a leave guard keeps the pane. The tab id (`core/agent-session/ui-client.ts`) lives in sessionStorage, which a duplicated tab copies, so live pages compare ids over a BroadcastChannel and the one that took it later mints its own; the app shell takes it at startup. Agent navigation never runs on mobile: `agentNavigationRunsHere()` there is the one predicate that keeps the tab id off prompts, the id and its channel from starting, and the frame handler idle.
- Routes are closed to agents (`macro.ui.open`) unless they set `info: OPEN_TO_AGENTS` in `routes/routes.ts`; open one only when showing it has no side effect (no call joins, auth or OAuth callbacks, prefilled composers, credential settings, debug views), then run `UPDATE_AGENT_ROUTE_TABLE=1 bun run test -- src/features/agent-navigation` so the server's copy in `agent_code_mode` matches.
- Let `ViewShell.TopBar` own split close and navigation controls; do not add a second split close button inside Agents headers or their preview `headerLeading`.
- Desktop tabs (`components/app/tab-layout`, macOS + `enable-desktop-tabs`) hold one split layout per tab. Switching parks the active tab's panes (`router.openLayout`/`showLayout`) instead of removing them; the split manager keeps parked splits and `SplitLayout` renders one layer per tab, hiding background layers with `content-visibility` and `inert` without unmounting them. Up to `MAX_PARKED_TABS` stay mounted. Parked splits hold no content, and the orchestrator scopes managed blocks and handles to the live tab (`blockScope`), so one entity can mount once per tab; dedupe applies only within a tab. The strip renders in the title bar's center slot. Cmd+click arms an open-in-new-tab intent: the split manager's `openWithSplit` consumes it first and opens the content as a tab (before reuse and leave guards), and `openInNewTabMiddleware` catches navigations that bypass it, so tab operations must disarm the intent tracker before navigating. Menus that offer Open in new split also offer Open in new tab (shown when `canOpenInNewTab()`): `openInNewTab` holds the same intent while the menu's ordinary current-split open runs, so add it beside any new Open in new split. Tabs are not draggable. See the tabs section of `docs/agent-guide/navigation.md` at the repository root.
- Use the same Channels feed at every touch width, docking it beside inline previews on wide panes. Keep flag-off touch Channels on its Recent feed; with `enable-chat-sidebar-sections`, reuse Home rows and horizontally scrolling favorite pins, with All, Direct messages, and personal/shared section tabs in `rail/next/mobile/`.
  Show all loaded channel favorites in saved order in the sectioned touch layout's horizontal scroller; apply the six-pin limit only to the legacy three-column grid.
- Mount the mobile search input before focusing it inside the dock tap; keep navigation in that handler so focus does not trigger a second navigation or lose iOS keyboard activation.
- Preserve focused chrome editors during deferred split insertion/removal/content-change autofocus; explicit return-focus commands may still focus the pane. On desktop, content changes claim focus only for Cmd+K navigation or create-menu arrivals, and only if the destination has not already focused a child. Back/forward and ordinary clicks do not autofocus content, except that a click, Enter or Cmd+K that opens a conversation focuses its composer (see [composer focus and Esc](../../docs/agent-guide/channels.md#composer-focus-and-esc)).
- Reconcile global focus when focused DOM subtrees are removed; iOS can omit blur events, otherwise floating creation actions stay hidden after search or editor teardown.
- Mount the floating mobile AI composer only on the Agents view; other views keep their New action or their own reply/comment composer. It mounts a task after the frame that follows the navigation, behind a blank of the collapsed composer's height (`--mobile-chrome-button-size`): Agents becomes the foreground view inside the tap, and the composer's first mount would otherwise hold that tap for longer than the view takes.
- Keep desktop New actions on `ViewCreateButton`: full width below the inner
  sidebar title and compact in list controls; retain each view's creation
  workflow and mobile controls. Use `ListHeader` for the single-row Email, Drive,
  Tasks, and Projects headers: title, filters, view options, New, expandable Search.
  Render project collection titles with `ViewSidebar.Title caret={false}`; keep
  individual project names and touch pickers unchanged. Give a sidebar a
  search field only when the sidebar is the list it searches (Home, Chat, Agents),
  in `ViewSidebar.Header` so its icon precedes collapse and its field opens above
  New; a view with a list header searches from `ListHeaderSearch` alone.
  `ListHeaderSearch` owns the search keys: pass `focusResults` so ArrowDown,
  Enter and Escape can move the keyboard into the list, and never clear the
  query on Escape yourself. ArrowDown and Enter then run the list's own "go to
  first item" command, so a list on `useListInteractions` lands on its first
  row with no code in the view; when that command finds no row (a search with
  no results), the keys stay in the field. `wide` lets the open field take the rest of
  the header (the view hides its other actions from `onOpenChange`), and
  `suggestions` lists rows under the field that the arrows walk before the
  results; Email's wide search uses both. It registers the
  split's Escape that clears a search from the list; keep a view's own Escape
  steps (leaving a tab) conditional on no search, and selection clearing at
  `HOTKEY_PRIORITY_HIGH` so it runs first. Covered by `ListHeader.test.tsx` and the browser test below.
  A sidebar that is its own list uses `ViewSidebar.Search` in the header's
  search slot: the same keys (`list-search-keys.ts`), with `focusResults`
  pointing at the sidebar's list, and an emptied field collapses through the
  header (`onSearchOpenChange(false)` when the sidebar keeps it open itself).
  A sidebar that leaves the open state to the header would hide a live query,
  so pass `searchOpen` (open while a query is set) and clear the query in
  `onSearchOpenChange(false)`, as Home, Chat and Agents do. Pass `hasResults` when
  another list shares the split (Chat's rail beside a conversation's calls):
  the "go to first item" lookup answers for whichever list registered last.
  Its search clears only on an Escape pressed inside the sidebar
  (`[data-view-shell-aside]`, through `ownsEscape`), so the preview or
  conversation beside it keeps its own Escape. Home, Chat and Agents use it;
  Agents' list keys answer only while focus is in its sidebar, because its
  session pane shares the split's hotkey scope. Covered by
  `ViewSidebar.test.tsx` and `AgentsSidebar.test.tsx`.
- Keep desktop headers on the shared `ListHeader` / `HeaderActionGroup` pattern: view `Tabs` as pills after the title, semantic islands with 8px gaps on the right, fully rounded frames, New then expandable Search; retain `md` sizing for New and Search. Keep a bar at one height: detail-header islands and view `Tabs` use `sm`/`icon-sm` (28px controls), and list-header islands and Tabs (any header with New or Search) use `md`/`icon-md` (32px) to match New and Search. A labelled action outside an island is 32px, so in a detail header give it `grouped` inside a `HeaderActionGroup`. Change desktop headers in desktop views; never edit a mobile view for a desktop change ([mobile rule](../../.agents/rules/web/mobile.md#detection-and-input)). Compose ButtonGroup actions with explicit `ButtonGroup.Button` segments; use `variant="secondary" finish="raised"` on action frames. Standalone Buttons do not inherit group styling. Pick each control by role from the [design system rule](../../.agents/rules/web/design-system.md); see [UI conventions](../../docs/agent-guide/ui-conventions.md#top-bars). Never use recessed/inset backgrounds in headers.
- Use the unified model selector in every agent composer, including Home, new chats, inline and standalone sessions, and universal-input AI drafts. Reuse it for routine agent/model targets. Keep each host's saved preferences and session mutations; show Reasoning effort and Speed only when that host applies them. Retain the old controls unwired for reference.
- Render GitHub comment and PR description bodies through `normalizeGithubMarkdown` (`@macro-inc/lexical-core`), not ad hoc HTML stripping; `<details>` renders as a native collapsible section in `StaticMarkdown`. The backend-free desktop/phone regression over CodeRabbit-shaped comments is
  `bunx playwright test --config src/features/block-pr/browser-test/playwright.config.ts`; the same config's
  `changes-split.browser.e2e.ts` checks that a narrow PR split opens Changes over the PR, never as a split inside it.
- Passive PR mentions must not retry initial GitHub status failures on remount; preserve confirmed status through refetch errors and keep pending data reads out of their parent Suspense boundary.
- PR description and comment images are remote URL images: rewrite GitHub blob/`raw` links to `raw.githubusercontent.com` and load them through the image proxy so COEP does not block github.com. Load Macro's own static-file URLs and public Klipy GIFs directly with anonymous CORS, including in the image viewer. The proxy authenticates by session cookie, so a proxied `<img>` uses `crossorigin="use-credentials"` and a fetch of it `credentials: 'include'` (`isImageProxyUrl`); `anonymous` drops the cookie cross-origin and the proxy answers 401. The native apps keep that cookie in the native HTTP client's jar, not the webview's, so there `MarkdownImage` fetches proxied images through `platformFetch` and shows a blob URL (`createNativeImageSrc`); email does the same (`fetchImagesViaPlatform`).
- Download selected GIFs without re-encoding through the shared abortable static-file uploader, and insert an `sfs` image only after success; preserve the caret, discard failed or unaccepted uploads, reject stale completions, and keep failure retry in the picker. Give explicit GIF picker opens precedence over formatting and link menus, and anchor to the editor when the browser selection is missing or has no rendered geometry.
- Keep native booking exit navigation in the route shell, outside page loading boundaries, and use the router so the native hash route stays intact.
- Diagnose native full reloads with `native_webview_started`, `native_diagnostic_recovered`, and the shared `frontend_instance_id`; use `reloadApp(reason)` for frontend reloads and keep breadcrumbs content-free. Treat `previous_document_*` checkpoints as last-observed lifecycle evidence, never a crash verdict; clear them on logout. `previous_document_last_*` comes from the native navigation breadcrumb (route and entity type, never ids). See [frontend checkpoints](docs/native-reload-diagnostics.md) and `tauri/src-tauri/README.md`.
- Pass `$APPLOCALDATA` (Application Support on Apple platforms) as the native HTTP cookie storage directory; the plugin owns the `.cookies` filename. Never use purgeable caches. The location change intentionally requires one new sign-in, without migration. See `tauri/src-tauri/README.md#native-authentication-cookies`.
- Store iOS OTA bundles and markers in `Application Support/<bundle-identifier>/bundle-updates`, excluded from backup; ignore legacy cache contents rather than migrating them. Other platforms keep the updater's existing cache location. See `tauri/src-tauri/README.md#ota-bundle-storage`.
- Inline agent steps reuse the session code-execution query for live SDK operation
  names; completed step snapshots come from the shared fold of the tool receipt.
  Session `ExecuteCode` calls join their segment's tool group as their SDK
  operation rows only; never show the program or code-mode wording. A live
  tool group's header is the shared `ActivityLine` (`block-agent/ui`), the one
  a channel reply's open run uses; never add a second working line or a
  scrolling peek window beside it. `activity.browser.e2e.ts` in
  `block-agent/browser-test` replays a long run and checks it shows one live
  line, then one settled row.
- Compose multiselect filters with `Dropdown.MultiSelectItem` and the shared
  searchable filters; follow [multiselect dropdowns](../../docs/agent-guide/ui-conventions.md#multiselect-dropdowns)
  for checkbox, row, Only, keyboard, and touch behavior.
- Suggestions (the For you page and Home's Today strip and top priorities) live in `src/features/suggestions`; read its `AGENTS.md`. Gate every entry point with `useSuggestionsFlag` (`enable-suggestions`, desktop only).
- Keep added external chats (WhatsApp today) in External at `/external/chat/:chatId` with their own queries (`features/external-chat`); sharing controls viewing and the viewer's own provider membership controls sending. Never route them through channel context or services.
- All API/network calls live in service-clients.
- Preview Home project rows with the shared `ProjectDetail`; preserve its project
  search namespace, comment target, and Home breadcrumb. Touch and explicit split
  activation use the full project route. Open other projects through `openProject` (`features/projects/open-project.ts`): it
  retargets an already-open project split to the section or comment in place.
  Shared open paths (unified list rows) use its `projectHostedContent`, whose
  identity is the project itself, so the router focuses the split already
  showing it. Opening the legacy `initiative-view` component route beside an
  open project mounts a redirect shim that stays on "Loading project".
- A hosted detail pane (a project under Tasks, a call, a PR) registers as its
  host shell, so the split manager's entity reuse cannot see it; the router's
  claims decide who shows it. `openWithSplit` activates the source split before
  a replace, so a visit the router yields to the claiming pane leaves that pane
  active (`tests/claimed-replace.test.ts`).
- Bound Discussion comment readiness waits to ten seconds; recover from initial layout interruptions until the message is visible, and release the target on user input (including scrollbar pointer-down), timeout, or successful arrival.
- Keep early DOCX opens loading while exports return processing (409); retry only
  that response, with a bounded wait. See the Word editor walkthrough in
  `docs/agent-guide/documents.md` at the repository root.
- Add Google Meet account hints only to join actions using the displayed calendar's
  connected email; keep stored and copied conference links unchanged. See the
  [calendar walkthrough](../../docs/agent-guide/calendar.md).
- Share row-open reads through `features/notifications/mark-row-seen.ts` for
  documents/tasks, legacy chats, email, calendar, agents, CRM, PRs, calls, and
  projects; use it for previews, keyboard following, action advance, and split
  opens. Keep email mailbox writes in `queries/email/read-state.ts` with the
  owning inbox, and keep channel/external-message visibility policies separate.
  Ready document/chat/PR/email details mark read on mount for direct links.
  Calendar grid selections and links mark the canonical event, excluding team projections.
- Target modern projects as `initiative` / `INITIATIVE` for entity-wide
  notification writes; reserve `project` / `PROJECT` for legacy Drive folders.
- Route explicit meeting-page exits using the server's `callEnded` result: ended
  calls open their record; ongoing channel and scheduled calls return to the
  channel and Calendar. Leaving from a channel's Call tab stays in the channel. Preserve the session ID and send the server leave before media
  teardown; once the last participant drops, the server ends the call first.
- Bind channel Join, recovery, and retry to one call ID; only explicit Start or Call again may use get-or-create. Preserve that intent and ID through channel navigation.
- Keep active phone calls viewport-filling with visible header islands and idle
  controls below the video; Back dismisses without leaving, while setup and
  tablet/desktop chrome stay unchanged.
  Keep the away-call phone island in the shared `call` float region between
  composers and the dock, without displacing either. See [Calls](../../docs/agent-guide/calls.md).
- Keep saved call detail on its shared playback and SidePanel composition; follow `src/features/block-call/AGENTS.md` for transcript/chat timing, phone dock ownership, and checks.
- Diagnose browser call media with `call.media.*` spans and the `meeting.setup.id`
  on `meeting.join`; keep provider messages, device labels/IDs, and call-link
  tokens out of telemetry. See [call diagnostics](../../docs/agent-guide/calls.md#browser-call-diagnostics).
- Keep call layout in desktop `CallMoreMenu`; mirror participant visibility on the shared-screen edge, omit that edge toggle in Grid, and reset visibility when sharing ends. Desktop tile pins take Speaker placement unless Sidebar is selected, without changing saved Layout; keep every participant and share track mounted when moving tiles and clear stale pins when their source disappears. Share the call-owned pin with the desktop mini-player regardless of Layout; unpinning or losing its source restores automatic selection immediately. Phones stay on Auto; reserve phone pinning for long-press, not taps.
- Keep `CallWaveform` static except for the current call's desktop chat-sidebar row, channel-header duration pill and app-rail item; pass `live` and the matching room identity only there. Live marks follow speech and reduced motion; phones stay static. Preserve AvatarGroup separator rings with inset speaking outlines and keep phone icons for call actions.
- Keep call full screen scoped to its call root; mount call menus locally and keep tooltips in their owning fullscreen element.
- Diagnose the GraphQL mutation queue with `graphql.mutation_queue.*` spans and logs keyed by `mutation_queue.item_id`; route queue telemetry through `mutation-queue-telemetry.ts`, which dedupes per item and failure class and turns repeats into the periodic summary. Never add per-attempt `console.*` lines or record variables, draft content, or emails. A page that reloads or closes mid-attempt leaves its lease on the queue head; the runner releases it once the holder's Web Lock (`mutation-queue-owner.ts`) shows its page has been hidden or gone. Let the owner lock go on `pagehide` (a held lock can keep a page out of the back/forward cache), claim under a new owner after a restore, send a claim only while the page still holds the owner it was made under, and fence every release by the holder's owner and generation.
- Keep desktop OAuth consent in the system browser with a `macro://` return:
  `macro:///inbox-link-callback` for Gmail and Outlook inboxes,
  `macro:///github-link-callback` for GitHub (consumed by the navigation
  bridge without changing the route). Webview origins are not desktop
  callbacks. Settings → Integrations refetches connection status on window
  `focus`, because returning from the browser does not change page visibility.
  A route the split router takes a navigation over for (a deep link, or any
  in-app navigation into it) mounts before Solid Router's location shows it,
  so `useSearchParams` first returns the previous route's query. Never act on
  a missing parameter until the location shows the route, as
  `EmailLinkCallback` does (`features/auth/tests/inbox-link-deep-link.test.tsx`).
- Keep send reservations, leases, and cancellation in the email journal; the general GraphQL queue handles draft autosaves only.
- Always persist composer sends in account-scoped IndexedDB and dispatch through the fetch-only email client, without a feature flag; cache health and unrelated mutation queues must not gate delivery. See `docs/architecture/email.md` for state and rollout invariants.
- Retain sender ownership, draft signal settings, and primary-inbox selection in the same viewer-scoped inbox snapshot used by the composer; pending catalog refreshes must not block saves or sends, and account changes must clear that snapshot.
- Retry cache bootstrap on reconnect/foreground or draft Retry only when storage was proven untouched; retain the same scope and block draft sync until the replacement queue is readable. Never retry a superseded build (`cache-superseded`), stop after `MAX_RECOVERY_RELAPSES` restarts in a row whose cache failed again before staying up (restarts that fail outright keep retrying), and reset the count and backoff only after a restarted cache stays up for `RECOVERY_HEALTHY_MS`.
- Touch email replies and forwards use the full-screen composer with the shared new-email header actions; preserve thread state underneath and flush local edits before closing.
- Include unsynced email working copies in Drafts and mobile name search even
  before a GraphQL save, and warm sending accounts alongside backfill. Preserve
  inbox, alias, and facet scope.
- Draft autosaves patch GraphQL thread pages in place; revalidate them only
  when a save cannot patch the message list (missing snapshot or a move
  between inboxes).
- Keep email card resize motion on its content wrapper so message and inline
  reply transitions preserve the card's focus target and return to natural height.
- Capture the composer's visible property definitions with its values at submission; pass them as initial pins so empty custom fields remain editable below the new task title.
- Task composer submissions retain an account/context-scoped local copy until
  the create response confirms success; never clear newer composer input from a
  late callback or automatically retry an uncertain create. Keep recovery copies
  through restarts and remove them on explicit logout. See the Tasks walkthrough.
- Prefill task Source through the originating action's composer preset under
  `enable-task-source-property`; keep the shared composer flag-agnostic and retain
  exact message IDs through property edits. See the Tasks walkthrough.
- Gate task-template controls and workflow recovery with `enable-task-templates` on desktop and touch; inject availability from `ComposeTask` and retain paused template edits without blocking ordinary tasks or property pins.
- Shared server-state queries and mutations live in `src/lib/queries`; keep
  feature-specific query orchestration with its owning feature.
- Keep CRM contacts explicitly included in the auxiliary GraphQL backfill;
  bump its checkpoint version when changing the hydration input contract.
- Refresh the channel list's bounded unread and mention edges when opening a
  conversation, including an empty unread result after a read on another
  device. Include off-page favorites in unread presence without adding them to
  section counts; mention counts include thread replies, the unread dot does not.
- Decide channel detail access from completed server results: only a refusal (HTTP 401/403 or an access-coded error, `isAccessRequestError`) means denied, and a GraphQL server fault (`isGraphqlServerFault`) keeps the open channel and retries with backoff; bound confirmations of contradictory cache membership, preserve known unavailable state during retries, and keep unavailable routes registered for notification/reconnect refresh.
- Read folders for picking or moving through `createFolderList`
  (`queries/storage/folder-list`): it matches the Drive sidebar's source, so a
  folder open in Drive, including a team folder, is always in the list. Keep
  move rules in `folder-destinations.ts` so the picker and drop targets agree.
  Create one `createFolderDropTargets` per surface, not per row, so a long
  folder tree shares its folder list and mutation. Rows learn what a drag
  carries from `EntityDragSelectionContext`,
  which `SoupEntityContextMenu` provides; see
  [dragging rows into a folder](../../docs/agent-guide/navigation.md#dragging-rows-into-a-folder).
- Keep channel rail and title menus on `CHANNEL_ACTION_VIEW_CONTEXT`, including
  the shared desktop `Open in new split` action and its mobile/capacity guards.
  Rail splits open at latest before notifications load; only rows that stand
  for a notification (Home, Inbox) wait for it to choose a target.
- Gate the Chat redesign on desktop and phone with `enable-chat-sidebar-sections`; wait for its result and restore the original rail and Recent phone feed when off.
  Compose phone section navigation with the shared `PillTabs` after Favorites and before the conversation list, include the pills in the list's measured header offset, retain scrolling and active-pill visibility, and use dock Search instead of a separate Chat search control. Open custom-section settings by long-pressing its pill, not a separate more button; reuse grouped mobile filter sections and options in the settings drawer.
  Show Unread only as an always-visible toggle in the phone section drawer; omit Display and Unread when collapsed because phone sections do not collapse.
  Keep the original rail renderer and label dialogs in `components/rail/`; build the redesigned rail and section dialogs in `components/rail/next/`, with shared controller, context, and row primitives outside `next/`.
  Default desktop Chat to Favorites, Direct messages, the team's channels, custom sections, then All channels; preserve personal section reordering. Keep every joined public/private channel in All channels regardless of custom-section assignments.
  Hide section drag-handle icons; retain whole-heading drag-to-reorder and an icon-free reorder control in an out-of-flow wrapper revealed on keyboard focus without increasing header height. Preserve normal collapse clicks and exclude action buttons from dragging. Keep personal section order and route list navigation through the sectioned renderer's scroll handle, scrolling immediately with two rows of context clamped to the viewport.
  Default sections to their natural content height and the shared sidebar scroll area, ignoring saved heights without clearing them. Gate vertical resizing on `enable-chat-sidebar-section-resize`, off by default including development; when enabled, preserve personal heights, pane/content caps, independent scrolling, four-row Favorites/DM defaults, keyboard resize controls, edge-scroll compensation, and resize-only scroll-anchor suppression. Use TanStack Virtual for the section stack, channel rows, and search results; refresh nested row offsets from each section's measured start and size, not only total stack height, snapshot index-reconciled rows before keying by identity, ignore a row measured at an index whose key it no longer shows (transitions update keys before the rows on screen), and retain focused rows and drag sources.
  Keep New channel and New direct message on their separate existing creation flows, independent of the sidebar flag; size the sidebar's New dropdown to its trigger width.
  Use `--sidebar-gutter` for the outer section, DM, and search containers; shared headings and rows provide their own item padding.
  Indent section rows by 8px; style empty states like saved views with a padded, bordered surface and secondary actions, without the extra row indentation. Keep unsectioned search results unindented.
  Reuse shared collapsible section headers and their hidden-caret behavior without leading section icons; show people and funnel icons after shared and name-matched section names. Keep short name/sharing tooltips, full-row focus backgrounds, and no trailing header padding.
  Space sections with the stack's 2px flex gap, not header padding; wrap each section's header and content in one drop surface, show blocked drops with a not-allowed cursor and borderless explanation, omit rejection overlays while section data is pending, and keep Gantt's shared drag auto-scroll and wheel scrolling available while dragging.
  Animate section reorder with the shared layout animation engine; preserve unanimated measurement wrappers, reduced-motion preferences, and cancellation on scrolling. Show a card preview and subdued source while dragging.
  Name the team-channel section after the current team, falling back to Team channels while its name is unavailable.
  Keep every joined team channel in the team section regardless of custom-section assignments; use the same complete membership for bulk notification actions.
  Keep available channel rows visible on desktop and phone during section hydration and refetches; retain each by-ID batch's resolved rows while pending, discard snapshots when its account or membership changes, and key virtualized rows by stable IDs so updates cannot interrupt a click. Pass server-returned member IDs to `queries/channel/by-ids`, whose single Soup owner selects cached rows and fetches missing records. Keep entity-ID hydration generic in Soup, with channel identities, batching, and unread refreshes in the channel query layer; append per-section skeletons only while unresolved members load.
  Compile each by-ID batch's filter once per membership change and reuse it through loading and notification updates.
  Keep legacy `/channel-labels` and flagged `/channel-sections` queries in separate account-scoped caches; invalidate both after shared-storage writes and refetch authoritative memberships rather than patching explicit picks as effective membership.
  Show lock icons for private conversations and visible per-section options; keep empty sections usable as drop targets without an all-sections management menu.
  Create flagged sections in the shared section dialog after the initiating menu closes, append them before All channels without re-sorting existing sections, and reveal the new heading; use the same dialog for Edit section instead of separate rename and rule editors. Keep Only me/current-team visibility as exclusive checkbox choices. Pass the verified current team ID to desktop and phone sharing even when the team has no sections. Preserve the original dialogs when the sidebar flag is off, section identity during scope changes, complete membership eligibility checks, and one unsharing confirmation.
  Offer Add channels on editable manual custom-section headers and empty states through a height-bounded anchored picker with a full-width top search, scrollable results, and no visible title or description; retain joined-channel eligibility. Give empty sections a short explanation and adjacent primary/secondary actions, hiding editing actions without verified access. On phones, stack the shared selection body in `PickerSheet`, keep search focus while choosing, and apply only on Done.
  Combine section name and name-rule editing in Edit section on desktop and phone; show Name contains, a live match preview and count, and dimmed unjoined matches. Warn before replacing existing hand-picked channels and label the save action Replace channel list. Keep manual picks and name rules exclusive, block manual additions to rule sections, and keep preview queries reactive to the selected scope without reporting pending matches as empty.
  Keep per-section sorting and unread filters personal, and filter after membership assignment so hidden rows never leak into another section. Memoize the mobile section result and index effective member IDs once per evaluation; never scan the reactive member array for every conversation.
  Default Favorites to Custom order and persist drag reordering through the shared favorites mutation; preserve hidden and non-channel favorite positions, disable dragging under automatic sorts, show an insertion line at the actual destination edge, and keep the original rail unchanged. Retain pointer hit-testing coordinates until the drag sensor finishes so intervening scroll updates cannot discard a valid drop.
  Share section click and context menu controls with menu-local loading boundaries; use DropdownMenu.Content for click-menu roots and keep Mark all as read scoped to complete membership. Hide unavailable section edits and scope transfers. Name the personal filter submenu Display, retain trailing sort checks, and keep Unread only and default-on Unread when collapsed switches open when toggled. Supplement off-page unread rows only in collapsed groups whose Unread when collapsed preference is enabled; preserve expanded groups' page order.
  Compose the section click and right-click menus with `ContextMenuContent`, `MenuItem`, `MenuGroup`, and `MenuSeparator`; do not nest padded `Dropdown.Group` elements inside a context-menu surface.
  Keep all section mute, unmute, and snooze actions personal to the viewer; use the complete current membership, not filtered or hydrated rows, and never apply the change to later additions. With `enable-channel-notification-settings`, section mute and notification settings are instead stored on the section (`/notification_settings/sections`) and apply to later additions; All channels has neither. Resolve built-in membership through the complete channel list, including custom-section assignments and preserving participant checks; Favorites targets channel favorites only. Use the bulk item-preference endpoints and shared snooze picker, applying confirmed changes to the cache once and preserving successful chunks on partial failure.
  Use checkbox items in Add to section to toggle explicit membership within each scope without changing the other scope; show rule-only matches checked and read-only.
  Carry team IDs into channel entities and require a matching team for new shared-section assignments; preserve server-authorized membership display while metadata hydrates.
- Route supported move, trash, restore, permanent-delete, duplicate, and share-policy
  writes through `queries/storage/entity-mutations`; never retry failed GraphQL writes through REST. Preserve non-owner history removal
  and version-specific markdown forks on their existing paths. Confirmed restores
  clear earlier deletion markers without clearing a newer delete's intent; key markers and restore confirmations by normalized entity type plus ID, never by bare ID.
- Preserve loaded block content on initial access confirmation when its loader
  supplies no permissions; reload only on a later confirmed permission change.
  Apply shared access in place only after a successful permissionless load.
- Grouped Soup's `graphql/create-grouped-soup-live-query.ts` owns initial and
  continuation pages plus their local predicate projection. Group readers only
  delegate paging; pass the parent's live `groupedPaging` accessor from every
  caller, including Tasks and project-task lists. Do not introduce independent
  continuation owners. Rebuild refreshed continuation chains before replacing
  loaded rows; retain them on refresh failure and discard them on scope changes.
  Keep server
  membership snapshots separate from normalized field/link updates; restored
  properties do not prove prior membership. Supply complete prior multi-value
  memberships when adjusting counts: a row loaded in one bin may already be an
  unloaded member of another.
- Reconcile authoritative Mail first pages in the shared Soup projection adapter,
  not a UI exclusion list: invalidate contradicted facts within the supported
  page range without deleting normalized threads or treating backfill gaps as
  deletions. The OPFS revisit/reload regression is
  `bunx playwright test --config src/lib/graphql-cache/worker/browser-test/playwright.config.ts mail-reconciliation --project chromium`.
  For transient row flicker, run
  `bunx playwright test --config src/lib/queries/soup/graphql/browser-test/playwright.config.ts`:
  it uses the real Soup source and exchange, holds local/network completion,
  and asserts every observed row-ID state on revisits and an OPFS reload.
  It also verifies that cold empty Mail tabs stay loading until HTTP settles.
  It also runs in `just test-cache-wasm-browser`.
- Trace initial Soup loading through pending flow phases; aggregate incremental
  cache activity in `cache-activity-telemetry.ts`. Never start a root span per
  cache revision or choose a root by comparing no-op span identity.
- Reactive GraphQL reads use `createLiveQuery` for a document and
  `useSoupAstItemsQuery` (backed by `createSoupLiveQuery`) for Soup lists; see
  [choosing a reactive read](docs/graphql-normalized-cache-plan.md#choosing-a-reactive-read).
  Keep predicate failure recovery generic: bound stale reads, retain same-scope rows, hydrate only missing identities, and preserve revision/generation fences; projection selection must not change recovery policy.
- Reconcile cached Mail pages with same-query server membership; missing local
  previews are unknown, not proof that a fetched email left the inbox. Keep
  local pagination cursors independent of retained server rows. Preserve live
  flags alongside fallback previews; retained rows and legacy hosts still need
  mutation revalidation. Merge continuation pages through the indexed cursor.
  Never restore explicitly invalidated membership from an older view's snapshot.
- Sender filter writes and Undo return no per-thread classification. Refresh
  active GraphQL Soup readers with an email Importance predicate so their
  server pages reconcile Signal and Noise membership.
- Project calendar invitations from GraphQL Mail aggregate facts into the
  shared row flag so the Calendar invite facet also matches inline invitations.
- Render user-visible text in new UI, and every menu and navigation label,
  with `t()` from `@app/lib/i18n`, adding only the English to
  `src/lib/i18n/locales/en/`. The periodic `update-translations` skill fills
  in the other languages. See the [i18n rule](../../.agents/rules/web/i18n.md).
  The resolved interface language is reported to PostHog as the person
  property `interface_language` when the account language loads.
- When adding or changing a feature flag, follow the `feature-flags` skill.
- Gate routine template actions, pages, dialogs, and message cards on `enable-routine-sharing`; keep ordinary routines usable while it is off.
- Gate the Agent pings notification setting and its settings-search entry on `enable-agent-notifications`; the notification service refuses `notifications.send` for a sender under the same key.
- When adding or changing a view's feature tour, follow the `add-tour` skill.
- Keep Tasks date ranges on view-owned date-bucket boundaries in `features/tasks-view/core/task-due-date.ts`; send `sort_method=property` with the selected definition and direction, use keyed `date_ranges` grouping, and restart pages when midnight/timezone/resume changes the query key; preserve text-search ordering.
- Render Tasks due dates in an editable list-property column with a calendar icon for set dates and a slashed calendar for no due date; show only the icon on phones and narrow panes, preserve urgency colors for set dates, keep the current date visible in its dropdown, and limit warning urgency to today and tomorrow.
- Revalidate Soup queries whose selected sort/group property or date predicate matches an edited definition; compute loaded date-group movement in TypeScript, then refetch authoritative counts and unloaded rows. Keep property sorts and date filters out of the timestamp-only WASM projection.
- Keep REST grouped Soup item pools and `itemIds` keyed by raw entity IDs, matching Tasks readers and the normalized cache.

- Memory tool results use expandable rows on desktop and mobile; explicit preferences and activity reports remain inspectable after each tool call.

## Rules

- Channel Delete actions use the channel owner or admin/owner of the channel's
  exact team (`channelType === 'team'`); pass the channel's `teamId` to the team
  admin predicate. Keep rail/title menus, mobile long-press, and hotkeys on the
  shared delete action and bulk mutation. Preserve confirmed deletions when
  another item in the bulk deletion fails.

- Pass persistent touch row controls through `ListEntity.touchActions`; hover actions are hidden on touch, and the narrow inbox layout must retain the touch controls.

Conventions for this app live in `.agents/rules/web/` and load when you touch
matching files: data fetching, Solid reactivity, architecture, UI, UI primitives,
the startup bundle, Lexical nodes, and translated menu labels.

### Good Reference
- https://github.com/solidjs-community/solid-primitives
- https://github.com/kobaltedev/kobalte
- `src/features/entity`
- `src/features/channel`
- `src/features/block-md`
- `src/features/next-soup`

### Bad Examples
- `src/features/block-channel`
- `src/features/block-pdf`

## Whole-page restyle cost

A custom property written on `<html>`, a theme switch, or a root attribute
restyles every element, so CSS every element must be tested against multiplies
each of them. The build fails on such selectors (`scripts/costly-selectors.ts`,
checked in `vite.base.ts`):

- Set `::selection` on the element that defines its colors
  (`:root::selection`, `.onboarding-flow::selection`); Chrome's highlight
  inheritance carries it to descendants, and `no-highlight-inheritance` on
  `<html>` turns on the per-element fallback elsewhere
  (`core/util/highlightInheritance.ts`). A subtree whose `--color-ink` varies
  by element (`currentColor`) takes the `selection-root` utility.
- Give a `… *` walk an ancestor class outside a list: `.x *` or
  `:where(.x) *`, never `:where(.x *)`, `:where(.a, .b) *`, or Tailwind's
  `**:` (use `[&_*]:`). One class per `:where()` keeps zero specificity.

To measure, write `--probe` on `document.documentElement.style` in a
`requestAnimationFrame` and time `document.body.offsetHeight` right after;
on a 1,800-element channel this was 27 ms before these rules were rescoped and
10 ms after (dev build, Chrome). In a Performance trace the same restyle is
one `UpdateLayoutTree` whose `elementCount` doubles when a `::selection`
rule matches every element.

## PDF markup

Keep the signature canvas backing bitmap aligned with its CSS size and device
pixel ratio; keep dialog centering separate from animated transforms. Verify the
[signature walkthrough](../../docs/agent-guide/documents.md#pdf-signatures) after
changing this editor.

## Notes
- Don't shy away from pulling good examples into context. In the case of solid-primtiives/kobalte try reading documentation, or just temp clone into /tmp to reference

## iOS release signing

Follow [`docs/ios-releases.md`](docs/ios-releases.md) for App Store signing and
provisioning, including both extensions. The release script temporarily selects
manual export when a distribution certificate path is supplied.

## Native notification navigation

Android incoming calls use an opaque full-screen call screen, with the standard
Calls notification as the fallback when full-screen access is unavailable.
Keep notification Answer intents pointed directly at the call activity and scoped
to the offered call; active calls retain the drawer and PiP controls. See
`docs/development/android.md#native-calling` at the repository root.
Native call tracing retains the browser telemetry gate and exporter for cold
calls; propagate W3C context through push payloads, notification intents and
ring-status requests, and keep caller names, tokens and URLs out of spans.

Read iOS's durable pending tap before mounting the router, then choose its
destination only after the authenticated account matches `recipientId`. Keep
the native receipt pending until the destination route is applied; release the
native cover for auth/retry UI without consuming the receipt. That cover exists
only while a tap is pending: on a tap that arrives while the app is not active
or its page has not booted, or a page load that boots into one. A tap on the
active, booted app navigates in place, and backgrounding never covers the app.
Use the existing
pending-notification intent for bootstrap and live taps so newer taps supersede
older work. Older native builds and pushes retain authenticated notification
lookup. The local bridge and native release requirement are documented in
[`docs/ios-releases.md`](docs/ios-releases.md).

Cold channel push launches retain Home behind the target channel so the mobile
header Back control and swipe-back have a destination. Keep this launch layout
in `notificationLaunchPath`; warm taps retain their current pane stack.

Bound the pre-router bridge handoff to 1.5 seconds and release the native cover
on failure or timeout without consuming the pending tap. Late responses must
use normal account-checked navigation, never reset the mounted router's hash.
`notification.launch` records whether startup continued ready, failed, or timed out.

Bound the native cover to eight seconds for each received durable tap, including
warm resumes and stalled route acknowledgments. Release without consuming the
intent on timeout; duplicate delivery must not extend the deadline, and a newer
tap gets its own deadline. Convert fallible notification lookups and navigation
promises into error results so failure cleanup acknowledges the tap and shows
the existing error toast. Keep the startup cover fallback in the same owner,
and let it defer to a pending tap's deadline. The deadline requires responsive
JavaScript and IPC; it cannot recover a frozen WebContent process.

Open sheets and touch dialogs close when the app navigates, as a scrim tap
closes them (`createCloseOnNavigation` in `MobileDrawer` and `Dialog`): when
the active pane shows another view (a link, an agent, the dock, Back), and
before a notification tap navigates, since it may land on the page already
shown. A search change (filters) or a pane adopting its content's real id
keeps the view, so those sheets stay open; so does a sheet the destination
opens on arrival, and an owner that refuses or confirms a close still does.
A detail opened inside the same view (a tablet's inline preview) is not a new
view, so its list's sheets stay. Phones keep the pane behind mounted for
swipe-back, so without this its sheets stayed over the new page. Opt out with
`keepOpenOnNavigation` only where dismissing does something the user didn't
choose: the incoming-share sheet (discards the shared files) and the push and
iPad prompts (record the prompt as dismissed). The
backend-free phone and tablet regression drives the real pane stack, router and
notification tap path with simulated native IPC:
`bunx playwright test --config src/components/app/mobile/navigation-browser-test/playwright.config.ts`.

The frontend cover deadline has a backend-free phone browser regression:
`bunx playwright test --config src/lib/tauri/browser-test/playwright.config.ts`.
It uses the real navigation intent and push API with simulated native IPC;
UIKit presentation still requires an iOS device or simulator.

Generate APNs validators with `scripts/generate-api-schema.ts`; its compact
`generated/push.ts` entry avoids importing every notification-service schema
on the startup path. Carry known channel root IDs in push navigation (a null
`threadId` means the message itself is the root), prefetch the target window
alongside channel metadata, and keep the shared Macro loading indicator visible
until that target can be positioned.

## macOS notification activation

Carry the notification ID through native delivery and the buffered `navigate`
bridge, so clicks survive app restarts and wait for the split layout to be ready.
Install and retain the UserNotifications delegate before the native event loop
starts. Clicking restores and focuses the main window; receipt and dismissal do
not navigate. Preserve iOS and Android `createPushApi` tap navigation when changing
desktop delivery, including buffered launch taps before device registration.
Send the sender and conversation as their own fields so macOS can show a
communication notification (avatar, sender, conversation); keep new native
arguments optional for OTA compatibility. Releases need the Developer ID
provisioning profile for the communication entitlement; see
`tauri/src-tauri/README.md`. This requires a native macOS release; see the
[notification walkthrough](../../docs/agent-guide/notifications.md).

## Desktop page zoom

The desktop app binds `Ctrl/Cmd` with `+`, `-`, and `0` itself in
`src/lib/tauri/zoom.ts`; nothing underneath provides them. Wry's
`zoomHotkeysEnabled` is Windows-only and Tauri's default menu has no zoom items.
The hotkeys call the webview's `setZoom`, which needs
`core:webview:allow-set-webview-zoom` in `tauri/src-tauri/capabilities/desktop.json`,
so a build without that permission fails the call at runtime. That permission
lives in a `desktop`-named capability rather than `default.json` because the iOS
and Android native gates hash every file under `tauri/` whose path doesn't name a
platform: editing `default.json` would demand a store release for a command that
only exists on desktop. The saved factor is
re-applied on launch because the webview always starts at 100%. `RootFrame`, not
`GlobalHotkeys`, registers them, so zoom also works on pages without app chrome.

## Desktop file drops

Keep `app.windows[].dragDropEnabled` false in `tauri/src-tauri/tauri.macos.conf.json`.
Markdown editors and attachment inputs use browser events through `fileFolderDrop`
and `fileDrop`; Tauri's native handler intercepts Finder drops before those handlers
receive them. This config change requires a rebuilt macOS app; a frontend bundle
update alone does not apply it.

Tauri replaces arrays when merging platform configuration. Keep the other macOS
window settings aligned with `tauri/src-tauri/tauri.conf.json` when changing the
shared window. Verify with the [Finder-drop walkthrough](../../docs/agent-guide/documents.md#desktop-file-drops).

## Subscription offers

Use `useTrialEligibilityQuery` for trial copy and checkout terms in Billing,
paywall, and onboarding. Never infer first-subscription eligibility from Free
access or legacy `hasTrialed`; show trial copy only for confirmed eligibility,
and keep Pro checkout disabled while eligibility is unknown. Refresh the offer
on focus/reconnect; route existing subscriptions to billing management. Keep
known management access through refetch failures, but hide unconfirmed trials.
Reset rejected checkout offers before refetching eligibility.

## Native commands

Over-the-air bundles reach native apps older than the commands they call.
`native-commands.json` lists every Tauri command the web code invokes directly,
through a wrapper such as the cache host's `request`, or by `addPluginListener`.
`src/lib/tauri/native-commands.test.ts` reads the calls with the TypeScript
parser and fails when one is missing from that list, is not registered by the
app (`generate_handler!` or an in-repo plugin's `build.rs`), or names its
command with a value it cannot read: use a string literal, a constant, or a
parameter typed as a union of literals. Commands that published plugins' own
JavaScript packages call are not covered. Before adding a command to the list,
raise `min-native-build.json` to the first build with it, or handle
`Command … not found` in the caller (see the src-tauri README).
Keep phone call audio-output commands optional for older native binaries, register their mobile capability, and fence route updates by call ID.

## Desktop release builds: generated WASM

Keep `nix/tauri-desktop.nix` in sync with generated WASM dependencies: desktop
releases run Vite directly and do not call `just build-tauri` or `build-wasm`.
A new `build-*-wasm` package under `src/lib/core/` gets an entry in
`coreWasmPackages`, which builds its JavaScript glue and WASM before Vite runs
and checks that both appear in the output. Without them, Vite leaves the
loader's relative imports unchanged and Tauri serves HTML for the missing
module, so that file type fails to open on desktop.

## Videos stay out of native bundles

Vite writes imported videos (`.mp4`, `.webm`, `.mov`) to `dist/web-hosted/`,
which the web deploy publishes and every native bundle deletes: `build-tauri`,
`build-tauri-dev`, the OTA archive (`infra/stacks/web-app`) and the desktop
derivation (`nix/tauri-desktop.nix`). Pass a video import's URL through
`webHostedUrl` (`@core/util/webHostedUrl`) so the apps load the web deploy's
copy; a bare import 404s in a native build. Retained-build pruning keeps
`web-hosted/` for apps stuck on old bundles. `scripts/web-hosted.test.ts`
checks the routing and every deletion. Bundled, the tutorial videos alone added 105 MB
to each app binary and OTA download.

## macOS desktop runtime: Chromium (CEF)
`tauri/desktop-cef` builds the shipped macOS app with Chromium in its own Cargo
workspace. The macOS release DMG builds this workspace; iOS, Android, Linux,
and Windows still build `tauri/src-tauri` on the system webview. See
`tauri/desktop-cef/AGENTS.md` before changing Tauri
dependencies or the app's served origin.

## iOS gotcha: Web Workers must be lazy
On iOS WKWebView, eagerly constructing an ES module Web Worker (`new Worker(url, { type: 'module' })`) whose script is served via the `tauri://` custom URL scheme **deadlocks the WebContent process**. The worker thread parks in WebKit's sync module loader waiting for an IPC response that never wakes it; JS execution silently stops after that point.

Vite serves all workers as ES modules in dev mode regardless of `worker.format` config (that setting only applies to `vite build`), so you can't fix this at the bundler level for dev.

**Rule:** never call `new Worker(...)` (directly or via `?worker` import) at module-load time in code that runs on iOS. Worker construction must happen on first use. For singletons backed by a worker, use a lazy proxy:
```ts
export const svc = new Proxy({} as Service, {
  get: (_, p, r) => Reflect.get(Service.getInstance(), p, r),
});
```
The `import Worker from './w?worker'` import itself is harmless — only `new Worker()` triggers the deadlock.

**Symptom signature:** app loads HTML and runs initial JS, then JS silently stops. Safari Web Inspector attaches but shows nothing.

**How to diagnose this class of freeze:**

1. **Reproduce on the iOS Simulator, not a physical device.** `cargo tauri ios dev "iPhone 15"` (replace with whatever sim you have booted). The Simulator's logs flow through your Mac's unified logging, so you can stream them with `log stream` instead of fighting `idevicesyslog` / Apple's developer-tunnel requirements.

2. **Stream the app's logs in one terminal:**
   ```sh
   /usr/bin/log stream --predicate 'process == "macro"' --info --debug --style compact
   ```
   Use the full `/usr/bin/log` path — zsh shadows `log` as a builtin and silently misroutes the call. Leave this running across rebuilds; the filter is by process name so it survives app relaunches.

3. **Find the last meaningful event before silence.** Tail the log file and skip the noise:
   ```sh
   tail -200 <logfile> | grep -vE 'tauri:// request|tauri_protocol.rs|^\s*\\134'
   ```
   If you've added a `tracing::info!` to log every `tauri://` request in the protocol handler, look for the **last** such request — that's the file the WebView was loading when it froze.

4. **Confirm the WebContent process isn't spinning.** Get its PID from any `[com.apple.WebKit:...] [...PID=N...]` line in the logs, then:
   ```sh
   ps -o pid,pcpu,comm -p <pid>
   ```
   `0.0%` CPU + still-alive process = parked, not infinite-looping. That distinguishes a deadlock (waiting on IPC/lock) from a hot loop (something busy).

5. **Sample the WebContent process to see where threads are stuck:**
   ```sh
   sample <webcontent_pid> 3 -file /tmp/sample.txt
   ```
   Then look for threads named `WebCore: Worker`. If their stacks show:
   ```
   WorkerOrWorkletScriptController::loadModuleSynchronously
     → WorkerDedicatedRunLoop::runInMode
       → Condition::waitUntilUnchecked  ← parked here
   ```
   that's the worker module-load deadlock. The main thread will typically be in `mach_msg2_trap` (idle in run loop) with some `IPC::Connection::enqueueIncomingMessage` → `LockAlgorithm::lockSlow` showing lock contention.

6. **Cross-reference the last URL request with the stuck thread.** If the last `tauri://` request was `*-worker.js?worker_file&type=module` and a worker thread is in `loadModuleSynchronously`, you've confirmed which worker is the culprit. Then trace back to where it was constructed (`new Worker(...)` or a `?worker` default export being instantiated) and make that lazy.

Don't get distracted by red herrings the logs will show: `NSKeyedArchiver` main-thread fault, IPC throttling warnings ("N pending incoming messages"), the bundle updater's failed `localhost:3001` request — all are downstream symptoms or unrelated noise.

## iOS gotcha: a device tap fires `mousedown` even after `pointerdown.preventDefault()`
On a physical iPhone, WKWebView still synthesises the compatibility `mousedown`/`mouseup` for a tap whose `pointerdown` was cancelled. The spec, Chrome, and the iOS Simulator all drop those events, so the difference only shows on real hardware. The synthetic `mousedown`'s default moves focus to the tapped element's nearest focusable ancestor — a `<button>` is not mouse-focusable on iOS, so focus lands on whatever container carries a `tabindex`, e.g. the block element a popup is portaled into. A focused contenteditable then fires `focusout`, the software keyboard hides, and anything keyed off editor focus (the md selection popup) closes. The DOM selection survives the blur, so actions that read it (Copy) keep working and mask the bug.

**Rule:** UI that overlays an editor and must not steal its focus (toolbars, popups, paging chevrons) cancels both `pointerdown` and `mousedown`, on the container root rather than per button so dividers and gaps are covered too. See `keepEditorFocus` in `src/features/block-md/component/TouchSelectionToolbar.tsx`.

**Symptom signature:** works in Chrome mobile emulation and in the iOS Simulator, fails every time on a physical iPhone regardless of tap accuracy; the keyboard dismisses on the tap.

**How to diagnose this class of bug:**

1. **Don't reason from finger precision.** A deterministic device-only failure is an event-model difference (compat mouse events, software keyboard), not a near miss.

2. **Add a temporary window-level event trace.** Log `touchstart`, `touchend`, `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `click`, `focusin`, `focusout` and `selectionchange` with `event.target`, `event.defaultPrevented`, `event.relatedTarget` and `document.activeElement`. Register on `window` in the bubble phase so app handlers have already run and `defaultPrevented` is meaningful. Wrap the setter that closes the UI to log a short stack (`new Error().stack`). Prefix every line (e.g. `[md-popup]`) so it can be filtered.

3. **Run it on the device, not the Simulator**, with Safari Web Inspector attached (Develop → the iPhone → the Macro webview), filter the console by the prefix, reproduce, and read the order. A `mousedown` arriving after a `pointerdown` logged with `defaultPrevented: true`, followed by `focusout` whose `relatedTarget` is a container, is this bug.

4. **Strip the instrumentation before committing.**

## iOS gotcha: a detached file input loses its picker's result
WebKit drops a file picker's result when it garbage-collects the `<input type="file">` that opened it, and nothing keeps an input created with `document.createElement` alive unless it is in the document. The iOS app's photo and file pickers stay open long enough for that, so the pick vanishes with no `change` and no error. Keep the input in the document until `change` or `cancel`, as `fileSelector` does. Check it in the iOS Simulator by sending `Heap.gc` over the Web Inspector protocol while the picker is open.

## iOS gotcha: WebKit never collects a stream its own callbacks can reach
In WebKit, a `ReadableStream` or `TransformStream` whose `start`, `pull`, `cancel` or `flush` callback can reach the stream is never garbage-collected, and neither is anything else those callbacks can reach. Chromium collects it. Reaching includes the scope the callbacks were made in: every closure made in one function call shares that scope, so a callback made beside `const clone = response.clone.bind(response)` holds the response without mentioning it. The published `@tauri-apps/plugin-http` `fetch` has that shape, which kept the `Response` object of every native request alive for the life of the page on iOS, read or not.

The stream's JavaScript object, on the other hand, is collected while a `Response` built from it can still be read. A `FinalizationRegistry` that watches the stream therefore fires too early; watch an object that only the stream's callbacks hold.

**Rule:** make a stream's callbacks in a function of their own that receives only what they need. They never refer to the stream, to its `Response`, or to a closure that holds either. The HTTP plugin's JavaScript patch under `patches/` is written this way so that it can release a native response the page dropped unread; carry it over when the package is upgraded. Its callbacks still hold the abort signal the caller passed, so a listener a caller adds to that signal must not hold the request's response either.

**How to check:** unit tests cannot see this, because Node collects like Chromium. In the iOS Simulator's webview, register the object with a `FinalizationRegistry`, drop it, send `Heap.gc` over the Web Inspector protocol a few times, and see whether the callback ran. Check the built bundle, not only the source: a minifier that inlines the function puts the callbacks back in the caller's scope.

### Agent session failure indicators

Use the red five-dot × for persisted failed turns in the redesigned desktop
Agents list; keep Home and the legacy phone list on their existing `bg-failure`
status dot. Open the session to inspect its error.

### Agent transcript projection

Key transcript rows by the fold's `FoldedMessage.key` (`<turn>:<author kind>`);
never rebuild it from `turn` and `author`. Apply a load or rebase as one keyed
`reconcile(messages, { key: 'key' })`, without `merge`. A streamed message
reconciles the tail row in place or writes the next index; only an out-of-order
one takes the keyed path. Never `produce` the whole array per append; it makes
initial projection quadratic. Check with the
[session-open runner](src/features/block-agent/browser-test/README.md).

### Agent system events

Agent activity labels share `block-agent/ui/TextShimmer.tsx` and the global
`magic-chip-shimmer` style; keep Working and Thinking on the same sweep and phase.

Accept `notification` in both fetched and subscribed GraphQL session log rows.
System notifications live in fold metadata, separate from messages. Review
subjects refresh their existing card; other subjects render quiet timeline rows
through `block-agent/components/session-event-row.tsx`. Match typed event
payloads exhaustively, summarize outcomes without draft content, and keep the
icon, truncated summary, timestamp, and optional subject action on one line on
desktop and mobile.
Keep Responding bound to the notification turn, including rejection and noop.
Harness background-task reports are `task_notification` message parts, rendered
as `ActionLine` rows in the agent reply (`TaskNotificationPart`).
The backend-free desktop/mobile check is
`bunx playwright test --config src/features/block-agent/browser-test/playwright.config.ts`.
The same suite covers stopping and reloading an agent reply inside a mention:
keep incomplete trailing Macro XML hidden in settled agent prose, preserve
completed chips and literal tag examples in Markdown code, and leave user prompts
unchanged.
Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when using the Nix Chrome binary.
The same suite opens a tool group in the real `Transcript` while a reply streams
below it (`transcript.browser.e2e.ts`): the press must land and the group must
stay put, which `ThreadList`'s `holdOnDisclosure` provides.

Reuse the responsive import review for Notion, Linear and Jira; scope report
queries and cancellation to the saved draft source. Issue tracker handoffs
call the reviewed workspace tools, and show separate task/project totals.
Desktop shows every import run in the corner's import tray
(`features/import-jobs`, in `ToastRegion`), independent of the import dialog
and never on phones. Its backend-free check is
`bunx playwright test --config src/features/import-jobs/browser-test/playwright.config.ts`.

### Agent backend hosting

Cognition, routines, preview control, and MCP share `agent_harness_service`.
Agent replies can use the existing `m-document-mention` format with
`blockName: "routine"`; the `@` menu offers routines only to their owner in
channel composers, where picking one shares it as a template.
Macro `/app` links in agent replies (transcripts and agent channel messages)
open in a new split like mention chips: `AgentReplyLinks` provides the opener
that `LinkWithPreview` consults before `openExternalUrl`; keep other surfaces'
links on `openExternalUrl`. Covered by
`split-layout/split-router/agent-reply-links.test.tsx`.
Direct local hosts use port 8101 with the existing feature prefixes; the
instance proxy retains `/cognition`, `/scheduled-action`, and `/preview`.

## File downloads

Channel videos, linked video previews, and Drive video/image/code/canvas/unknown previews share
`createFileDownload` and `FileDownloadButton`. Keep menu and visible controls
bound to the same controller. Call recording menus and the list-row Download
(`makeDownloadAction`) use the same controller; the list action runs it under
its own root, because choosing a context-menu item disposes the menu's owner.
Download hands off directly to browser downloads
or the native save picker. Show channel Download on hover or keyboard focus,
always on touch, without a footer. Keep system Share inside the touch Download
menu; desktop Share belongs to Macro permissions. Do not add a custom
confirmation sheet. Snapshot file/version before loading, cancel on disposal or
selection change, and preserve original filenames from static-file metadata.
Native Android and iOS use bounded byte exports. Older iOS binaries use Web
Share until the optional file-export bridge ships. If browser activation expires
while preparing a share, retain the bytes and let the same action's next tap
open the system sheet synchronously. Browser success means handoff, not confirmed
disk completion. See the native bridge's `tauri/file_export_plugin/AGENTS.md`.
Keep download confirmations title-only and lightbox Download controls icon-only.
Keep the expanded video first in the dialog's tab order so initial Space presses
control native playback; restore focus to its opener on close.

The backend-free browser regression downloads real fixture bytes from channel
cards, the expanded viewer, and the shared Drive/standalone header on desktop,
phone, and tablet, and checks Space playback on opening and reopening the viewer:
`bunx playwright test --config src/lib/core/component/FileDownload/browser-test/playwright.config.ts`.
See the [download walkthrough](../../docs/agent-guide/files.md#downloading-files).

## Macro computers

### Claude access

Computer rows show the Claude mode (`Signed in with Claude` on the computer's
own account, never its email) from `claude-mode` for managers, and the harness list's derived
`claude_mode` for other members. Sign-in is a dialog
(`claude-sign-in-flow.tsx`) that starts the sign-in on open. Once the link
has arrived, Open claude.ai is a plain `target="_blank"` link; never open it
after an await. Until then it is a button: a browser opens a blank tab within
the click (`reserveOauthPopup`) and points it at claude.ai when the link
arrives, while the desktop and phone apps, where that tab would land blank in
the system browser, open the link once it arrives. The backend also requires management rights for Claude account changes.
Focused tests: `bun run test src/features/settings/computers`.

Buy (one dialog with no steps: waiting until the computer is up, then its
agent's Ready and Chat with it;
a declined card and a size with no room in place) and the guided variant (the
Buy computer → Configure agent → Bring your AI → Create agent dialog, opened
with `?after=guided` in the fixture) have a backend-free browser regression that mounts the real section
over the real computers client and answers `/auth/team/computers/*` from
Playwright, covering the size skeleton, every step, each offers failure (422,
403, 502, 503, dropped connection, timeout), and the two endings (Chat with <agent> into
the agent's DM, Add another agent into the real create form with the computer
chosen), and the setup notices (close
after Buy, the "ready" notice reopens the dialog on Bring your AI through to
Create agent; the failure notice reopens it on Retry setup) on desktop and
phone:
`bunx playwright test --config src/features/settings/computers/browser-test/playwright.config.ts`.
Set `COMPUTERS_SCREENSHOT_DIR` to also save each step's screenshot there; the setup
notice test then also records a video of its path (`test-results/*/video.webm`).

Use the existing Billing route's `SubscriptionStatus.billing` for actual seat,
computer, total and next-invoice amounts; never calculate a bill from catalog
quotes. Format provider minor units using currency precision and Stripe's
ISK/UGX wire-format exceptions.
`TeamBillingBreakdown` renders provider lines behind `useMacroComputersRollout`; a
null breakdown keeps the existing plan and computers UI. With the flag off the
backend returns no breakdown and the page shows only the plan.

Reuse `PriceBreakdown` for Macro computer purchase and
subscription billing: item/spec subline/amount, divider, total and billing note.
Keep included rows visible, use GiB throughout, and size confirmation/release
dialogs to content. Billing renders each computer once and uses provider amounts;
show a differing catalog price as context without replacing a subscribed charge.

### Capacity

Computer offers expose `soldOut` availability. Use generated auth types. Show `waiting_for_capacity`
as a capacity wait with its translated hint in Runtimes and Billing, including
on mobile; retain power controls and polling while waiting.

## Interface icons
- Task rows, property values, document mention pills, and @mention menu rows use `TaskStatusIcon` with the current status property; use the task subtype completion flag only when a recognized status is unavailable. Task lists edit status and priority through leading `TaskPropertyControl` icons before the title, not duplicate columns or trailing pills. Mention pills show status only in that leading icon, not again among the trailing task badges. Keep generic navigation and creation on the custom checked-square task icon, independent of task state.
- Read [the icon system rules](src/components/icon/system/README.md) before adding or changing interface icons. Reuse the original Macro SVG family via individual `@icon/system/...` imports; do not introduce another icon set.
- If a glyph is missing, author original SVG geometry on the 24-unit grid with round caps/joins, restrained detail, `currentColor`, and the documented theme-aware weight. Never trace or import proprietary symbol paths. Match active/bold variants and review 14/16/20/24 px in light and dark mode.
- Interface glyphs never animate on press or hover; do not add shared or per-button bounce, turn, or scale effects. Disclosure carets and loading spinners keep their state-driven motion. Preserve accessible control names.

### Creation choices and notifications

- Reuse `CreateMenuItem` for explanatory New menu entries (`CreateMenuRadioItem` when a create dialog picks a type in a `Dropdown.RadioGroup`): original icons, a title, and muted wrapping descriptions, preserving the existing `ViewCreateButton` trigger and each action's feature gates.
- Keep transient toasts in their bounded stack and persistent prompts/reminders in separate regions; preserve keyboard dismissal, full mobile descriptions, and remaining-time pause on hover/focus. Mobile toasts dismiss by swiping left or right and have no corner close button. Phone prompts stay in their own stack under the modal layer, never on `z-toast-region`, and never hide with a document-wide `:has()` (#8840).
- Notification sounds are off by default and saved per user per device; map each new notification event in `features/notification-sounds/core/categories.ts` and keep system alerts silent when Macro plays its own sound. Quiet hours on the same page silence those sounds and skip desktop alerts on a per-device weekly schedule; incoming calls still ring. See the [notification sounds walkthrough](../../docs/agent-guide/notifications.md#notification-sounds).
- Keep browser-call join/leave cues on explicit visit announcements, never RTC roster diffs; recovery must stay silent. Their fixed two-note chimes use a default-on Call sounds toggle and share notification volume and quiet hours, not the default-off notification switch. See [call sounds](../../docs/agent-guide/calls.md#join-and-leave-sounds).

### Agent result task lists

Agent result task titles wrap above live metadata; nested horizontal groups
stack below 672px of container width. The backend-free browser regression is
`bunx playwright test --config src/features/dynamic-ui/browser-test/playwright.config.ts`.
It covers desktop and touch layouts, narrow containers inside a wide viewport,
unbroken titles, and keyboard opening.

### Inline property values

Inline property fields stay `readOnly`, never `disabled`, while they save: a
browser moves focus off a disabled field, so a failed save would strand it. Enter
and Escape return focus to the value through `Property.Root`; tabbing or clicking
away leaves focus where the user put it. The backend-free regression is
`bunx playwright test --config src/features/property/editors/inline/browser-test/playwright.config.ts`.

### Assignee people scope

Use only the current team roster and available agents for new Assignee selections.
Keep initially selected outsiders visible and removable, and allow them to be
re-added while the record stays mounted, without contact discovery.
Reuse the existing selected-first ordering at opening and keep row positions
stable while selecting. Keep the generic roster hook in `src/lib/queries/team/members.ts`.
Preserve each picker’s existing placeholder, sizing, and row styling.
Preserve filter-only Me/Unassigned choices, company-owner scope, and unrelated
people/contact fields.
Keep the shared filter Assignee picker in `src/features/soup/assignee-picker.tsx`;
import it directly from Tasks and legacy `next-soup` consumers.
Keep entity-picker navigation on its search input, before the enclosing menu handles the key.
Order assignee menus and @ mention People rows with `@core/user/people-before-agents`:
you, other people, then agents with Macro first. @ menus pass `mention: true`, which lists
Macro above everyone and keeps it first while its name starts with the query. While
searching, rank with `NAME_MATCH_RANKING`; an agent needs the typed words, not scattered
letters, and never ranks above a person who matches as well. Cap a list's people (`capPeople`), never its agents, and
don't boost bots in a menu's search score. Until the contact directory answers for the
first time after it opens, a directory-backed @ menu lists only the rows that lead every
person (Macro) and keeps its People preview's rows as loading rows (`holdsRows`; in a menu
with other sections also when no agent matches, `peopleHolding`), holding the highlighted
row meanwhile; phones list nothing below them yet. On desktop, Booking Links, which arrive
from the network, are a section below People; phones pin People rows above the rest. The hold ends at `UNANSWERED_SEARCH_LIMIT_MS`, when
Cmd+K stops saying "Searching…". The held rows stay blank for `LOADING_ROWS_DELAY_MS`
before they shimmer, so an ordinary open shows no loading state. The menu's directory
read gives the cache `PEOPLE_CACHE_BUDGET_MS` (`peopleLocalBudgetMs`), then reads the
server's window once for that query. A typed search's rows keep the order that window
gives them (the people the text names first; see the server page ordering under Development
Patterns), a browsing page's rows are ranked by the menu, and neither is re-read on cache
changes, so the cache answering later never reorders them. The menu
reads a failed people window again once by itself, holding the rows meanwhile, and
offers Retry when that read fails too or a read is still pending when the hold ends
(`peopleFailed`): People never disappears without saying why.

### Tag picker selection and creation

Keep tag checkbox toggles open for pointer and keyboard input; desktop row picks
save the staged selection and close only the picker, while touch sheets retain
explicit Done. Keep the parent More menu open after a tag pick or Escape, and
prevent reopening the picker until its pending selection save settles. Dismiss
the parent only when opening the tag editor or navigating to tagged items.
Return from sharing to color to name with Back or Escape, preserving the draft
and chosen color; native Back-button activation must not advance the flow.
Keep tag-creation headers compact beside Back and show the current draft color
beside the title throughout the color and sharing steps.

### Sidebar tag dragging

The shared sidebar-tag fixture covers dragging tags onto taggable desktop rows.
Keep existing tags and apply to the selected rows when the drop row is selected.
Use the shared scoped drag helpers and overlayIcon for the tag chip.
The backend-free browser regression is
`bunx playwright test --config src/features/property/tags/browser-test/playwright.config.ts`.

### Senders in email rows

Sender names in Mail rows and collapsed thread messages keep their person card
on hover; clicking the name or anywhere else on the row opens the email.
`HoverCard` keeps the portal's placeholder inside its own `display: contents`
wrapper: opening or closing the card otherwise changes the trigger's siblings,
Solid can then detach and reinsert the trigger, and a press that closes the
card loses its click. Cards opened from a row use `isolateClicks`, because
Solid delivers portaled events through the component tree and a click on the
card would also open the row. On touch, a collapsed message's picture lets the
tap through to the row. The backend-free desktop/phone regression, over rows
with two senders, is
`bunx playwright test --config src/features/entity/browser-test/playwright.config.ts`.

### Enter on a property pill

A document control owns Enter unless a press focused it, including one given
focus back when a mouse dismisses its picker. Tab reaches an editable pill
directly; its hover card keeps a stop only on read-only values. Real focus
heuristics decide this, so jsdom can't cover it. The backend-free browser
regression is
`bunx playwright test --config src/features/property/browser-test/playwright.config.ts`.

Use `features/channel/channel-icon.tsx` for conversation identity in rows,
favorites, and headers: channel pictures or hashtags, human/self-DM avatars,
and bot personas share one renderer; keep surface sizing in the caller.

- Advertise Mail v5 capsules only for the current browser engine or a verified supported installed native build; OTA bundle version alone cannot establish native capability.
- Bound native Mail capability discovery to 1.5 seconds and cache the legacy profile on failure or timeout so stalled IPC cannot block GraphQL transport; record the selected profile and bounded outcome in HTTP and WebSocket setup spans without error text.

### Inline comment drafts

Use `MessageLoadError` for compact discussion/thread failures; missing resources
show an unavailable state without a retry action or composer.
Compose phone project, task, and company Discussion entries with `src/components/discussion/`; keep their existing conversation sources and desktop inline threads, and use opt-in `MobileDrawer` snap points with `FixedContent fitSnapPoint` and `KeyboardFooter` for half/full sheets with a pinned input; leave other drawers' sizing unchanged.

Keep collaborative drafts as cursor-based overlays outside the shared editor tree.
Flush pending text, catch up missing server history before publication, then
publish the mark from an isolated peer with `PeerCommentUpdate`,
and post the message only after acknowledgement. Refused operations never enter
the editor's WAL, so a session without edit access writes nothing to Loro, not
even state its editor derives; only editors remove a deleted comment's mark.
Preserve input on failure. Cancelled publications retry mark
cleanup from the user/document-scoped IndexedDB queue; preserve marks when a
message request's outcome is uncertain. Keep failed cleanup entries queued without
blocking later entries. Overlapping comments must retain each
saved range through cancel, save, and collaboration updates.
Comment controls preserve editor focus on both pointerdown and mousedown.
The backend-free browser regression is
`bunx playwright test --config src/features/block-md/comments/browser-test/playwright.config.ts`.
It exercises selection, press, cancel, retry, and repeated posting in editor and
commenter modes. The collaboration fixture includes concurrent remote edits,
rejected updates, and a server that refuses a commenter's non-comment updates; provider tests cover message metadata arriving on either side
of posting, multi-paragraph anchors, saved ranges, and cancellation during posting.

## Performance

### Tracing

- Instrument loading with the flow API in the `instrumentation` skill; read the
  traces with the [observability guide](../../docs/agent-guide/observability.md#web-performance-traces).
  Tracing observes readiness; never drive app behavior from trace callbacks.
- Keep document load, snapshot and editor phases under the routed view flow and
  pass its span explicitly to sync/AI clients; never store spans by document id
  or end caller-owned spans in collaboration code. Acquire agent sessions in the
  active view span.
- Put flows at the shared owner so every host inherits them: Soup status in
  `SoupViewListContent`; channel tabs in `ChannelTabProvider`, with each host's
  `channel.*.view` inside the panel's Suspense and the routed detail observing
  `detail.view().status` as `channel.detail`; form tabs and panels in
  `FormPageView` (keep its builder/layout session alive across tabs); form
  responding (`view.form-respond`, `form.submit`) keyed on form and preview
  mode; CRM detail in the shared company/contact views keyed by record and
  section; Command-K input through `beginInteraction` and a query-keyed results
  flow with debounce/source `usePending` phases, no manual per-input signals
  (the universal-input browser suite checks the exported traces).
- Cancel the form-submit measurement on teardown but let its in-flight save
  finish; late completion must not scroll or measure another view.
- Runtime resource samples and typing bursts use the `perf` class decision
  (`Telemetry.config.sampled('perf')`) and the shared UI-operation observer: no
  second observer, no per-key frame sampling, no listeners for unsampled users. Typing surfaces come from
  static `data-input-surface` categories on editor/field owners, never caller
  labels.
- Keep record names, addresses, answers and query text out of attributes.

### Entity rows

- Keep `ListEntity` layout fields independently reactive (getters, not a
  dynamic object spread); a spread makes a selection change revisit every
  unrelated layout input. Profile with the
  [entity collection fixture](src/features/entity/browser-test/README.md).

### Passwords

Keep agent-request loading and read failures inside the item pane using shared
skeletons and local Retry; after a stale decision, hide cached actions until a
successful refresh. Team inbox groups are notification-only: show only valid
password requests for the current team while Passwords is enabled, and open
the request's vault target without a generic Team preview or fallback page.

The flag-gated `/passwords` route mounts `features/passwords` with its team-scoped
source; the rail and phone dock show it only for team members (flag and team).
Keep field values and drafts outside query caches and browser storage; drafts
live in the vault primitive's in-memory store, and lock, blur and hidden tabs
only conceal revealed values, never drafts. The vault is keyed by account,
sign-in session and team: a scope change remounts it and aborts its requests,
so drafts and late responses never cross viewers. Load and copy usernames
through their field-scoped endpoints, and derive sharing counts from metadata.
Toggle private favorites with their PUT/DELETE endpoint for every viewer, using
an optimistic update in the account/session/team cache and rollback on failure;
never route a star through the credential metadata PATCH. Keep the form Favorite
checkbox creation-only; existing items use the detail star.
Compose the view from `ViewShell`, `ViewSidebar` and Drive's `FolderTree`
rather than feature-local chrome. Adapt Passwords metadata to the app's existing
item drag provider and tree drop slots; never coerce vault items into Drive entities
or install a nested provider. Scope drag cancellation and auto-scroll to the
current vault's own drag. Register its desktop composable split layout
and wrap every route state in `SplitPanel.Root` / `SplitPanel.Body` so the
legacy header does not reserve an empty band. The responsive vault fixture is exercised with
`bunx playwright test --config src/features/passwords/browser-test/playwright.config.ts`
(its import case needs `just ensure-password-import-wasm`). Imports parse in a
per-file worker (`lib/core/password-import`); the parsed export lives only in
the import primitive's closure while the dialog is open, and sessionStorage
holds only the import id. See the [Passwords walkthrough](../../docs/agent-guide/passwords.md).

- Refresh mounted email list readers from matching `refresh_email` events through
  their data source, for both GraphQL and REST. Coalesce bursts, fence deferred
  work by account/session/scope, and catch up on reconnect/visibility. Show
  first-sync progress instead of an empty-inbox claim while selected links sync.

- Open generic email-provider selection immediately with loading and explicit
  retry on availability errors; never silently start Gmail on a failed read.
  Once availability succeeds, start the sole consent provider directly when
  IMAP is not offered; retain the chooser when there are multiple choices.
  Chooser capabilities omit the optional admin-consent callback and use a
  separate account/session cache variant from signed approval links.

- Use the shared SecretInput with current-password autocomplete for IMAP/SMTP;
  reconnect secrets start empty and switching off a separate outgoing secret
  clears its typed value.

- Keep confirmed IMAP server settings after verification refusal, clear secret
  fields, and offer the catalog app-password help link. Render only whitelisted
  error guidance; a connection failure must never imply a rejected password.

- Label reconnect actions Reconnect, stack server fields at full dialog width,
  and show the same labelled port/TLS choice in the menu and selected value.
- Keep IMAP connect action labels mounted through verification with Button
  loading, and reserve a wrapping error area so refusal/retry does not shift
  the footer. Avoid fixed action widths or clipped error copy.

For email content limits, show the closed unsupported-size message rather than
a generic HTTP fault. Retry an email mutation 429 once after Retry-After, capped
at five seconds; submission is excluded because its outcome may be uncertain.
Selective fetch error filters return undefined to preserve default status and
server retry behavior for responses they do not handle.

Account mailbox issues render independently of the generic sync-badge flag and
never imply a rejected app password. Size failures keep the last complete index.

The reserved IMAP browser-lab domain intentionally receives no passive MX offer.
Drive its normal manual provider chooser, open Server settings through the
Collapsible trigger, and choose settings via the shared listbox roles. Do not
add product routing exceptions for test identities.

A queued send's HTTP acceptance is not SMTP acceptance: a client timer may show
Still sending, but only the server's actual unconfirmed outcome may warn about
uncertain delivery. Terminal send progress must not replay its failure toast.
