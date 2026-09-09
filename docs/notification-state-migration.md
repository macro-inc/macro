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
- [x] Migrate existing soup/frecency/channel/foreign-entity SQL predicates to read state
      instead of the removed boolean or retained timestamp. Their legacy input ASTs are
      still present until the item-filter/client increment below.
- [ ] Replace item-filter boolean literals with `NotificationState(NotificationState)`;
      support exact states and unions, including active `[Unseen, Seen]` filters.
- [ ] Update soup candidate gates/notified paths, frecency, channels, foreign entities,
      email, GraphQL filter inputs, and filter projections.
- [ ] Separate email read/unread filtering from the old overloaded `NotificationSeen`.
- [ ] Update item-filter HTTP/GraphQL contracts, SDK, frontend filters, notification
      caches, optimistic state, subscriptions, and persisted filter selections.
- [x] Regenerate backend dependency metadata and production SQLx metadata from root.
- [x] Verify migration backfill/rollback, constraints, the full persisted transition
      matrix, concurrent mark-seen/mark-done, exact list filtering, and timestamp retention.
- [x] Run affected-crate tests: notification, notification_state, notification_db_client,
      notification_service, graphql_notification, channels, foreign_entity, frecency, soup.
- [ ] Regenerate client schemas/artifacts after the remaining contract changes.
- [ ] Verify frontend and query plans; update the agent interaction guide.

The implementation is **not cutover-ready** until all application consumers and tests
have moved to state. Do not deploy the generated migration on its own: it drops `done`
and immediately breaks old readers/writers. The migration has been applied **locally only**,
with approval. The backend compiles against the new schema; the frontend/SDK remain on
the old contract and must not be used for cutover verification yet.

## Notification API contract

- Notification rows and realtime payloads expose `state: "unseen" | "seen" | "done"`.
- GraphQL notifications expose `state: NotificationState!` (`UNSEEN`, `SEEN`, `DONE`).
- HTTP list queries accept comma-separated `states`, e.g. `?states=unseen,seen`.
  Omission defaults to active `[unseen, seen]`; `?states=` explicitly means all states.
- The AI list tool takes `states: ["unseen", "seen", "done"]`; omission defaults to
  active and an empty array means all states. Results expose state rather than booleans.
- Exact seen excludes done, even if a done notification has a viewing timestamp.
- Bulk mutation routes retain their intent: seen cannot reopen done; undone yields seen.

## Integration traps

- Exact seen excludes done; active means unseen OR seen, not NOT EXISTS(done).
- Notification literals describe existence of matching user-owned, non-deleted rows.
  Multiple literals can match different notifications on the same entity.
- Foreign-entity notification predicates currently reject OR/NOT. State unions need
  explicit support without changing unrelated metadata predicate semantics.
- Email `NotificationSeen` currently maps to `email_threads.is_read` in one path.
  Keep read/unread semantics on a separate literal rather than silently replacing them.
- Include the legacy `notification_db_client` writes and the duplicate notification
  filters in `channels`, not just the newer notification repository and item-filter AST.
- Preserve viewing timestamps during backfill, including null timestamps on legacy done
  notifications. Do not fabricate historic views to make the timestamp agree with state.
- Stop old services before applying the local cutover migration. SQLx preparation needs
  the new schema, so run it only after approval, using
  `nix develop --command just prepare_db` from the repository root.
- Leave `SQLX_OFFLINE` unset for tests. A DB-backed `cargo test` may itself run migrations;
  migration permission is required before running those tests too.
- The down migration reconstructs the old boolean representation using the current
  state and retained timestamps. It does not recover pre-cutover state/history.
