# Disk-backed contacts

## Checkpoint: `b4f31857` (jj `xpzkvxyq`)

This checkpoint records the implementation tip before the final frontend correctness
pass. All known web full-directory consumers have been migrated; shared names are
bounded/account-scoped, browser people SQL runs locally, and the existing backfill
now reconciles removals with bounded exact lookup and stale-write fencing. Nothing
has been pushed or deployed.

The scope is replacing full in-memory personal-contact consumption with bounded
reads from the existing Turso cache while preserving frontend behavior. PostgreSQL
SQL feature parity, arbitrary joins and expansion of the backend SQL service are
**not completion requirements**. Backend work matters here only for correct,
authorized, bounded synchronization and its deployment prerequisites. Frontend SQL
must answer supported queries correctly or explicitly reject unsupported shapes;
it must never enumerate the directory or silently return incomplete answers.

Verification at this checkpoint: 3,025 frontend tests and 91 desktop/phone browser
cases passed, alongside native, WASM, OPFS and bounded 100k storage verification.
These are scoped/synthetic checks, not whole-app memory or physical-mobile acceptance.
Native strict clippy still reports five unchanged findings outside this slice.

Remaining in scope:
- [x] Verify covered frontend compositions locally across ranked recipients,
  exclusions/DM dedup, continuations, explicit selections, inference, SQL joins and
  account/reset/offline/removal races. Fix non-ID join-hint handling without
  expanding SQL capability; see the verification checkpoint below.
- [ ] Finish whole-app performance acceptance across migrated surfaces:
  - [x] Repeat 1k/100k desktop measurements on `5d4c8e52` with actual disk-backed
    persistent browser profiles: initial synchronization, command searches, message
    recipient paging/reopen cycles, Tasks/Drive filters, offline search, reload and
    removal refresh. Separate JS, WASM capacity, process PSS, storage and latency.
  - [x] Profile the observed 100k broad ranked-read/paging latency. Warm worker
    profiles put 55–63% in Turso traversal and 25–35% in ranking/membership checks.
    A disposable native covering-index probe reduced traversal plus decoding by
    about 36%; it is not yet an application/browser optimization.
  - [x] Implement and verify the approved covering-index path and per-row CPU
    reductions (`910c4052`). Two current full-app runs per size show about 15–21%
    lower broad search/paging latency, unchanged retained JS, roughly 26 MiB more
    disk and 5–7 s more initial sync at 100k. Extend the existing unpublished
    schema-12 cutover, not another migration; current-shape reopen preserves queues
    and generation. No lookahead or statement cache was added.
  - [ ] Address/accept the remaining broad-read latency and validate remaining
    surfaces, concurrent initial-backfill interaction and in-place account/reset
    performance.
- [ ] Exercise physical native/mobile behavior and connected synchronization/
  authorization traces; browser phone viewports and synthetic services do not cover
  those boundaries.

### Frontend verification: `b04f36ef` (jj `kxutnpmw`)

The local correctness pass found and fixed two issues:
- `68d994ff`: non-ID SQL join hints could treat email/name/row keys as user IDs
  and return misleading empty results. Only actual ID hints now reach bounded
  identity reads; unsupported shapes fail explicitly. No SQL capability expansion.
- `b04f36ef`: a selected custom address could retain keyboard focus while async
  suggestions arrived, causing Enter to remove its chip. Nonmatching custom
  selections now remain only in the hidden selection collection.

Verification: all 20,095 frontend tests passed (two skips); 196 browser cases passed
across internal contacts (101), Universal Input (81), account sources (2), mentions
(4) and email composers (8), with 11 intentional device-specific skips. New browser
cases use the real compiler/controller/Turso path for joins, and real publisher/
worker/WASM/OPFS/picker composition for offline recency, inbox exclusion, DM dedup,
continuation and custom-chip preservation. The pure SQL compiler's 170 tests,
wasm32 check, strict clippy, frontend checks and change-scoped gate passed. The
legacy web caller search found no matches. Two stale test fixtures were corrected;
an agent-fold failure resolved by rebuilding its stale local WASM artifact.

These checks use synthetic authority data. They do not establish connected backend
authorization/traces, physical-device behavior or current whole-app 1k/100k memory
and latency acceptance; those remain open below.

