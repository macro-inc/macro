# Disk-backed contacts

**Status:** phase 1 backend contract implemented. Phase 2 now has cache-side
contact hydration, bounded page retention, a `person` projection, and a generated
cursor-only backfill result. Background hydration is now wired under Soup's
existing authenticated tab leadership and cache flag. It admits pages under an
engine-checked account/storage generation and saves only committed cursors.
The contact debug inspector, Calendar search's organizer/attendee pickers,
Drive creator filters and CRM Notes creator filters now use bounded windows. Explicit selected ID/email lookup reads viewer-scoped
keys offline and authoritative bounded batches online; selected values remain
independent of suggestions. Other product menus still retain legacy arrays.
Channel/inbox source queries are now viewer-keyed, cached channel reads fence
storage generation, and mutation success/rollback use their captured account.
A replacement login clears these sources and gates them until fresh identity
confirmation, while retaining the shell's identity. This closes a prerequisite
for safely publishing local DM/inbox facts.
**Next step:** publish channel/inbox context in bounded batches, then cut
Quick Access/shared recipients over to the bounded host API. Their old full-list source remains until that wiring lands.
Soup/CRM owner filters and Tasks' AI-filter catalog also remain.

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

- Text matching reaches Turso as bound subsequence patterns.
- SQL results stream into a top-K ranker; there is no retained text-search catalog.
- Row fields are borrowed and a canonical-key buffer is reused; only winners are
  copied into owned documents.
- Storage schema 12 adds a covering search index. The deliberately incompatible
  cache cutover is already implemented; do not add another rollout mechanism for
  contacts unnecessarily.

