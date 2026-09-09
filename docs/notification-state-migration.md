# Notification state cutover

## Approved semantics

- Canonical state: `Unseen | Seen | Done`, persisted as PostgreSQL `notification_state`.
- Creation starts unseen. Marking seen must not reopen a done notification.
- Marking done completes either active state. Reopening done always produces seen.
- All operations are idempotent; persistence must apply transitions atomically.
- Retain `seen_at`/`viewed_at` as historical metadata, never infer state from it.
- Backfill done first, then seen when `seen_at` is present, otherwise unseen.
- Preserve email read/unread separately from notification state.
- Coordinated cutover, not rolling compatibility.

## Progress

- [x] Shared domain state/action model, separate optional PostgreSQL representation.
- [x] Unit coverage for the complete transition table, idempotence, late seen actions,
      serialization, defaults, push-clearing policy, and PG type mapping.
- [x] Generate up/down cutover migration via `cargo sqlx migrate add`.
- [x] Apply migration to local development/test MacroDB after explicit user approval.
- [x] Replace notification rows, patches, queue/realtime payloads, SQL reads/writes,
      digest eligibility, and both notification persistence implementations. Repository
      commands preserve intent (mark seen, mark done, reopen); returned rows use state.
- [x] Replace notification-list filter booleans with exact state selections; update
      HTTP, GraphQL notification objects, and AI notification-tool contracts.
- [x] Replace item-filter boolean literals with `NotificationState(NotificationState)`
      across all entity types. DTOs use `notification_filters.states`; duplicates are
      removed before expansion so the resulting state union has at most three leaves.
- [x] Update soup candidate gates/notified paths, frecency, channels, foreign entities,
      email, GraphQL filter inputs, and filter projections. Candidate gates preserve
      supported OR/NOT subtrees and never partially push down unsupported OR branches.
- [x] Separate email read/unread into `EmailLiteral::Read(bool)` / `EmailFilters.is_read`.
      Actual email notification predicates use viewer-scoped notification rows.
- [x] Update both frontend AST compilers and the REST-to-GraphQL AST mapper. Persisted
      UI boolean intent is translated into exact state unions, not sent as old literals.
- [x] Update SDK state accessors and list selections; check SDK TypeScript and state tests.
- [ ] Finish frontend notification caches, optimistic state, subscriptions, inbox DTO
      helpers, and read/done UI predicates. Full web TypeScript checking still fails on
      these intentionally outstanding old-field consumers (see remaining work below).
- [x] Regenerate backend dependency metadata and production SQLx metadata from root.
- [x] Verify migration backfill/rollback, constraints, the full persisted transition
      matrix, concurrent mark-seen/mark-done, exact list filtering, and timestamp retention.
- [x] Run affected-crate tests: notification, notification_state, notification_db_client,
      notification_service, graphql_notification, channels, foreign_entity, frecency, soup.
- [x] Regenerate GraphQL SDL/documents/cache schema and storage, notification, email,
      and search OpenAPI clients. Sync and regenerate SDK clients.
- [x] Verify affected backend suites, GraphQL schema composition, projection, and wasm
      filter materialization. Frontend filter compilation/mapping suites pass (50 tests).
- [x] Inspect local EXPLAIN plans: foreign-entity source lookup and per-user notification
      checks use indexes; active notification ordering uses the existing user/created index.
      These are local planner checks, not a production-volume performance benchmark.
- [x] Update the agent guide with lifecycle semantics.
- [ ] Regenerate cognition AI-tool artifacts, finish full frontend checks, and verify
      notification read/done/undo interactions in a browser against the new local backend.

The implementation is **not cutover-ready** until all application consumers and tests
have moved to state. Do not deploy the generated migration on its own: it drops `done`
and immediately breaks old readers/writers. The migration has been applied **locally only**,
with approval. Backend, SDK, generated contracts, and frontend AST compilation use state.
The remaining notification UI/cache code is not yet migrated; the full frontend is not
cutover-ready and has known TypeScript errors in those consumers.