**Status:** phase 1 backend contract implemented. Phase 2 now has cache-side
contact hydration, bounded page retention, a `person` projection, and a generated
cursor-only backfill result. Background hydration is now wired under Soup's
existing authenticated tab leadership and cache flag. It admits pages under an
engine-checked account/storage generation and saves only committed cursors.
The contact debug inspector, Calendar search's organizer/attendee pickers,
Drive creator filters and CRM Notes creator filters now use bounded windows. Explicit selected ID/email lookup reads viewer-scoped
keys offline and authoritative bounded batches online; selected values remain
independent of suggestions. Shared name storage is now bounded and account/session-scoped;
the local frontend correctness pass is recorded above; whole-app and device acceptance remain open.
Channel/inbox source queries are now viewer-keyed, cached channel reads fence
storage generation, and mutation success/rollback use their captured account.
A replacement login clears these sources and gates them until fresh identity
confirmation, while retaining the shell's identity. This closes a prerequisite
for safely publishing local DM/inbox facts.
The context publisher now shares Soup's leader/rollout/generation lifecycle,
uses the scoped channel/activity/link queries, and emits bounded snapshot/delta writes.
The bounded directory reader now accepts a menu policy and external query, with
ranked cache continuations instead of a cursorless cap. Quick Access now uses that
reader without a global person index. Commands, document mentions, property pickers
and Soup people facets pass queries through; CRM aliases resolve only the current
50-row window. New message/channel, call, routine-template and sharing recipient
pickers now own bounded sources too, with separate scoped extras and selected chips.
Main email To/Cc/Bcc controls also own paged sources; email threads retain only
scoped addresses. General Soup assignee/creator menus and consolidated chips now
use lazy sources and independent selected-label lookups, removing three closed-menu
full-directory consumers. Channel invitations and participant pickers now use the
same bounded source with scoped roster exclusions. Calendar create/edit, event-detail
invitation/forwarding and AI-draft guest pickers now use bounded property windows;
event-owned guests remain scoped extras. Universal Input now resolves recipients,
guests and inferred-search people from complete per-label evidence, separate from
its paged picker/mention suggestions. It no longer mounts a shared personal pool.
Tasks filters now use lazy personal windows and an independent per-label planner;
inline checklist labels resolve only document-referenced assignees in bounded batches.
Onboarding now retains only a maximum-six same-domain email seed from bounded
search pages. Linear import now resolves current CSV assignees in bounded exact
batches and uses single-user picker windows. Browser people SQL now executes in
existing local Turso, including fresh queries offline after synchronization. The
unnecessary read-only server endpoint/client/generated contracts are removed; no
SDK wrapper or new server deployment is required. No known active full-directory
consumer remains. Unused web full-list hooks, the shared recipient pool, their
query key and the manual GET wrapper are removed. The deployed contacts endpoint
and SDK remain compatible; they are not used by the web app. A local SQL
foundation now derives contact facts into the existing predicate index and executes
parameterized filtering, counts, grouping, DISTINCT, ordering and limits in Turso.
It retains at most 500 rows/64 columns/512 KiB of scalar output and rejects incomplete
projections. Account/generation checks precede execution. Browser/native hosts now
expose this local capability through a generated, bounded contract (coordinator 17).
The 100k native fixture returns an exact 100,001 count including self and survives
reopening, as does the release OPFS fixture. The browser controller now consumes
local SQL with complete-checkpoint, compiler-metadata and account/session/generation
fences. Keyed joins read only bounded identities; one physical read plus one
replaceable input prevents queued scan history. Frontend query correctness is
covered by the local pass above; whole-plan acceptance remains open and broader
SQL parity is outside this plan.
**Current full-app measurement (`5d4c8e52`):** two regular-profile runs per size
retain **56.5 / 57.4 MiB JS at 1k/100k** after verified synchronization and
**69.4–69.5 / 70.1 MiB** after expanded workflows close. Native/WASM reads find tail
contacts and page recipients without server search fallback. A maintenance pass
removes 100/1,000 contacts with local counts confirming 900/99,000 remaining.
At 100k, initial verified synchronization takes about 154 s and recipient paging
about 710 ms; broad-query latency is still a cost. WASM capacity reaches 94.4 MiB,
while post-sync browser PSS is 737–744 MiB. Private/incognito OPFS distorted historical
process-memory and ingestion figures; fresh persistent profiles confirm on-disk
files and avoid that artifact.