See [client cache architecture](../../crates/client/README.md#streaming-text-search)
and [search measurements](../../crates/client/search-performance.md). These are
branch changes, not a claim that the feature is deployed.

## Current sources of retention

- [`queries/contacts/contacts.ts`](../../apps/web/src/lib/queries/contacts/contacts.ts)
  fetches all contact IDs into TanStack Query. Each `useContacts()` maps them into
  another `IUser[]` and requests display names.
- [`core/user/displayName.ts`](../../apps/web/src/lib/core/user/displayName.ts)
  holds a global name store. Expiry triggers refresh, not eviction.
- [`QuickAccessSource.tsx`](../../apps/web/src/lib/core/context/quickAccess/QuickAccessSource.tsx)
  builds per-contact items, search strings, and indexes. The frontend projected-list
  path currently excludes `person`, even though the core search profile has that bucket.
- [`useCombinedRecipient.ts`](../../apps/web/src/lib/core/signal/useCombinedRecipient.ts)
  derives additional arrays, consumed by email, sharing, invitations, and creation flows.
- Filters, calendar editors, onboarding, imports, and the database SQL `people`
  source still request the full directory. The contact debug inspector no longer does.

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

Per-row cursors preserve original database positions independently of canonical
user IDs, so stopping inside a batch cannot skip case-normalized legacy rows.
The shared dependency-free `subsequence_match` crate keeps Unicode normalization
and token eligibility identical on the server and in the native/WASM cache;
ranking policy remains in the owning consumer. Exact lookup uses indexed,
bounded point reads before resolving names.

### Approved deterministic ranking change

Menu scores now use a fixed per-row scale rather than normalizing against the
whole loaded result set. Surface match tiers, recency weights and boosts remain
explicit; order within tiers may change. Command keyword eligibility retains its
existing matcher. Shared Rust/browser fixtures cover name quality and recipient
tiers. This is the approved prerequisite for correct bounded ranking.

The new core person-policy API stores only local DM/inbox facts on existing
normalized keys. It fences context publication by account, storage generation
and compare-and-set epochs; incomplete snapshots report pending. Context-only
stubs cannot become contacts. SQL-filtered records stream into at most `limit + 1`
unique winners, with exclusions and DM deduplication applied before the limit.
The API is now exposed through browser/native `CacheHost.people`, with generated
Rust/Zod contracts, coordinator protocol 12, and dedicated native commands. Missing
capabilities return unsupported on reads and reject writes; scope/storage failures
never downgrade to legacy hydration. Successful context writes send only person
hydration hints. **Quick Access still does not use it**; context publishing and
consumer cutover remain pending.
Its joined-record scan is slower than ordinary covering-only title search; do not
claim the UI cutover or whole-app memory goal complete from these engine tests.

## Phase 2 — cache ingestion and query-driven search

- [x] Hydrate one 500-row page at a time, persist it, then release its payload.
  Checkpoints belong to the account and durable storage generation. Fetch-only
  transport checks cancellation before explicit hydration; the shared core
  checks generation and both expected/response identities under its engine lock.
  Reset, account change, disposal, and failed writes cannot advance the cursor.
- [x] Omit contact page and exact-lookup wrappers during core hydration. Foreground
  contact queries share the existing 64-page / 512 KiB viewer-snapshot budget
  with Soup. `ContactDirectoryBackfill` marks nodes `@cacheOnly` and generates
  its cursor-only result. The background runner uses scoped cache admission.
- [x] Project `GraphqlContact` names/emails into `person` through the existing
  covering index and borrowed-row ranker (projection version 6, including the visible email-label fallback). Public `User` /
  `GraphqlUser` profiles no longer imply contact membership. No timestamps are
  invented from relationship metadata.
- [x] Materialize bounded `IUser` windows with target `userId` as `IUser.id`;
  the viewer-scoped `GraphqlContact.id` is a cache key, not a DM/navigation target.
  `directory.ts` maps returned names directly without populating the global name store.
- [ ] Wire DM recency, deduplication, and secondary-inbox exclusions end to end.
  The core policy, scoped context lifecycle and before-limit tests are implemented;
  browser/native transport is verified. The channel/inbox context producer and
  consumer wiring remain pending.
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
- [ ] Wire Quick Access `person` materialization and query-driven shared recipient
  selection; remove global contact indexing and full-directory recipient transforms.

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
all display fields. Removal reconciliation remains pending: keyset scans are not a transactional
snapshot, so even a completed pass does not delete omitted records. A completion
checkpoint describes a cached snapshot, not current authoritative membership.

## Phase 3 — eliminate remaining full-list consumers

- [ ] Email recipients, channel creation/invites, sharing, calls, and other
  `useCombinedRecipients()` consumers: query-driven suggestions and separate selection.
- [ ] Calendar guests, event editors, participant menus, and mentions: bounded
  search plus explicit resolution of attendees/participants already present.
- [x] Drive creator and CRM Notes creator filters: lazy sources in the existing
  desktop submenu and mobile drawer, bounded search/browse, and independent
  persisted-ID resolution. Self is an explicit pin, selected/unknown IDs survive
  off-page searches, and Only changes only its own group.
- [ ] Tasks, Soup, and CRM owner filters: searchable pages plus explicit
  resolution of persisted selected IDs. Tasks currently passes the whole people
  catalog to its AI filter planner; replacing that catalog with a suggestion page
  would silently lose people and must not be used as a migration shortcut.
- [x] Calendar search organizer/attendee filters: bounded suggestion pages and
  separate selected-email lookup, with desktop/phone focus and keyboard coverage.
  Render resolved names through `UserIcon.name` rather than filling the global
  name store again. Calendar guest editors remain on the migration list.
- [ ] Onboarding: bounded same-domain lookup instead of collecting every contact email.
- [ ] Imports: batch exact matching of the imported assignees, plus bounded picker search.
- [ ] Database SQL `people`: move filtering/aggregation to an appropriate execution
  boundary. Paging everyone and concatenating the pages in JS is not a solution.
- [x] Contact debug view: visible counts, search and paginated inspection; JSON
  export contains only the current window. Desktop/phone browser coverage uses
  the production reader/window/inspector with bounded stand-in cache/network sources.
- [ ] Bound and account-scope the shared display-name cache. Retain active/selected
  names without creating eviction/refetch loops; TTL alone is not a size bound.
- [ ] Remove `useContacts()`, `useContactsQuery()`, the full-list query options,
  and obsolete derived arrays once all callers have migrated.

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

Keep each phase incremental and update this checklist as work lands. The first
implementation slice is backend contract -> bounded hydration -> one cached contact
search consumer; do not claim the whole-app memory issue solved at that milestone.
