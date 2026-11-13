# document_storage_service

## What it is

Documents feature: deployable service (DSS) hosting document/item CRUD, the
"Soup" GraphQL API, and most cross-entity concerns — history, annotations,
threads, pins, recents, notifications, folders, activity.

## Start here

- `src/api/sync.rs`: dedicated authenticated `/sync/ws` endpoint; `crates/sync_router`
  owns multiplex routing and cancellation. Sync-service still owns document state
  and validates scoped tokens. DSS shutdown drains these upgraded sockets.
  This binary WebSocket protocol is intentionally outside the REST OpenAPI/SDK surface.
- `src/api.rs`: route module list — `documents`, `items`, `entity`,
  `folders_query`, `graphql_soup`, `threads`, `annotations`, `history`,
  `pins`, `recents`, `notification`, `instructions`, `internal`.
- `/databases/query` mounts the `databases_sql` HTTP adapter, sharing the database/access services and the primary Soup reader; SQL authorization stays in its domain service. Browser people SQL executes separately in local Turso; there is no dedicated `/databases/read` endpoint or deployment prerequisite for browser execution.
- `/channel-labels` retains legacy participant-only label semantics; additive `/channel-sections` mounts `channel_labels` with `for_sections` services for exclusive manual or name-rule membership and visible unjoined team channels.
- `src/service/saved_views.rs`: composes saved-view storage with the primary-backed Teams repository, reusing `get_user_teams` and `get_all_team_members`. REST and GraphQL share its owner-only domain policy. `src/api/saved_views/definitions.rs` is the SDK's REST adapter over the same `SavedViewApi` as GraphQL (kinds, revisions, sharing, order); the legacy `/saved_views` routes beside it serve CRM unchanged. All three use the one `ApiContext::saved_views` service built in `server.rs`, whose `outbound/saved_view_changes.rs` notifier pushes `saved_views_changed` through the gateway on `event_broker_tracker`, resolving team members off the request path.
- Personal contact pages use `graphql_contacts` and the contacts directory service.
  Compose primary-backed graph and name readers in `server.rs`, and insert the
  context through the shared GraphQL HTTP/websocket request-data function.
- `src/api/graphql_soup.rs`: the `/soup/graphql` (+ `/soup/graphql/ws`
  subscriptions) GraphQL API — the frontend's main read path for Home/Recent/
  search ("Soup" items); see `crates/graphql_soup` for resolvers/loaders.
- `src/server.rs`: composition root, including access-request routes and the
  tracked delivery dispatcher; `src/outbound/access_requests.rs` composes the
  notification/withdrawal/realtime ports. Policy lives in `crates/access_requests`.
  It also builds the attention feeds (Home's work feed and the notifications
  inbox) from one set of `attention_feed` adapters, triggers and viewer lookup.