**Historical full-app diagnostic:** the retiring-host wrapper omitted `CacheHost.people`,
blocking the publisher/ranked reader in the real app. It now forwards person
methods through the current host, with unsupported reads and rejected writes
on retirement, including captured methods. The original 100k run retained about
216 MiB of JS versus 57 MiB at 1k. At `bd5748ab`, two fresh-context runs per size
retained **55.8–55.9 MiB at 1k versus 56.6 MiB at 100k** after hydration, with
zero legacy directory reads and one-ID maximum name batches. Home/command startup
no longer reproduced the directory-sized JS increase. The later shared-name cache
work was not included in those historical heap numbers; the current measurements
above cover it, without claiming all surfaces or environments are accepted.
Full-app checks at 1k and 100k now publish ready context, avoid server fallback
for command-person searches, and resolve those searches during API transport loss.
The frontend review fixes bind continuations to input transitions, wake initial
offline failures, preserve current-search DM metadata, and keep 500 selections
resolvable alongside self. Indexed backend point lookup now resolves supported
legacy-case peer IDs emitted by paging, without changing viewer authorization or
raw cursor order.
A scoped core reference matcher now scans the cached directory while retaining
at most two witnesses per requested label, preserving exact/full-name/first-name
ambiguity. Its browser/native host transport is now exposed, with a real retiring-host
and OPFS regression. Universal Input's person references now consume this evidence;
the separate Tasks filter planner now extracts references without a personal catalog
and rejects unresolved people before applying any constraints.
A bounded frontend reference source now combines native evidence with exact
server stages, following empty continuations and exhausting a pass before calling
one name unique. Labels and exact/first-name stages share an eight-page fallback
budget; exhausting it retains partial witnesses as incomplete rather than proving
absence or uniqueness. Explicit identities use independent lookup. It serializes
native work with one replaceable pending input, samples completeness before scanning,
and never turns partial/offline evidence into uniqueness. Universal task-property
inference requests only effective person-valued labels with `anyName`, preserving
full-name/first-name ambiguity, explicit identities and manual overrides. It snapshots
resolved values before awaiting creation metadata and fences the submitting account.
Desktop/phone source/composer tests cover off-window people, empty continuations,
ambiguity, manual clearing and offline/reconnect. Other Universal Input modes use
`preferFullName`, retain unresolved search constraints, and separate explicit
identity/address handling from names. Field-owned picker snapshots preserve chosen
labels without supplying name-proof evidence. This is not whole-app memory completion.
**Optimization follow-up (`910c4052`):** the approved index/CPU changes now reduce
100k broad command search to 547–562 ms, recipient browse to 719–720 ms and paging
to 559–563 ms. Retained JS remains about 57.4 MiB after sync and 70.1 MiB after
expanded workflows. Disk and write costs are measured, not assumed free.

**Name-policy cutover:** the approved [name-focused search design](contact-name-search-proposal.md)
is now the active local-only suggestion path: exact names, all-word prefixes,
then literal contains, recent-first with identity ties. Consumers preserve that
order; server suggestion fallback and old person scoring are removed. Partial
hydration stays explicit, and refresh schedules background sync. Fresh regular-profile
runs of `94dce7c0` put 100k broad command reads at 89–92 ms, recipient reads at
229–236 ms and paging at 78–79 ms. Retained JS is 57.4 MiB after sync and 69.6 MiB
after expanded workflows; index facts add about 66 MiB of reopened disk usage and
11–13 s of verified initial sync versus the prior optimized build. Selective reads
still pay contains-completeness work.
Continue remaining surface/lifecycle, connected synchronization/authorization and
physical-device acceptance. Do not
expand backend SQL or arbitrary joins to satisfy this contacts-memory goal.

## Goal and scope

Support directories of 100,000 contacts without retaining the complete directory
in JavaScript or in a Rust/WASM search catalog. Keep contact records on disk in the
existing Turso normalized cache and materialize only bounded results and explicitly
selected contacts.

This covers the personal contact graph used for people search and recipients, not
the separate CRM contact entity. Preserve desktop and mobile behavior, including
custom email entry, selected recipients, keyboard interaction, and existing labels.

The issue is not fully solved until the last full-directory consumer is removed.
Migrating Quick Access alone leaves other callers retaining the entire corpus.

## Foundation already implemented on the feature branch

- Ordinary text search uses bound subsequence patterns; personal suggestions use
  indexed name tiers and recent-order keys in the existing predicate projection.
- SQL results stream into a top-K ranker; there is no retained text-search catalog.
- Row fields are borrowed and a canonical-key buffer is reused; only winners are
  copied into owned documents.
- Storage schema 12 adds covering search and contact-payload indexes. The deliberately incompatible
  cache cutover is already implemented; do not add another rollout mechanism for
  contacts unnecessarily.

