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
- `src/api/middleware/crm_access.rs` adds the optional `x-macro-crm-access` retirement hint only for `x-macro-crm-access-signal: 1`; other requests skip signal authentication and lookup. A per-instance 10,000-user LRU coalesces each resident user's lookups and memoizes results/failures/cancellations for three non-sliding seconds from lookup start; admission omits the hint if it would evict an active lookup. The primary read runs concurrently with the handler (200 ms lookup-future budget, 250 ms total signal budget after authentication extraction); failed or expired hints are omitted. This cache never authorizes a record: domain receipts and `GET /crm/member-access` remain fresh. Clients treat a missing hint as unknown and verify changed hints through current authority before changing cache policy.
- `src/api.rs`: route module list — `documents`, `items`, `entity`,
  `folders_query`, `graphql_soup`, `threads`, `annotations`, `history`,
  `pins`, `recents`, `notification`, `instructions`, `internal`.
- `/databases/query` mounts the `databases_sql` HTTP adapter, sharing the database/access services and the primary Soup reader; SQL authorization stays in its domain service. Browser people SQL executes separately in local Turso; there is no dedicated `/databases/read` endpoint or deployment prerequisite for browser execution.
- `src/service/task_templates.rs`: composes task-template policy with primary-backed Teams roles; `src/api/task_templates.rs` exposes versioned REST routes, including replay-safe client creation IDs. See `docs/guides/task-templates.md`.
- `/channel-labels` retains legacy participant-only label semantics; additive `/channel-sections` mounts `channel_labels` with `for_sections` services for exclusive manual or name-rule membership and visible unjoined team channels.
- `src/service/saved_views.rs`: composes saved-view storage with the primary-backed Teams repository, reusing `get_user_teams` and `get_all_team_members`. REST and GraphQL share its owner-only domain policy. `PUT /saved_views/definitions/{id}/appearance` changes shared icon/color metadata without advancing the filter revision or timestamp, and creation accepts optional initial appearance. `src/api/saved_views/definitions.rs` is the SDK's REST adapter over the same `SavedViewApi` as GraphQL (kinds, revisions, sharing, order); the legacy `/saved_views` routes beside it share the CRM configuration-kind permission gate. All three use the one `ApiContext::saved_views` service built in `server.rs`, whose `outbound/saved_view_changes.rs` notifier pushes `saved_views_changed` through the gateway on `event_broker_tracker`, resolving team members off the request path.
- Personal contact pages use `graphql_contacts` and the contacts directory service.
  Compose primary-backed graph and name readers in `server.rs`, and insert the
  context through the shared GraphQL HTTP/websocket request-data function.
- Insert `task_dependency_loader` alongside the property loader for both HTTP and websocket requests; dependency facts use the shared properties domain and canonical document access receipts.
- `src/api/graphql_soup.rs`: the `/items/soup/graphql` (+
  `/items/soup/graphql/ws` subscriptions; mounted under `ITEMS_PATH`, and
  `no_scope_reaches_graphql_where_it_is_mounted` holds `agent_correlation`'s
  `ANY_WRITE` to that mount) GraphQL API — the frontend's main read path for Home/Recent/
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
- `GET /threads/{thread_id}/channel-shares` lists explicit grants for an
  authenticated thread owner. The read checks current membership in each
  returned channel and sends the channel metadata needed by the roster.
- `src/outbound/docx_export.rs`: primary-database parts and immutable DOCX export
  objects keyed by part paths/hashes. The export route maps the documents domain's
  pending result to 409 with `Retry-After`; never reuse document-id-only archives.
  Location and export URLs share signing helpers in `src/service/cloudfront.rs`.
- The `refresh_calendar` nudge for a new request to join a calendar event,
  which this service hosts while answers belong to `calendar_service`, is
  `calendar_events`' `GatewayCalendarRefresh`, composed in `server.rs`. It
  finds delegates by `link_id` alone, as the request list admits them;
  `get_primaries_for_link` also filters on the child, which a promoted shared
  mailbox's older events do not carry as their owner. Nudges follow a
  committed write, so they share `event_broker_tracker`'s bounded shutdown
  drain with event broker publishes.
- `src/service/delete_document_worker.rs`: background worker handling document
  deletion side effects (feature-gated: `delete_document_worker`). Property cleanup runs before document deletion to retain task subtype metadata; cleanup failures leave the message unacknowledged for retry.
- `src/released_attachments.rs`: drains `released_email_attachment_documents`
  on LISTEN `email_attachment_documents_released` and a one-minute sweep,
  through the documents domain's `ReleasedAttachmentService`, which trashes
  email attachments whose mail is gone. Runs on the consumer tracker.
- `src/service/conn_gateway.rs`: pushes realtime updates through
  `connection_gateway` (feature-gated: `connection_gateway`).
- `src/server.rs` also runs `bots::inbound::profile_consumer`, which pushes a
  changed bot's current profile to the people who see it (see
  `crates/bots/README.md`).
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

