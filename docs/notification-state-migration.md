# Notification state cutover

Implementation and local verification are complete. The migration has been applied to
local development/test databases only; production rollout remains an explicit,
coordinated operation.

## Model and agreed semantics

`user_notification.state` is a non-null PostgreSQL `notification_state` enum:
`unseen | seen | done`, defaulting to `unseen`.

| Operation | Unseen | Seen | Done |
| --- | --- | --- | --- |
| Mark seen | Seen | Seen | Done |
| Mark done | Done | Done | Done |
| Reopen / undo done | Unseen | Seen | Seen |

Transitions are atomic and idempotent. A late mark-seen never reopens done.
`seen_at` / API `viewed_at` are retained historical metadata, not a second source
of lifecycle state. Marking seen preserves an existing timestamp. Completing or
reopening does not fabricate a view timestamp. Sent and deleted status remain separate.

Backfill includes soft-deleted rows and gives done precedence:

1. Legacy `done = true` becomes done, even when `seen_at` is null.
2. Otherwise, a recorded view becomes seen.
3. Otherwise, the notification is unseen.

## Contracts and filters

- REST rows, realtime patches, and AI tool results expose lowercase `state`.
- GraphQL notifications expose `state: NotificationState!` (`UNSEEN`, `SEEN`, `DONE`).
- HTTP list queries accept comma-separated states, e.g. `?states=unseen,seen`.
  Omission defaults to active; `?states=` explicitly selects all states.
- AI ListNotifications takes a state array, with the same default and empty semantics.
- Item ASTs use `NotificationState(NotificationState)` instead of boolean literals.
  Filter DTOs use `notification_filters: { states: [...] }`. Empty means no restriction.
  Legacy boolean DTO fields are rejected rather than silently ignored.
- Exact seen excludes done. Active means **exists unseen OR exists seen**, not
  **NOT exists done**: entities can have several notifications in different states.
- Separate AND literals can be witnessed by different notifications. Foreign entities
  preserve arbitrary pure notification AND/OR/NOT expressions using the eight possible
  sets of present states. Their pre-existing restriction on mixed metadata/notification
  OR/NOT subtrees remains fail-closed.
- Notification state selections are deduplicated before AST expansion, bounding a DTO's
  state union to three leaves. Candidate gates push OR/NOT only when the complete
  subtree is supported; unsupported branches are never silently removed.
- Email read/unread is independent: `EmailLiteral::Read(bool)` / `EmailFilters.is_read`.
  Email inbox visibility is also independent of user notifications.

Both frontend AST compilers translate existing persisted UI `...Seen` / `...Done`
filter intent into state selections. Normalized caches reset when the GraphQL schema
hash changes. `cache-wasm` was bumped to 0.6.7 so version-gated dev builds rebuild too.

Opaque Soup cursors also embed the filter AST. Pre-cutover cursors containing boolean
`ns` values or the removed `nd` literal are intentionally incompatible: clients must
refresh and restart pagination during the coordinated cutover. Do not add a boolean
fallback to the canonical state enum: legacy `ns: true` can match both seen and done,
so mapping it to exact seen would silently change the query. Retaining old cursors
would require a separate, versioned expression-level translator.

## Frontend and SDK behavior

- Notification badges, row predicates, and read markers use state, not timestamps.
- Realtime patch decoding requires a valid state. The metadata fallback cannot admit
  an invalid or missing lifecycle state.
- Active/history query partitions remain distinct when applying patches, inserting
  notifications, or restoring undo snapshots. Undo snapshots restore as seen, including
  snapshots originally taken while the notification was unseen.
- Local state overlays protect against stale fetches and late mutation failures.
  Rollbacks are conditional on the specific overlay they installed; an older failure
  cannot roll back a newer acknowledgment or done action.
- The generic GraphQL scalar cache optimistically writes only unconditional Done.
  Seen/reopen are conditional operations, so their scalar state and historical timestamp
  await authoritative replies. View-local overlays still provide optimistic feedback;
  this avoids guessing a Seen patch that could reopen Done on another surface.
- Soup restoration recognizes state unions and respects the arriving notification's
  exact state. It does not mistake a negated or mixed-OR constraint for an active-only view.
- SDK `state()` is authoritative; convenience `seen()` / `done()` are derived from it.
  SDK list options support exact state selections.

## Verification completed

- Migration up/down round trips for all four legacy combinations, including deleted
  rows and invalid done/unseen rows, plus defaults and enum/not-null constraints.
- Complete persisted transition matrix, retries, concurrent seen/done requests,
  user isolation, digest exclusion, and original-timestamp retention.
- Exact-state, union, negation, multiple-witness, optimized/fallback, and email
  read/state independence tests across notification and entity repositories.
- Affected backend, GraphQL schema-composition, projection, SDK, and cache-core suites.
- Root SQLx preparation and offline service builds; generated metadata is checked in.
  Static SQL uses checked macros; dynamic AST SQL binds values and uses trusted fragments.
- Wasm filter materialization and a rebuilt versioned browser cache.
- Regenerated GraphQL SDL/documents/cache schema, relevant OpenAPI clients, SDK clients,
  and cognition AI-tool schemas.
- Full frontend typecheck and generated-cache-schema check.
- Full frontend suite after rebasing and fixing PR review findings: **4,499 passed,
  one pre-existing todo**, across 493 test files. CI's exact TypeScript command also passes.
- Review regressions cover mixed Inbox state selections, inbox-scoped cache keys with
  sibling state constraints, and untracked optimistic rollback snapshots. The new
  regression tests failed before the fixes and pass afterward.
- Biome checks on tracked frontend source. Ignored browser-test build bundles can make
  an unrestricted local `biome check` report diagnostics on minified generated JS.
- Local EXPLAIN plans use the foreign-entity source index, per-user notification covering
  index, and notification ordering index. This is not a production-volume benchmark.

### Browser verification

A dedicated `notifstate` stack (`--port-base 24000`, no Doppler) was used, not hosted dev.
The static app is at `http://localhost:24009/app/`; a separate local GraphQL-enabled
Vite session on port 3007 used the same backend.

With a new local account and its onboarding notification, both transports were exercised:

- Opening the unseen notification produced seen and cleared the unread badge.
- `e` marked it done and removed it from the active inbox.
- `Ctrl+Z` restored it as seen, without an unread badge.
- Repeated reads, done, and undo retained the exact original viewing timestamp.
- A delayed seen request against done left both state and timestamp unchanged.
- Unread filtering hid the restored seen row; Read filtering showed it.

## Coordinated production rollout

1. Prepare the new backend/frontend artifacts, including a fresh wasm build. Assess
   production backfill size and index-build time, and take the appropriate backup.
2. Quiesce old writers and drain old-format queued notification/realtime envelopes.
   Do not replay old-format envelopes into new consumers without explicit handling.
   Stop old readers/writers before the migration drops `done`.
3. Apply the generated `user_notification_state` migration during the cutover window.
   Do not deploy this migration independently of the corresponding application change.
4. Start the new services/consumers and require clients to refresh onto the new bundle.
   This is intentionally not a rolling-compatible protocol change.
5. Check state counts, unchanged historical timestamps, active/history lists, read/done/
   undo behavior, and query plans with production statistics.

Rollback is coordinated too: stop state-based code before applying the down migration
and restoring the old binaries. The down migration derives the old boolean from current
state and preserves timestamps; it cannot recover pre-cutover state/history. In particular,
seen rows without a recorded view cannot be represented exactly in the old model.