- `src/external_chat.rs`: composes `ExternalChatService<WhatsAppProvider>`,
  mounts `/external-chats` (`crates/external_chat`) and `/whatsapp`
  (`crates/whatsapp_linked`) and runs the notification/import worker (LISTEN
  `external_chat_effects`, `whatsapp_media_ready`; attachments become static
  files through the static file service, which also deletes released ones) and
  the `external_chat_changed` pusher (bare connection-gateway events to the
  account owner or a chat's viewers);
  enforces a Redis-shared one-send-request-per-second budget per user.
  No backend switch: the web flag `enable-whatsapp-linked` gates rollout.
- Guest call chat is mounted outside account auth at `/call/guest-chat/{call_id}`;
  `call` verifies the RTC session and `messages` owns the shared discussion.
- Authenticated call routes are composed from `crates/call` under `/call`;
  `src/api/swagger.rs` lists their OpenAPI paths and schemas, while
  `src/server.rs` supplies the per-caller start limiter.
- `src/service/entity_mutation.rs`: generic entity-mutation plumbing used
  across item types. Folder duplication, trash, restore and permanent delete
  run on their own task (`run_on_own_task`), so a dropped request cannot stop
  them partway; duplication copies documents and chats through
  `entity_mutation/project_contents.rs`, the projects domain's
  `ProjectContentCopier` port.
- `src/outbound/docx_export.rs`: primary-database parts and immutable DOCX export
  objects keyed by part paths/hashes. The export route maps the documents domain's
  pending result to 409 with `Retry-After`; never reuse document-id-only archives.
  Location and export URLs share signing helpers in `src/service/cloudfront.rs`.
- `src/outbound/calendar_refresh.rs`: the `refresh_calendar` nudge for a new
  request to join a calendar event, which this service hosts while answers
  belong to `calendar_service`. It finds delegates by `link_id` alone, as the
  request list admits them; `get_primaries_for_link` also filters on the child,
  which a promoted shared mailbox's older events do not carry as their owner.
  Nudges follow a committed write, so they share `event_broker_tracker`'s
  bounded shutdown drain with event broker publishes.
- `src/service/delete_document_worker.rs`: background worker handling document
  deletion side effects (feature-gated: `delete_document_worker`).
- `src/service/conn_gateway.rs`: pushes realtime updates through
  `connection_gateway` (feature-gated: `connection_gateway`).
- `README.md`: local setup (`just run_dbs`, `.env` from `.env.sample`).

## Scope

- Owns: document/item HTTP CRUD, the Soup GraphQL schema, and cross-entity
  surfaces (history, annotations, threads, pins, recents, notifications,
  folders, saved views, activity).
- Not here: document content/collaboration itself → `crates/collab_surface`
  and the sync service; AI chat → `document_cognition_service`.

## Recipes

- Add a Soup GraphQL field: resolver/loader in `crates/graphql_soup` →
  `src/api/graphql_soup.rs` if wiring changes.
- Add a REST route: `src/api/<area>.rs` → `src/api.rs` (router) →
  `src/api/swagger.rs`; register query-only schemas explicitly in its components list.
  Then `bun run gen-api cloud-storage` in `apps/web` regenerates
  `service-storage/openapi.json` and its clients.
- Add a config value or feature-gated behavior: `src/config.rs` → the
  `[features]` table in `Cargo.toml` if it should be independently toggleable.

## Checks

- `cargo test -p document_storage_service` (`SQLX_OFFLINE` unset; needs
  MacroDB + Redis — `just run_dbs` from repo root; DynamoDB local via
  `just ensure::ensure_dynamodb` from `services/document_storage_service`,
  whose `justfile` declares the `ensure` module).
- After query changes: `nix develop --command just prepare_db` from the repo root.

## Gotchas

- Register add-only contact email and personal-provider company setters with required request fields in OpenAPI together;
  the CRM domain owns authorization, normalization and relation invariants.

- Provision required `POSTHOG_API_KEY` before startup; `enable-call-channel-thread`
  evaluation has a 300 ms timeout and keeps the call's own chat on failure.
- The same flag client evaluates `enable-programmatic-calls` per caller for the
  explicit call start, join, and leave routes; failures disable those routes.

- Compose Soup without a separate property-definition reader; REST and GraphQL validate DATE range inputs before calling the service.

- Several behaviors are Cargo-feature-gated (`connection_gateway`,
  `delete_document_worker`, `location_check`, all on by `default`) — a feature
  disabled locally can hide a bug that only shows in deployed builds.
- CRM-scoped Soup email previews read the primary so consent withdrawal and
  exclusions take effect without replica lag; ordinary inbox lists keep the replica.
- Ordinary Soup GraphQL reads a replica with multi-second lag; a read immediately after
  a write through the same request needs the primary-reading loader, not the
  default one — see `crates/graphql_soup`.
- Dev's readonly pool keeps 2–20 connections per task, independently of the
  primary pool's 25–100. Once all tasks use this cap, three dev tasks allow 60
  sessions, or 120 while a rolling deployment overlaps all three. Old tasks
  retain their previous cap until they drain during the initial rollout.
  Production and local pools retain their existing primary/readonly limits.
- The GraphQL calendar feed (occurrence ranges and `calendarChanges`) reads the
  primary, like the REST calendar routes: a `refresh_calendar` poke goes out as
  a write commits, so a replica-backed delta misses the change it announces.

## Related

- Rules: `.agents/rules/rust/db.md`, `.agents/rules/observability.md`

- Negotiate Mail cache profiles through `x-macro-mail-cache-profile` (CORS-enabled HTTP) and `mailCacheProfile` (WebSocket connection init); preserve authenticated connection data and default unknown capabilities to v2.

- The HTTP boundary validates agent correlation; activity consumption restores Kafka envelope attribution before materialization.

## Passwords vault

`/passwords` hosts human-only team vault routes, with policy in `passwords`.
Provision `OPENBAO_ADDRESS`, `PASSWORDS_JWT_ISSUER` and `PASSWORDS_JWT_SIGNING_KEY`
together. Partial configuration fails startup; absent configuration denies vault work.
Human requests evaluate `enable-passwords-v1` for their authenticated user only;
missing, disabled or failed evaluations fail closed. Local explicitly enables it.
Cleanup, reconciliation and internal team purge do not evaluate rollout flags.
The session-only `/passwords/teams/{team}/imports/{import_id}/items` route accepts
normalized import batches up to 4 MiB; its domain service reuses ordinary creation
and TOTP enrollment and records counts-only batch activity.
Postgres stores metadata; values stay in OpenBao. Admission checks current human
account classification and membership, including session-shaped agent accounts.

`src/passwords_cleanup.rs` retries explicit item deletion and TOTP generation erasure
every minute. Empty passes require no provider configuration; retained work checks
provider readiness and failed erasure keeps its journal.
The task tracker cancels and drains the worker. Membership/account deletion never
erases vault items. Internal `/internal/passwords/teams/{team}` DELETE accepts only
service credentials and provider readiness, independently of user rollout. Team cleanup skips
RPC only on authoritative empty metadata rechecked under the existing team lease;
the returned guard stays in the deletion proof through team-row deletion. Retained
state requires acknowledged purge before ordinary cleanup; release the guard before RPC.
- The Soup GraphQL request context supplies session activity subscriptions with the realtime activity consumer and a primary-backed correlation repository; GraphQL checks session visibility before streaming.
