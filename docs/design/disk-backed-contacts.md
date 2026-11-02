# Disk-backed contacts

**Status:** phase 1 backend contract implemented. Phase 2 now has cache-side
contact hydration, bounded page retention, a `person` projection, and a generated
cursor-only backfill result. No background contact runner or UI consumer is wired;
the frontend still retains the full directory.
**Next step:** wire account/generation-guarded, checkpointed hydration, then the
first bounded cached contact consumer. Reject stale payloads before cache writes,
not merely when saving their continuation.

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
- Filters, calendar editors, onboarding, imports, debug views, and the database SQL
  `people` source also request the full directory.

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

## Phase 2 — cache ingestion and query-driven search

- [ ] Hydrate one bounded page at a time, persist it, then release its payload.
  Keep checkpoints scoped to the account and durable storage generation.
- [x] Omit contact page and exact-lookup wrappers during core hydration. Foreground
  contact queries share the existing 64-page / 512 KiB viewer-snapshot budget
  with Soup. `ContactDirectoryBackfill` marks nodes `@cacheOnly` and generates
  its cursor-only result; this alone is not an account-safe background runner.
- [x] Project `GraphqlContact` names/emails into `person` through the existing
  covering index and borrowed-row ranker (projection version 5). Public `User` /
  `GraphqlUser` profiles no longer imply contact membership. No timestamps are
  invented from relationship metadata.
- [ ] Materialize bounded `IUser` windows with target `userId` as `IUser.id`;
  the viewer-scoped `GraphqlContact.id` is a cache key, not a DM/navigation target.
- [ ] Preserve DM recency, deduplication, and secondary-inbox exclusions. Ranking
  facts needed to choose the top results must apply before the result limit;
  relationship `updated_at` is not automatically equivalent to DM activity.
- [ ] Add shared contact operations under `apps/web/src/lib/queries/contacts`:
  bounded search, cursor-based browse, explicit ID/email resolution, and
  loading/error/synchronization status. These replace the all-array contract.
- [ ] Bound retained result windows and query-history caches, not just SQL result
  counts. Keep selected contacts independently of the current suggestions.
- [ ] For cold, disabled, or unsupported caches, use bounded server reads through
  the same frontend contract. Never fall back to downloading the full directory.
- [ ] Account for older native engines: runtime GraphQL metadata can accept a new
  type, but its handwritten search projection still needs a rebuilt native binary.
  Gate local contact-search capability rather than treating missing support as no matches.
  Search responses now advertise `projectionVersion`; missing or below 5 means
  the engine lacks contact projection/retention. Frontend gating is not wired yet.
- [ ] Wire Quick Access `person` materialization and query-driven shared recipient
  selection; remove global contact indexing and full-directory recipient transforms.

### Synchronization: keep the first implementation small

Use resumable paginated hydration and coalesced refreshes rather than introducing
a new change-log subsystem. Existing `contacts_invalidation` notifications should
schedule bounded work, not cause a complete 100k-contact scan on every event.
Choose a refresh/coalescing policy that prevents continuous rescans under activity.

Track cold, partial, complete, and failed synchronization distinctly. Discard stale
async responses after account/generation changes. Interrupted or failed scans never
prove that omitted contacts were removed.

Name freshness needs an explicit policy: contact-relationship timestamps do not
capture profile or email-contact name updates. Address this through bounded name
refresh and directory refresh behavior; do not claim graph timestamps synchronize
all display fields. Determine removal reconciliation from authoritative source
semantics, not absence from an incomplete scan.

## Phase 3 — eliminate remaining full-list consumers

- [ ] Email recipients, channel creation/invites, sharing, calls, and other
  `useCombinedRecipients()` consumers: query-driven suggestions and separate selection.
- [ ] Calendar guests, event editors, participant menus, and mentions: bounded
  search plus explicit resolution of attendees/participants already present.
- [ ] Drive, Tasks, Soup, CRM, and calendar people filters: searchable pages plus
  explicit resolution of persisted selected IDs.
- [ ] Onboarding: bounded same-domain lookup instead of collecting every contact email.
- [ ] Imports: batch exact matching of the imported assignees, plus bounded picker search.
- [ ] Database SQL `people`: move filtering/aggregation to an appropriate execution
  boundary. Paging everyone and concatenating the pages in JS is not a solution.
- [ ] Debug views: counts and paginated inspection, not the full directory.
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