See [client cache architecture](../../crates/client/README.md#streaming-text-search)
and [search measurements](../../crates/client/search-performance.md). These are
branch changes, not a claim that the feature is deployed.

## Current sources of retention

- [`core/user/displayName.ts`](../../apps/web/src/lib/core/user/displayName.ts) is now
  a compatibility facade over the existing QueryClient. `queries/auth/user-name-cache.ts`
  owns account/session/generation-scoped values, active-reader leases and bounded idle
  retention; the old Solid store and separate CallKit name queue are removed.
- No web consumer or handwritten web client requests the full directory. The retired
  full-list query/hooks and shared recipient pool no longer exist, including their
  fixture shims. Contact invalidations only schedule the bounded refresh runner;
  they cannot recreate the old query. Active label retention scales with mounted
  readers; inactive names and outstanding name work have explicit budgets.
- The deployed contacts GET endpoint and SDK user search still have compatibility
  consumers outside the web app; retire those only through their own API migration.

## Target data flow

```text
Authenticated, paginated contact reads with resolved names
    -> bounded background hydration
    -> normalized contact records + existing search projection in Turso
    -> database search / bounded browse / explicit ID or email lookup
    -> active result windows and selected contacts
```

Reuse the existing database, cache host, ownership, hydration, identity isolation,
and generation handling. The expected local change is an additive normalized type
and search projection, not a new database or bespoke contact-storage subsystem.

## Phase 1 — bounded backend contract

- [x] Extend the existing `contacts` domain service and repository with stable,
  keyset-paginated contact-ID reads; do not load everyone before slicing a page.
  `ContactsPageService` uses a validated 1–500 row bound (default 100), includes
  self in the sorted page, and advances through malformed legacy IDs. The reverse
  `(user2, user1)` index complements the existing forward unique index.
- [x] Expose paged reads under the authenticated GraphQL viewer through
  `graphql_contacts`, composed by `complete_graph`. DSS inserts the context for
  HTTP and websocket requests. Both graph and name reads use the primary to
  follow immediate contact invalidations without replica lag.
- [x] Return identity, email, and resolved names together, avoiding a second
  all-contact name-fetch step.
- [x] Preserve name precedence through the existing user-name owner query: Macro
  profile, then the viewer's email-contact name. A null name keeps each surface's
  existing email fallback choice. Self remains included.
- [x] Define a distinct viewer-scoped contact record and stable normalized identity.
  `GraphqlContact.id` derives from the viewer/person pair; `userId` identifies the
  target. Names do not affect identity.
  Do not reuse `GraphqlUser`, which is the authenticated viewer/identity witness;
  do not merge viewer-specific names into a global public-profile record.
- [x] Provide bounded search and batch ID/email resolution under the same authorized
  contract. `user.contacts(search, limit, after)` filters names/emails using the same
  matcher as cache search. `contactsByUserIds` / `contactsByEmails` resolve only
  requested graph members or self, in first-requested order; unknown people are
  omitted and empty input returns nothing. Cached profiles never imply membership.
- [x] Bound read/search results and raw lookup inputs to 500 (page default 100),
  before lookup deduplication. Search text is capped at 512 UTF-8 bytes.
- [x] Generate the SDL, `ContactDirectoryPage` operation types, and cache entity
  metadata from their source of truth. Do not use this foreground page operation
  for full background ingestion until phase 2 omits retained page wrappers.

Read [contacts ownership](../../crates/contacts/AGENTS.md),
[schema conventions](../../crates/complete_graph/AGENTS.md), and the
[GraphQL field guide](../guides/add-graphql-field.md) before implementing.
Keep deployed full-list APIs compatible until their clients can be retired.

### Server search contract

Server search is source-ID-ordered pagination, not the cache's ranked top-K search.
Each nonempty search enriches at most four batches of 500 source rows; pagination
also reads one lookahead ID per batch. Reaching this work budget can return an
empty or short page with a continuation. Only `nextCursor: null` proves exhaustion.
Callers must follow continuations for more matches, reset them when the query
changes, and never turn a budget-limited empty page into "no matches."

Optional `matching: EXACT | FIRST_NAME | ANY_NAME` adds reference-resolution stages
without changing ordinary subsequence reads. The domain applies each predicate
before limiting; exact stages require a nonempty search and retain the same source
scan budget. `ContactReferencePage` is fetch-only, so cancellation never persists
obsolete names or rebinds cache identity. Ship this additive schema before a client
selects it. The frontend resolver follows these stages without retaining pages;
Universal task-property inference and the other migrated planners use it.

Per-row cursors preserve original database positions independently of canonical
user IDs, so stopping inside a batch cannot skip case-normalized legacy rows.
The shared dependency-free `subsequence_match` crate supplies normalization and
ordinary token matching for deployed server search. Its separate names module
supplies local policy-5 suggestion matching; server/SDK legacy matching is unchanged. Exact lookup uses indexed,
bounded point reads before resolving names. Two additive concurrent indexes keep
those point reads bounded when legacy peer IDs contain ASCII case variants.
`lower(peer COLLATE "C")` matches the parser's ASCII canonicalization; a strict
`macro|` prefix predicate excludes malformed marker aliases, and invalid Unicode
is not folded into valid ASCII identities. Viewer equality stays raw/exact, as in
paging. Requested order, self and deduplication are unchanged.

Apply migrations `20261105044718` and `20261105044750` before deploying the updated
lookup. Each contains one concurrent index build, with no data rewrite or constraint
change. They are applied locally only. Real 100k-row custom/generic-plan tests use
production planner costs and assert indexed bounded reads, and directory enrichment
checks private-name and viewer-scoped identity parity. Verification used local
PostgreSQL 18; production PostgreSQL 14 was not run.

### Approved deterministic ranking change

Ordinary entities retain fixed per-row scores and command keyword matching.
Personal suggestions instead use exact-name/word-prefix/literal-contains tiers,
recent-first within tiers and identity ties. Complete addresses and Macro IDs are
identity lookups; no arbitrary-gap or domain/brevity scoring is applied to people.

The new core person-policy API stores only local DM/inbox facts on existing
normalized keys. It fences context publication by account, storage generation
and compare-and-set epochs; incomplete snapshots report pending. Context-only
stubs cannot become contacts. SQL-filtered records stream into at most `limit + 1`
unique winners, with exclusions and DM deduplication applied before the limit.
The API is now exposed through browser/native `CacheHost.people`, with generated
Rust/Zod contracts, coordinator protocol 17, and dedicated native commands. Missing
capabilities return unsupported on reads and reject writes; scope/storage failures
never downgrade to legacy hydration. Successful context writes send only person
hydration hints. The leader publisher now sends complete snapshots before commit,
then only changed/removed peer facts. Writes and pending IDs cap at 500; queue
overflow or uncertain persistence starts a fresh compare-and-set epoch. Missing
inputs never mean an empty snapshot. Three exponential retries follow a transient
failure, with source changes/reconnection able to wake later attempts.
Ranked continuations bind account/generation, policy/layout, context epoch and live
contact/context tokens. Same-epoch patches and membership changes invalidate pages.
Bounded DM-target lookups omit prior aliases; short/empty windows may still continue.
The single-window reader stays local even during incomplete sync and invalidates
pending replies on contact changes. No query-history catalog or server search fallback
is retained.
Quick Access now uses the reader and never puts personal-contact winners in its
global item cache. Menus replace person windows rather than appending them; CRM
alias resolution is independently windowed and does not recreate a user catalog.
Native policy 5 excludes automated recipient mailboxes unless explicitly addressed,
and pins self only during empty property browsing. Consumers preserve returned
personal order through mixed-source menus. Older capabilities remain explicitly
unavailable; independent reference evidence keeps its unchanged policy-4 floor.
Publisher input maps scale with existing DM peers/inboxes, not the personal contact
directory. The existing full channel sources remain in memory; this is not a claim
of constant whole-app memory or of completed 100k UI verification.
The indexed reader's native measurements are not browser/whole-app acceptance;
measure write/index costs, persistent-profile memory and end-to-end latency separately.

## Phase 2 — cache ingestion and query-driven search

- [x] Hydrate one 500-row page at a time, persist it, then release its payload.
  Checkpoints belong to the account and durable storage generation. Fetch-only
  transport checks cancellation before explicit hydration; the shared core
  checks generation and both expected/response identities under its engine lock.
  Reset, account change, disposal, and failed writes cannot advance the cursor.
- [x] Omit contact page and exact-lookup wrappers during core hydration. Foreground
  contact queries share the existing 64-page / 2 MiB viewer-snapshot budget
  with Soup. `ContactDirectoryBackfill` marks nodes `@cacheOnly` and generates
  its cursor-only result. The background runner uses scoped cache admission.
- [x] Project `GraphqlContact` names/emails into `person` through the existing
  covering index and borrowed-row ranker (projection version 6, including the visible email-label fallback). Public `User` /
  `GraphqlUser` profiles no longer imply contact membership. No timestamps are
  invented from relationship metadata.
- [x] Materialize bounded `IUser` windows with target `userId` as `IUser.id`;
  the viewer-scoped `GraphqlContact.id` is a cache key, not a DM/navigation target.
  `directory.ts` maps returned names directly without populating the global name store.
- [x] Verify DM recency, deduplication and secondary-inbox exclusions through
  frontend/cache composition.
  The core policy, scoped context lifecycle and before-limit tests are implemented;
  browser/native transport and the scoped channel/inbox context publisher are
  implemented. Quick Access commands/mentions request ranked windows, and the
  retiring-host wrapper now preserves the capability. Full-app command searches
  exercise the restored path online/offline at 100k. Shared recipient controls are
  migrated too. The current real-worker/OPFS fixture verifies offline command
  continuations, before-limit inbox exclusion and DM dedup, context-only nonmembership,
  recency publication and recipient-chip preservation. Connected source authorization
  and current whole-app/device acceptance remain separate checks.
  Relationship `updated_at` is not equivalent to DM activity.
- [x] Add bounded search/browse under `apps/web/src/lib/queries/contacts`, with
  pending/error, snapshot/partial/cold, and offline/source status. Cursors bind to
  source, account, query and (for cache) generation; pagination never switches sources.
- [x] Add shared exact ID/email resolution, including offline selected contacts.
  Bound raw input to 500 before deduplication. Derive only requested normalized
  keys with the standard UUIDv5 identity contract, checked by shared Rust/TS
  fixtures. Online omissions remain authoritative for that batch; offline
  unresolved IDs never imply non-membership. Successful reads warm supported
  caches through guarded hydration without retaining lookup wrappers.
- [x] Bound result windows and query history in the new API: one page per observer,
  immediate TanStack garbage collection, plain copied cursors, and no page accumulation.
- [x] Provide an independent, account/epoch-fenced selection resolver with no
  query history. Calendar people filters use it and preserve unknown/custom
  emails across searches, page replacement, failures, and offline gaps.
- [x] For cold, disabled, or unsupported caches, the new reader uses one bounded
  server page. Offline fallback requires an identity-checked cached window and
  never masks authorization errors; legacy full-list APIs are not a fallback.
- [x] Account for older native engines: runtime GraphQL metadata can accept a new
  type, but its handwritten search projection still needs a rebuilt native binary.
  Gate local contact-search capability rather than treating missing support as no matches.
  Search responses now advertise `projectionVersion`; missing or below 5 means
  the engine lacks contact projection/retention. The background runner and native
  guarded-write boundary and the bounded UI reader now gate on this capability.
- [x] Wire Quick Access `person` materialization and remove its global contact index.
  Pass command/mention searches to bounded windows; resolve CRM aliases separately.
- [x] Migrate shared recipient selection away from full-directory transforms.
  New message/channel, call, routine-template and sharing controls now construct
  per-picker sources, as do main email To/Cc/Bcc and channel invitation controls.
  Universal Input now uses independent picker windows and complete per-label resolution.

### Synchronization: keep the first implementation small

Use resumable paginated hydration and coalesced refreshes rather than introducing
a new change-log subsystem. Existing `contacts_invalidation` notifications should
schedule bounded work, not cause a complete 100k-contact scan on every event.
The runner uses 250 ms between pages, a 15-minute maintenance cadence, and a
15-minute minimum between completed scans. Invalidations do not interrupt or
rewind an active pass. Hourly passes refresh profile/address-book names even
without graph events. Leadership/account/generation changes interrupt the job;
interrupted scans resume from their last durable cursor.

Track cold, partial, complete, and failed synchronization distinctly. Discard stale
async responses after account/generation changes. Interrupted or failed scans never
prove that omitted contacts were removed.

Name freshness needs an explicit policy: contact-relationship timestamps do not
capture profile or email-contact name updates. Address this through bounded name
refresh and directory refresh behavior; do not claim graph timestamps synchronize
all display fields.

Authoritative removal verification now extends this same lane, without another
endpoint, database, leader, timer or directory-sized seen set. After hydration,
scan existing normalized contact records by raw key (500 visited records plus one
undecoded lookahead), extract only viewer-scoped membership IDs, and call the
existing bounded `contactsByUserIds` lookup. Only a complete successful response
for those explicit IDs permits deleting absent members. Reject foreign identity,
foreign record keys, duplicates, unsolicited IDs and omitted self. Context stubs
never establish membership; malformed membership prevents completion. Empty raw
windows may continue. Hydration-page omissions never authorize deletion.

Checkpoint v2 stores phase, cursor and scalar completeness/progress. Verification
resumes after failures/interruption, and completion is published only after its
last acknowledged write and storage-generation recheck. Account/session,
leadership and storage changes interrupt work. Offline/error responses never
remove members. This is per-batch authoritative evidence, not a transactionally
consistent server snapshot or a claim that membership never changes afterward.

`contactSnapshot` captures the existing single-owner engine's opaque write fence
before fetching; guarded hydration consumes it, even for identical positives.
`contactReconcile` checks the same fence before deleting requested absences.
Accepted verification with no removals consumes admission without publishing a
fake data change. Clear, engine replacement, contact deletion and contact
invalidation reject older admission. Unfenced network/optimistic contact writes
reject; context patches remain non-membership writes. Removal updates durable/hot
records, search/SQL projections and dependent-read notifications. Old positive
responses cannot resurrect removals, nor can old absence evidence delete newer
positive observations; fresh observations can re-add members. Global fencing is
conservative: concurrent contact writes retry the current bounded checkpoint,
not a retained directory or an unbounded queue. Older hosts explicitly refuse
this capability. Explicit selections and separately scoped name labels remain
independent of membership.

**Deployment prerequisite:** apply the canonical lookup indexes and deploy the
case-correct exact lookup before rolling out client removal checks. The existing
endpoint's successful omission is the authority; older buggy lookup behavior
cannot safely certify absence. No production migration/deployment is implied.

## Phase 3 — eliminate remaining full-list consumers

- [x] Migrate the final `useCombinedRecipients()` consumer in Universal Input.
  Recipients/guests/search use complete per-label name evidence, with explicit
  identity lookup independent of the picker window. Selected labels are scoped
  snapshots, not a catalog; unresolved filters never broaden an inferred search.
  Message mentions use their own bounded personal window.
  Channel invitations and participant pickers now use scoped roster exclusions,
  independently retained selected/custom chips and whole-team selection. Normal
  rosters are excluded before native limiting; oversized rosters filter the remaining
  IDs locally and retain short/empty continuations. Any roster change resets paging.
  New message/channel creation, main email compose/reply/forward fields, sharing,
  calls and routine-template sharing use per-picker ranked windows, with selected/custom chips independent
  of suggestions. Explicit scoped extras stay local; keyboard/touch Next replaces
  windows, including empty continuations. Closing collects page data and reopening
  starts at the first window.
- [x] Default document mentions and document/project/call discussion composers use
  bounded person search, including replies and edits. Channel/CRM/custom participant
  pools remain scoped; an empty or pending roster never widens to the directory.
  Agent policy decorates only the current window or explicit roster, preserving
  native row timestamps, bot rollout/deduplication and channel-only group mentions.
- [x] Calendar guest pickers in create/edit, event-details invitation/forwarding
  and AI-draft composers: bounded suggestions plus event-owned guest metadata.
  Chosen private names and custom addresses survive replacement windows; existing
  add-only guests are excluded using canonical eligibility keys without rewriting
  selected values. Native person pages have no second UI cap; next-page controls
  and broader native/server matches remain reachable. Loading cannot recreate the
  list owner, and stale pagination actions stop on scope/eligibility changes.
  Channel participant selection and default discussion mentions are also migrated.
  Universal Input's guest inference is independently resolved per label.
- [x] Drive creator and CRM Notes creator filters: lazy sources in the existing
  desktop submenu and mobile drawer, bounded search/browse, and independent
  persisted-ID resolution. Self is an explicit pin, selected/unknown IDs survive
  off-page searches, and Only changes only its own group.
- [x] Soup sender/speaker/assignee/creator facets: lazy desktop/mobile search,
  independent selected-ID labels and self pins. Property selectors pass typed
  queries and resolve selected users/self separately; team-only pools stay scoped.
- [x] General Soup assignee/creator menus and consolidated chips: lazy desktop
  submenus/mobile accordion sources, independent selected-label lookup, and
  window replacement. Self and Unassigned stay pinned; unknown selections survive
  searches, Only changes only its own group, and clearing an Owned creator refinement
  restores the preset. Native input events keep combobox metadata/page replacement
  from clearing an in-flight query. Closed menus never fetch the directory.
- [x] CRM Owner chips use lazy personal windows and independent selected labels,
  preserving No owner/unknown values and unrelated Stage filters. The header's
  owner menu remains restricted to teammates; it is not replaced with a personal
  suggestion window. Desktop and phone chip pagination are covered in-browser.
- [x] Tasks filters: lazy desktop/mobile pages and explicit selected-label lookup,
  including saved-summary IDs, semantic Me, fixed self, unknown values and Only.
  The planner extracts names/addresses without a personal catalog, then resolves
  complete per-label evidence. Unknown/ambiguous/offline people block the whole
  plan; account/session, navigation and intervening edits fence late completions.
- [x] Inline task-list labels: resolve only referenced task assignees, with each
  exact lookup capped at 500. Invalid IDs do not poison another batch; reference
  replacement releases old labels without deleting persisted filter identities.
- [x] Universal task-property inference: resolve current person-valued labels with
  complete per-label evidence, not a full pool or suggestion page. Unknown/ambiguous
  names block submission; manual values override inference, and submitted identities
  survive asynchronous definition loading. Other Universal Input modes now use
  their own bounded per-label evidence rather than that shared pool.
- [x] Calendar search organizer/attendee filters: bounded suggestion pages and
  separate selected-email lookup, with desktop/phone focus and keyboard coverage.
  Render resolved names through `UserIcon.name` rather than filling the global
  name store again. Calendar guest editors also use the bounded windows above.
- [x] Onboarding: search only the server-approved domain, follow empty continuations
  until six distinct non-self emails or exhaustion, and retain just the seed.
  Queries are account/session/generation-scoped with no retained history. No domain
  makes no contact read; errors open the plain form. Manual edits survive refreshes.
- [x] Linear import: serial 500-label exact-reference batches and bounded single-user
  property pickers. Multiple exact matches never select an arbitrary user. Manual
  choices (including Unassigned) survive late evidence; unavailable proof requires
  retry or an explicit choice. Upload/session ownership fences file reads and
  mappings; submission snapshots identities and fences task dispatch/publication.
- [x] Database SQL `people`: replace the full-directory frontend source with filtering/aggregation in existing local
  Turso, with authorized synchronization supplying records rather than executing queries. Paging everyone and concatenating the pages in JS is not a solution.
  The browser's
  `/databases/read` endpoint/client is removed; no SDK wrapper is needed. Browser
  routing now preserves compiler-bound dependencies, scope/schema fences and explicit
  failures while executing in local storage. The local capability uses the existing
  predicate index, with no second contact store, and supports direct people SELECTs
  and bounded keyed reads. Counts, DISTINCT, grouping, virtual columns and Unicode
  LIKE run over real Turso/OPFS in the shared 1k-record contract. The scoped WASM and
  native IPC transport and browser composition use this path with no network fallback.
  Ordinary joins accept at most 100 explicit identities before deduplication; missing
  or oversized hints refuse rather than enumerate. Completion follows the persisted
  checkpoint acknowledgement and wakes pending reads. The native 100k fixture passed before and after reopening:
  exact counts took about 22 ms, a late Unicode LIKE match about 488 ms, and the
  complete query contract about 2.8 s. These are storage measurements, not whole-app
  acceptance. The release OPFS fixture also passed at 100k plus self and after
  reopening: hydration took 42.3 s and the query contract 4.1 s. This is a synthetic
  storage/host test, not full-app or physical-mobile acceptance. The desktop/phone
  composition fixture additionally uses the real worker/WASM/OPFS with 1,001 records,
  fresh offline queries, missing-capability refusal and delayed old-session replies.
  Frontend compiler/controller tests now cover explicit refusal of unsupported
  non-ID joins and recovery to supported identity joins. Whole-app acceptance
  remains pending; broader join support is not part of this plan.
- [x] Contact debug view: visible counts, search and paginated inspection; JSON
  export contains only the current window. Desktop/phone browser coverage uses
  the production reader/window/inspector with bounded stand-in cache/network sources.
- [x] Bound and account-scope shared display names and the separate participant-name
  loader through one query-cache owner. Keep active reactive labels pinned; cap idle
  entries at 512 and 512 KiB of accounted text/metadata, with 16 KiB per name and
  ten-minute idle eviction. One physical request and at most 500 queued IDs share a
  500-ID batch cap. Scope changes/disposal cancel the transport; a 30-second abort
  deadline bounds stalled requests. Uncancellable work retains its single physical
  slot until settlement. Overflow interests remain only on active/bounded-idle entries,
  not promise queues. Release obsolete interests on cleanup and preserve pins across
  synchronous reactive reevaluation, avoiding eviction/refetch loops.
  Names refresh on access after ten minutes; transient failures keep prior labels and
  retry on a later access after 30 seconds or on reconnection for active labels.
  There is no automatic failure polling. Omitted names settle to fallback.
  Authorization refusal removes private labels and blocks work until a new scope.
  Account/session transitions, returned accounts, replaced entries and manual edits
  fence late responses. The editable own-profile query remains separate but is now
  session-keyed. Login/account transitions also clear cached bearer credentials.
  Debug seeds are bounded and session-owned, not module-import side effects. Names
  remain labels, never contact membership or inference evidence. Native CallKit uses
  the same non-suspending cache rather than a second unbounded loader; pending
  new-scope names publish fallbacks instead of leaving old private labels in native
  metadata. Tests exercise
  100k idle reads and more active labels than the idle budget; browser composition
  covers shared labels/participant names, account returns and authorization failures.
- [x] Remove web `useContacts()`, `useContactsQuery()`, `useCombinedRecipients()`,
  full-list query options/key, re-exports, manual GET wrapper and obsolete fixture
  shims after the caller audit. Message send, native sharing and websocket contact
  invalidations now issue only `requestContactRefresh()` hints to the existing
  bounded/coalesced runner. Shared recipient mapping types remain for scoped windows;
  deployed backend/SDK APIs retain compatibility.

Rediscover callers rather than treating this list as exhaustive:

```sh
rg -n 'useContacts\(|useContactsQuery\(|contactsQueryOptions\(|getContacts\(|useCombinedRecipients\(' apps/web/src
```

## Completion criteria

- Retained contact data scales with bounded hydration/result buffers and active
  selections, not total directory size, in both JS and Rust/WASM.
- A 100k-contact corpus remains usable through initial hydration, repeated searches,
  refreshes, scrolling, and opening/closing multiple pickers.
- Names, self, DM ranking/deduplication, selected recipients, and custom email entry
  preserve their existing semantics on desktop and mobile.
- Offline/incomplete data is not presented as an authoritative absence. Account
  switches, cache resets, disposal, and superseded searches cannot publish stale results.
- No full-directory compatibility path or hidden side cache remains. Report memory
  and latency separately: bounded memory alone does not guarantee fast searches.

Keep each phase incremental and update this checklist as work lands. Completed
consumer migrations and storage tests do not by themselves establish whole-app
memory, latency or device acceptance.
