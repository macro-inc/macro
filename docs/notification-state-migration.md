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
- [ ] Apply migration to the local development/test MacroDB (requires approval).
- [ ] Replace notification rows, patches, queue/realtime payloads, repository ports,
      SQL reads/writes, digest eligibility, and both notification persistence implementations.
- [ ] Replace item-filter boolean literals with `NotificationState(NotificationState)`;
      support exact states and unions, including active `[Unseen, Seen]` filters.
- [ ] Update soup candidate gates/notified paths, frecency, channels, foreign entities,
      email, GraphQL filter inputs, and filter projections.
- [ ] Separate email read/unread filtering from the old overloaded `NotificationSeen`.
- [ ] Update HTTP/GraphQL/AI tool contracts, SDK, frontend filters, notification caches,
      optimistic state, subscriptions, and persisted filter selections.
- [ ] Regenerate schemas/clients, dependency metadata, and SQLx metadata.
- [ ] Verify migration/backfill, individual affected crates, frontend, and query plans;
      update the agent interaction guide.

The implementation is **not cutover-ready** until all application consumers and tests
have moved to state. Do not deploy the generated migration on its own: it drops `done`
and immediately breaks old readers/writers. No migration has been applied in this increment.

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