## Notification API contract

- Notification rows and realtime payloads expose `state: "unseen" | "seen" | "done"`.
- GraphQL notifications expose `state: NotificationState!` (`UNSEEN`, `SEEN`, `DONE`).
- HTTP list queries accept comma-separated `states`, e.g. `?states=unseen,seen`.
  Omission defaults to active `[unseen, seen]`; `?states=` explicitly means all states.
- The AI list tool takes `states: ["unseen", "seen", "done"]`; omission defaults to
  active and an empty array means all states. Results expose state rather than booleans.
- Exact seen excludes done, even if a done notification has a viewing timestamp.
- Bulk mutation routes retain their intent: seen cannot reopen done; undone yields seen.

## Remaining frontend work

- `features/notifications/notification-source.ts`, notification/entity helpers, badges,
  and mark-message behavior: derive lifecycle state from `state`, never `viewed_at`.
  Optimistic seen must preserve done; undo transitions done to seen only. Keep original
  timestamps and the granular override protection against stale fetch snapshots.
- `lib/queries/notification/user-notifications.ts`: update the handwritten realtime patch
  type/Zod schema, patch application, and optimistic seen mapping. These legacy booleans
  are not all caught by TypeScript because several payloads are handwritten types.
- `lib/service-clients/service-notification/client.ts`: its handwritten list requests still
  send `done`; map list intent to the new `states` query parameter (empty means all).
- `lib/service-clients/service-storage/graphql-soup.ts` and
  `lib/queries/notification/graphql/user-notifications.ts`: map/filter GraphQL `state`
  instead of removed done/seen fields. Normalize GraphQL uppercase to REST lowercase.
- Inbox/search DTO builders under `features/inbox-view/queries/inbox-search.ts` and
  `features/next-soup/filters/inbox-query-filters.ts` still build `done`/`seen` fields.
  Use `states`, retaining independent email read intent as `is_read`. Do not represent
  an impossible intersection with `states: []` (that means no restriction).
- `lib/queries/soup/normalized-cache/operations.ts`: restore/invalidation detection still
  recognizes serialized `NotificationDone` / `nd` literals. Update it for state unions
  and migrate the corresponding tests; preserve no-notification existential semantics.
- Migrate notification factories/tests to state, including done rows with null timestamps.
  Run full web typecheck and targeted cache/source/optimistic tests, not just filter tests.
- Regenerate local cognition tool schemas for the changed ListNotifications contract.
- Browser verification must use the new local backend, not deployed dev (old contract).

Paths above are relative to `apps/web/src`. SDK TypeScript and SDK state tests already pass.

## Integration traps

- Exact seen excludes done; active means unseen OR seen, not NOT EXISTS(done).
- Notification literals describe existence of matching user-owned, non-deleted rows.
  Multiple literals can match different notifications on the same entity.
- Foreign entities support arbitrary pure notification AND/OR/NOT subtrees using a truth
  table over the eight possible sets of present states. Mixed metadata/notification OR/NOT
  retains the old fail-closed restriction. Tests cover all eight sets, separate witnesses,
  deleted rows, and missing/other viewers.
- Email read/unread and actual notification state are independent; do not reintroduce
  the old overloaded seen literal. Integration tests cover read/unread, exact states,
  unions, negation, another user's notifications, and mixed address/state predicates.
- Channel message filter DTOs now reuse the shared `item_filters::NotificationFilters`.
- Preserve viewing timestamps during backfill, including null timestamps on legacy done
  notifications. Do not fabricate historic views to make the timestamp agree with state.
- Stop old services before applying the local cutover migration. SQLx preparation needs
  the new schema, so run it only after approval, using
  `nix develop --command just prepare_db` from the repository root.
- Leave `SQLX_OFFLINE` unset for tests. A DB-backed `cargo test` may itself run migrations;
  migration permission is required before running those tests too.
- The down migration reconstructs the old boolean representation using the current
  state and retained timestamps. It does not recover pre-cutover state/history.
