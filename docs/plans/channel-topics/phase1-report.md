# Channel Topics — Phase 1 implementation report

## Built

- Added team topics, many-to-many channel filing, and the complete per-user topic preferences table. Phase 1 uses only `sort_position`; topic collapse and sort mode are stored in per-user web view storage.
- Added the channels domain service and port, PostgreSQL adapter, and document storage service router. Topic reads return team-visible topic names and counts, with channel IDs limited to channels where the caller is an active participant. Topic writes require membership in the owning team, and filing accepts only team channels from that team.
- Extended channel conversion to accept an optional `topic_id`. Channel owner/admin authorization remains on the conversion path. Conversion, guest removal, and topic filing use one database transaction.
- Wrapped the new routes in the TypeScript SDK and regenerated the web OpenAPI client schemas.
- Added the `ENABLE_CHANNEL_TOPICS` feature flag at sidebar composition. With it enabled, the rail shows Favorites, Topics and Uncategorized, then External, Private, and Direct messages. Topic menus, channel move and remove menus, collapse peek rows, drag and drop, the create menu, topic picker, and four topic order modes are included. Conversion entry points share one confirmation dialog.
- Updated the app agent guide for the new sidebar and creation flow.

## Decisions

- The database's actual team table is `team`, so the migration references it (the plan sketch says `teams`). Application-generated UUIDv7 topic IDs follow the repository style guide.
- Topic sort mode and collapse state remain per-user client preferences in phase 1. Custom positions are server-persisted. The additional preference columns are present with defaults for later phases but are not read or written by phase 1 code.
- The feature flag defaults off until enabled by the remote flag or `ENABLE_CHANNEL_TOPICS` environment flag. Existing sidebar rendering and notification indicators remain available when off.
- The local default `macrodb` migration history referenced an unavailable migration, so migration and SQLx preparation used a new disposable `channel_topics_test` database. No existing database or volume was reset.

## Checks

- `sqlx migrate run` against `channel_topics_test`: passed.
- `cargo test -p channels` with `SQLX_OFFLINE` unset and `DATABASE_URL` set to `channel_topics_test`: 24 passed.
- `cargo test -p channels --features inbound,outbound` with the same database: 340 passed, including the participant-scoped PostgreSQL topic read test.
- `bun run type-check` in `apps/web`: passed.
- `bun run check` and `just coverage` in `packages/sdk`: passed.
- `just check`: passed (warn-only oxlint notices remain).
- Browser exercise: pending local stack startup.

## Scope

Notification levels, new mention indicators, hidden topics, subscriptions, browse, and smart topics were intentionally left for later phases. No commit was created.