- Both `/search` mounts share `ApiContext::search_lanes`, one per process, so a
  caller's unified searches queue in one lane (`search_service`'s
  `domain::search_lanes`) whichever mount they reach.
  `ApiContext::api_key_search_buckets` is the Redis token bucket behind the
  API-key search allowance, shared by every process. It holds one lazy
  `ConnectionManager` built at startup, so a burst of draws shares one
  connection; it connects on the first draw and adds no startup dependency of
  its own (startup still awaits Redis for `RedisLogStreamConsumer::connect`).
- The REST `/items` routes and `/search` hide Macro's own sign-in emails from a program (`hide_sign_in_emails_from_programs` in `src/api.rs`), so a code-mode run cannot read a sign-in code from workspace previews or search hits. GraphQL (`/items/soup/graphql` and its websocket) refuses programs outright: a query picks its own fields, so no rewrite can find the email. Nothing program-side calls it.
- Inject the shared PostHog client into CRM's thread-exclusion gate; missing or
  failed `enable-crm-thread-exclusions` evaluation must refuse API writes.
- Inject the same client into CRM's selective contribution gate. The owner-only
  policy API stays default-off for grants; GET never initializes identity,
  including when the flag is on. Keep its OpenAPI contract and generated storage
  SDK current; public wrappers live in `macro.crm.emailPrivacy`.
  Inject CRM rule discovery into both primary and replica EmailPgRepo instances;
  CRM-scoped reads still select the primary and retain typed resource errors.
  Keep the email-policy enum closure modifier in `api/swagger/email_policy.rs`
  until schema generation propagates `deny_unknown_fields` to variant objects.

- Register add-only contact email and personal-provider company setters with required request fields in OpenAPI together;
  the CRM domain owns authorization, normalization and relation invariants.

- Provision required `POSTHOG_API_KEY` before startup; the flag client
  evaluates `enable-programmatic-calls` per caller for the explicit call start,
  join, and leave routes; failures disable those routes.

- Compose Soup without a separate property-definition reader; REST and GraphQL validate DATE range inputs before calling the service.

- Several behaviors are Cargo-feature-gated (`connection_gateway`,
  `delete_document_worker`, `location_check`, all on by `default`) — a feature
  disabled locally can hide a bug that only shows in deployed builds.
- CRM-scoped Soup email previews read the primary so consent withdrawal and
  exclusions take effect without replica lag; ordinary inbox lists keep the replica.
- The list Soup reader gets its own CRM service, which reads the Sales views'
  activity edges from the replica (`with_activity_edges_replica`) after checking
  current permitted teams on the primary. Its record and other access reads,
  and the primary-backed Soup reader, keep the primary.
- Ordinary Soup GraphQL reads a replica with multi-second lag; a read immediately after
  a write through the same request needs the primary-reading loader, not the
  default one — see `crates/graphql_soup`.
- A Soup page with `channelReads: PRIMARY` runs on `PrimaryChannelSoup`, the
  list Soup service built by `list_soup` with its channel list on the primary,
  where REST `GET /comms/channels` reads it. Only the channel query moves;
  other entity types and the shared frecency, favorite and CRM backends keep
  their pools. Only channel directory pages are admitted; see
  `crates/graphql_soup`.
- Pool limits live in `src/db_pools.rs`, per task, with the readonly pool set
  apart from the primary. Dev's readonly pool keeps 2–20 connections: three
  tasks allow 60 replica sessions, or 120 while a rolling deployment overlaps
  all three. Production's keeps 10–50, so 7 tasks allow 350 and a deployment
  700. Both pools wait 30 s for a connection.
- A read is never retried on the primary. The only fallback is at startup: a
  task that cannot reach the replica reads the primary for its lifetime and
  reports no `readonly` pool metrics.
- Sessions carry the application name `document_storage_service`, so
  `pg_stat_activity` and database monitoring can attribute them.
- Each pool reports `db.client.connection.count` (state `idle`/`used`),
  `db.client.connection.max`, `db.client.connection.used` (a histogram of the
  in-use count sampled every second, for peaks the once-a-minute gauges miss)
  and `db.client.connection.wait_time`, tagged
  `db.client.connection.pool.name` (`primary`/`readonly`). The wait is a
  once-a-second probe, not a per-query timing: sqlx acquires inside each query.
  It reports zero while a connection is idle. When none is, it waits like a
  query: in the queue at the limit, or for a new connection below it. It does
  not time the health check sqlx runs on an idle connection, so sqlx's
  slow-acquire warnings can appear while the probe reads zero.
- The GraphQL calendar feed (occurrence ranges and `calendarChanges`) reads the
  primary, like the REST calendar routes: a `refresh_calendar` poke goes out as
  a write commits, so a replica-backed delta misses the change it announces.
- Thread edits (`api/threads/edit_thread.rs`) and saved view definition
  creates and updates refuse sharing changes from a scoped agent session
  (`agent_correlation::context::refuse_sharing`, 403); a new sharing field
  joins that check. Every agent session scope is refused `/soup/graphql` and
  its WebSocket (`agent_correlation::scope`).

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
Session-only PUT/DELETE `items/{item}/favorite` changes a viewer's private
preference with view access; it bypasses credential leases and version guards.
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
