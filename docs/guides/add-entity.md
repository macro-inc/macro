# Adding an entity type

An entity type is a first-class item with its own id, permissions, and lifecycle
(document, channel, chat, project, task, initiative, database, form, CRM pipeline).
A new one is registered in dozens of places across the backend and web app. The
compiler finds some of them through exhaustive matches. The rest are allow-lists,
deny-lists, `_ =>` arms, SQL constraints, and string unions that accept a missing
kind without complaint. Every launch so far missed at least one and needed a
follow-up fix; those misses are called out inline.

> **Agents never deploy or touch production.** Everything here is code, migrations,
> and generated files in a PR. Deploying the services and Kafka topics is done by a
> person, or by an agent when a person explicitly asks.

## Pick a model to copy

| Building | Copy | Why |
| --- | --- | --- |
| The smallest correct registration | `CrmPipeline` (`crates/crm`, `crm_pipeline_entities`) | Newest kind; touches every core registration point with the least feature code |
| A full-stack kind outside Soup | Forms (`crates/forms`, `apps/web/src/features/block-form`) | Newest end-to-end launch: access, public audience, entity mutation, mentions, Drive catalog, AI tools, SDK entity, agent guide |
| A Soup kind with properties, discussions, activity, MCP | Initiatives (`crates/initiative`, `crates/graphql_initiative`) | Built in clean layers; the [design doc](../design/initiatives-projects.md) records the order |
| A kind on reusable storage | Databases (`crates/databases`, `database_entities`) | Separates storage from the app entity; read the [database-core skill](../../.agents/skills/database-core/SKILL.md) |

Collaborative markdown on the entity (descriptions, notes) follows the
[collab-surface-core skill](../../.agents/skills/collab-surface-core/SKILL.md).

**Find the silent registration points by grepping your model.** After the steps
below, run `rg -l "EntityType::CrmPipeline|'crm_pipeline'"` (substitute your
model's spellings, such as `EntityType::Form` and `'form'`) and visit every hit
outside its own crate and feature. That list is the real
checklist; this guide explains what each entry means.

## Decide the scope first

Not every entity needs every capability. Decide each one up front and write it
into the PR description, because the optional steps fail silently when skipped.

| Capability | Needed when | Section |
| --- | --- | --- |
| Soup kind (Home, Recent, inbox, GraphQL Soup lists) | It appears in unified lists | 8 |
| Own catalog instead of Soup | It only appears in Drive or its own view (forms, databases) | 8 |
| Properties | It has status, assignees, dates, or tags | 6 |
| Discussions and notifications | People comment on it | 10 |
| Channel sharing by mention | Posting it in a channel should grant access | 11 |
| Search | Full-text search must find it | 12 |
| Favorites | It can be starred | 5 |
| Collab surface | It has collaborative markdown | collab-surface-core skill |

Ship in layers, each reviewable alone: type and access, then domain and lifecycle,
then properties and GraphQL, then discussions, then activity, then AI tools, then
the frontend. A layer may land a stub only if nothing consumes it yet. Hide the
UI behind a [feature flag](../../.agents/skills/feature-flags/SKILL.md)
until the backend is complete.

## 1. The entity type

- **`crates/model-entity/src/lib.rs`:** add the `EntityType` variant (strum
  `snake_case`; that string is stored in `entity_access.entity_type`) and its arm
  in `is_valid_entity_access_entity`. Add a round-trip case in `src/tests.rs`.
- **`crates/graphql_common/src/entity_type.rs`:** both directions of
  `GraphqlEntityType`, and `GraphqlSoupEntityType::try_new` (`None` unless it is a
  Soup kind).
- Fix every exhaustive match the compiler now reports. Do not add `_ =>` arms to
  make it compile; each arm is a decision about the new kind.
- **Entity registry (decide explicitly):**
  `crates/entity_registry/shared_entity_registry/src/lib.rs` `RegisteredEntityType`
  plus `crates/entity_registry/entity_registry/src/domain/owner_grant_policy.rs` records one owner per
  resource; team deletion cleans up only registered kinds. The `TryFrom` there has
  a catch-all, and the `entity` table's CHECK constraint lists the allowed kinds,
  so an unregistered kind is rejected silently. Recent kinds did not register;
  if yours does, widen the constraint in a migration.
- Regenerate every client that embeds `EntityType` (storage, cognition,
  connection, notification, properties, search): `cd apps/web && bun run gen-api`,
  then `cd packages/sdk && just update-generated`. Run
  `cd apps/web && bun run gen-dynamic-ui-schema` too; it regenerates
  `crates/ai_tools/src/display_results/schema.generated.json`, which embeds
  `EntityType`.

## 2. Schema and migrations

Follow the [database guide](../development/database.md) for generating
migrations, the SQLx cache, and tests.

- **Table:** a plural `<kind>_entities` table holds identity, name, `user_id`,
  timestamps, and `trashed_at`. Rust types stay singular. Older kinds (`forms`,
  `initiative`) predate this; don't copy their names. Reusable storage gets its own
  table referenced by a foreign key (see database-core).
- **Grant cleanup trigger:** `entity_access`, `entity_properties`, `favorite`, and
  collab surfaces have no foreign key to your table. Add an `AFTER DELETE` trigger
  that deletes the kind's `entity_access` rows, as `database_entities`,
  `crm_pipeline_entities`, and `forms` do. Initiatives lack one, so deleting an
  owner's account can orphan their grants.
- **Enum values get their own migration.** `ALTER TYPE ... ADD VALUE` cannot be
  used in the transaction that adds it, and SQLx runs each file in one
  transaction. Add the value in one migration and backfill in the next (see
  `20260922164805_add_initiative_property_entity_type.sql` and the backfill after
  it). Backfills use `ON CONFLICT DO NOTHING`.
- **Widen CHECK constraints in two steps** on large tables: add the new
  constraint `NOT VALID` with `SET LOCAL lock_timeout`, then `VALIDATE CONSTRAINT`
  in a later migration (`20260922164641_initiative_discussion_parents.sql` and
  `20260927022538_validate_initiative_discussion_parents.sql`).
- **Migrations deploy before the services** and must work with the running binary.
  The databases app-entity split dropped columns the deployed service still read,
  as a deliberate destructive cutover; initiatives dropped a column without a
  compatibility step. Don't repeat either: add, migrate readers, then remove in a
  later PR.

## 3. The domain crate and its hosts

- Create `crates/<kind>` with `domain/{models,ports,service}`, `inbound/`
  (`axum_router`, `toolset`), and `outbound/` (`pg_<kind>_repo`), each behind
  features. Follow the
  [hexagonal architecture skill](../../.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md).
  Add it to `members` in the root `Cargo.toml` and run `just hakari`.
- **Host it in `services/document_storage_service`:** nest the router in
  `src/api.rs`, add state types to `src/api/context.rs`, construct the service in
  `src/server.rs` (not `main.rs`, which is now a stub), and register the OpenAPI
  paths in `src/api/swagger.rs`.
- Other services build the same domain service (agent harness, agent trigger,
  authentication, MCP, document cognition). Give the crate one `wiring.rs` that
  every host calls, as `crates/forms/src/wiring.rs` does. Hosts built separately
  drift: tools in one host have pointed at the wrong service, and writes from a
  host with a no-op event broker never reached the activity feed.
- If it calls `sqlx::query!`, run `nix develop --command just prepare_db` and
  commit `.sqlx/`.

## 4. Access and sharing

The `crates/entity_access/AGENTS.md` recipe is ports, then service, then
Postgres repo.

- **`src/domain/ports.rs`:** `get_<kind>_access`. Add `list_<kind>_access` only if
  a catalog needs every grant at once.
- **`src/outbound/pg_access_repo/queries/<kind>_access.rs`** (registered in
  `queries.rs`): union the caller's `entity_access` rows with link, team, and
  public grants; exclude trashed rows; require the `<kind>_entities` row to exist.
  Copy `form_access.rs` for a public audience, `pipeline_access.rs` for the
  minimum. Add `explain_<kind>_access` behind `explain_binary`, and new
  `AccessGrant` variants in `crates/entity_access/src/domain/models/access_explanation.rs` if the kind
  introduces a new grant.
- **`src/outbound/pg_access_repo.rs`:** the trait impl and the
  `get_team_entity_access` arm.
- **`src/domain/service.rs`, three runtime traps:**
  - `get_optimized_access` ends in `unreachable!`. Missing the arm panics.
  - `get_users_by_entity` ends in a `BadRequest` arm. Missing it silently breaks
    notification and realtime audiences.
  - `get_team_scope_permission` decides bot and team receipts.
- **`src/inbound/axum_extractors/<kind>.rs`** plus `axum_extractors.rs`: handle
  users, bots, internal callers, and anonymous public callers if supported.
- **`crates/entity_access_db_utils/src/lib.rs`:** the channel-share matches.
- **Legacy `SharePermission` storage** is only for initiative-style kinds; new
  kinds keep grants in `entity_access` plus an audience column. If you do use it,
  `share_permission_db_utils::get_share_permission_id` ends in `bail!`, and
  `models_permissions` needs a `TeamShareCreation` variant.
- **Get the permission model right in the first PR.** Initiatives shipped with
  these gaps and needed a dedicated fix:
  - Return the caller's effective access level from the receipt on every
    create, get, and update response; never hard-code it.
  - Sharing changes (members, team, link) are owner-only, even through a general
    update endpoint.
  - Operations that touch two entities (assigning a task) need an edit receipt
    for both, from the same actor, and the domain checks each receipt's type.
  - Default team sharing must succeed when the creator has no team.

## 5. Lifecycle: rename, trash, delete, favorites

- **`crates/macro_db_client/src/item_access/delete.rs`:** put the kind in the arm
  for kinds with `entity_access` rows.
- **Entity mutation:** implement the `crates/entity_mutation` capability traits
  (`RenameEntity`, `TrashEntity`, `RestoreEntity`, `DeleteEntityPermanently`, ...)
  in the domain crate, as `crates/forms/src/domain/entity_mutation.rs` does, then
  add the arms in `services/document_storage_service/src/service/entity_mutation.rs`
  and the adapters in `src/outbound/entity_mutation.rs`. GraphQL mutations
  (`crates/graphql_entity_mutation`) are generic. Initiatives still use a
  hand-written delete route; don't copy that.
- **Owned content:** purge owned documents through the documents domain
  (`crates/documents/src/domain/purge.rs`). Initiatives first reimplemented the
  purge in the service with raw SQL and queue messages, and lost the content
  cleanup when the purge failed after the row was deleted. Owned collab surfaces
  are retired through `OwnedSurfaceService`.
- **Trash auto-purge:** `services/deleted_item_poller` purges trashed items after
  30 days only for kinds it knows; its `AGENTS.md` has the recipe. Forms,
  databases, and pipelines are not there yet, so their trash is never emptied.
- **Favorites (optional):** `crates/favorites/src/domain/mutation_service.rs`
  `validate_favoritable` is exhaustive; recent kinds return unsupported. If you
  enable favorites, also update `crates/graphql_favorite` and clean up `favorite`
  rows on delete, since nothing else does.

## 6. Properties (optional)

- `crates/models_properties/src/shared/entity_type.rs` (maps to the Postgres enum
  `property_entity_type`; see the enum rule in section 2) and
  `src/api/property_target.rs`.
- `crates/properties/src/domain/model.rs` (`canonical_entity_type`,
  `storage_entity_type`; return `None` if the kind has no properties), plus
  `inbound/axum_router/extract.rs`, `outbound/permission_queries.rs`,
  `outbound/permission_service.rs`, and `domain/activity.rs`.
- System properties: `crates/system_properties/src/domain/model/constants/system_property_key.rs`
  and an `attach_<kind>_properties` call at create in
  `crates/system_properties/src/domain/service.rs`.
- Filters: `crates/graphql_common/src/property_filter.rs` and
  `crates/graphql_properties`.
- **Lessons:** a create that fails after properties are attached must remove
  them (`entity_properties` has no foreign key). Reusing another kind's property
  definition (task status) exposed options that are invalid for the new kind;
  give it its own definitions.

## 7. Events and activity

Required for anything people act on; Recent is built from activity.

- **Topic:** add it to `topics!` in `crates/macro_event_topics/src/lib.rs` (and its
  test), then `cargo x kafka-topics`. Never hand-edit
  `.github/kafka-cluster-topics.json`. The topic must exist before the producer
  deploys, or events are lost.
- **Events:** `crates/<kind>/src/domain/events.rs`, serde-tagged, with
  `attribution` (actor and on-behalf-of), published from the domain service.
  Every host must get the real publisher, not a no-op.
- **Activity:** implement `activity::ActivitySource` in
  `crates/<kind>/src/domain/activity.rs` with an exhaustive match. Shared actions
  use `CommonAction`; new `Action` variants go in
  `crates/activity/src/domain/models.rs` (codec and `ActionTag`),
  `crates/activity/src/inbound/toolset/read_activity.rs`, and
  `crates/graphql_activity/src/objects.rs`.
- Register the topic in `services/document_storage_service/src/service/activity.rs`
  (`declare_topics!` and an `ingest` arm). Hard deletes return `Ingest::Purge`.
- **`crates/activity/src/outbound/pg_activity_repo.rs`:** the const fn
  `_rankable_entity_types_are_exhaustive` forces an arm, but the list in
  `rankable_entity_types()` beside it is not checked. Update both.
- **Lesson:** events that reference other entities (an initiative's tasks) must be
  filtered by the viewer's access to those entities, in feeds and in realtime.
- Persisted payloads that readers parse later carry a version, and readers refuse
  unknown versions.

## 8. Soup, Home, and Recent

Choose one shape.

**Soup kind** (initiatives, agent sessions, database rows). GraphQL Soup is the
target, but REST Soup still serves users behind `enable-graphql-soup`, so the
kind must work on both; a kind that only worked on one path showed empty lists
on the other.

- **Model:** `crates/models_soup/src/<kind>.rs` and a `SoupItem` variant in
  `item.rs`.
- **Filters:** `crates/item_filters/src/ast/<kind>.rs`, a field on
  `EntityFilterAst` in `ast.rs` (plus `expand_ast` and `IsEmpty`), and
  `<Kind>Filters` in `lib.rs`. Make the kind **opt-in**: an empty filter excludes
  it. Set the new field in every `EntityFilterAst { .. }` literal the compiler
  reports.
- **Postgres legs** in `crates/soup/src/outbound/pg_soup_repo/`: `<kind>.rs` with
  `<kind>/by_ids.sql` (hydration, registered in both by-ids paths of
  `pg_soup_repo.rs`); `expanded/dynamic/<kind>.rs` with detail and grouped SQL;
  an `include_<kind>` gate in both builders of `expanded/dynamic.rs`; and a
  `NULL::` column in every other detail clause so the UNION lines up. Gate the
  arm off when its filter cannot match: an ungated arm once broke every grouped
  view with a bind-placeholder collision.
- **Feeds** (if it belongs in Recent, inbox, or the Home work feed):
  `candidate_gates.rs`, `touched.rs` (Recent, which reads activity, so section 7
  is a prerequisite), `notified.rs` with `notified/query.sql`, `work_feed/`, and
  the routing arms in `crates/soup/src/domain/service.rs` and
  `domain/service/favorites.rs`. Keep new gates index-only; these queries have
  been cancelled on the replica in production for scanning too much.
- **Prefer a listing port** owned by your crate (`crates/soup/src/domain/models/contact_listing.rs`
  is the pattern) over SQL inside `crates/soup` when the kind's data lives in its
  own crate.
- **Projection:** `crates/soup_filter_projection/src/lib.rs` returns `Ok(None)` and
  `crates/item_filter_index/src/lib.rs` returns `Unsupported(..)` unless you build
  local-first filtering.
- **Realtime:** `crates/soup_realtime/src/inbound/kafka_consumer.rs`: add the topic
  to `declare_topics!`, write `patches_from_<kind>_event`, map property events in
  `soup_entity_type_from_property`, and add the channel-reference arm; add the
  crate to the `consumer` feature in `crates/soup_realtime/Cargo.toml`. Kinds have
  launched without realtime and lists stopped repainting. Patch the single
  entity; never invalidate every Soup list, which once saturated the production
  replica. Delivery is at least once.

**Own catalog** (forms, databases): no Soup kind. Return `None` from
`GraphqlSoupEntityType::try_new`, error in the `graphql_soup` loader arm, and
list the kind through its own query merged into Drive (section 15). It will not
appear in Home or Recent; say so in the PR.

## 9. GraphQL

- **Soup object:** in `crates/graphql_soup/src/objects.rs`, a `GraphqlSoup<Kind>`
  implementing `GraphqlSoupEntity`, its `type_name` and `SoupItem` arms, and
  `impl_common_interface_edges!`; re-export in `lib.rs`. Add the filter input to
  `crates/graphql_soup_filter_input`, edges to `crates/complete_graph/src/edges.rs`,
  and the possible-types assertion (and count) in
  `crates/client/cache-core/src/meta/test.rs`.
- **Kind crate (optional):** `crates/graphql_<kind>` with `context`, `inputs`,
  `loaders`, `mutation`, `objects`, `query`, copied from `crates/graphql_initiative`.
  Compose it in `crates/complete_graph/src/schema.rs`; viewer-scoped reads go under
  `GraphqlUser` (see `crates/complete_graph/AGENTS.md`). Wire it in
  `services/document_storage_service/src/api/graphql_soup.rs` and `src/server.rs`.
- **Read-after-create goes to the primary.** GraphQL Soup reads the replica, which
  lags seconds in production and not at all locally. A new agent session read
  back as "not accessible" and lost its first prompt. Build the by-id loader from
  `primary_entity_soup` in `server.rs`, as `crates/graphql_initiative/src/mutation.rs`
  does, and test with an empty replica fake.
- **Regenerate:** `cargo run -p complete_graph --bin graphql_schema -- static_assets/schema.graphql`,
  then `cd apps/web && bun run gen-graphql` (codegen plus the cache entity resolver
  schema). `sdl_matches_committed_schema_graphql` fails on drift, and
  `bun run check-graphql-cache-schema` (part of `bun run check`, not a separate CI
  job) fails on a stale `apps/web/src/lib/graphql-cache/generated/entity-resolver-schema.ts`.
  Any SDL change resets every client's persisted cache.

## 10. Discussions and notifications (optional)

- **Parent:** a `MessageParent` variant in `crates/messages/src/domain/models.rs`
  and a migration widening the parent-type CHECK (two-step, section 2). The
  compiler then walks you through `crates/messages`, `agent_trigger`,
  `agent_harness`, `agent_session`, `channel_bots`, and `coding_agent_worker`.
  The discussion-parent authorization in `crates/messages/src/domain/service.rs`
  ends in a `Forbidden` arm.
- **Not caught by the compiler:** the zod enum in
  `services/lexical-service/src/endpoints/agent-context.ts` and
  `AgentContextParent` in `packages/lexical-core/utils/agent-context.ts`. CRM
  discussions missed both, and agents mentioned there got no context.
- **Notifications:** a metadata module in `crates/model_notifications/src/metadata/`
  with its `define_notif_event!` variant, a GraphQL event in
  `crates/graphql_notification/src/notification_event/`, the sender in
  `crates/messages/src/outbound/notification_sender.rs`, and
  `BLOCKABLE_NOTIFICATIONS` in `services/notification_service/src/api/user_notification.rs`.
  The web list in `apps/web/src/features/notifications/notification-event-catalog.ts`
  must match it by hand.
- A new **agent-trigger event** shape also needs an arm in
  `crates/webhook/src/domain/ingestion.rs`, or the SSE fan-out drops it silently.

## 11. Mentions and channel references

Four vocabularies must agree:

1. `packages/lexical-core/utils/mentions.ts` (block name to reference type). Its
   match ends in `P._ => 'document'`, so a missing kind becomes a document.
2. `packages/lexical-core/utils/message-references.ts` (allowed reference kinds).
3. `crates/messages/src/domain/mentions.rs` `MessageReferenceKind` and the
   reference authorization in `crates/messages/src/domain/service.rs`. Unknown
   kinds are stored without an access check.
4. `crates/channels/src/domain/models.rs` `ReferencedShareItemType` and
   `reference_sharing.rs`. **`grant_level` defaults any kind to View**, so
   posting a mention shares the entity with the whole channel unless you decide
   otherwise (initiatives opt out). Add the kind to the `matches!` list in
   `crates/channels/src/outbound/pg_channel_reference_share_permissions.rs`, or it
   falls through to legacy share permissions and fails at runtime.

- **Agent prompt:** add the kind to `crates/prompt/src/mentions.rs` and, if it has
  URLs, `crates/prompt/src/mcp_item_links.rs`. Without it agents linked forms as
  plain URLs.
- **Deploy skew:** lexical-service and the web app deploy separately, so either
  can run against the other's previous release. New node data must parse in the
  old composer and vice versa; run
  `bun run check` in `services/lexical-service`, and bump
  `MARKDOWN_VERSION_COUNTER` per `.agents/rules/web/lexical-nodes.md`.
- Record mentions on create as well as on edit, or References misses them.

## 12. Search (optional)

Initiatives, forms, and databases are not in OpenSearch; Cmd+K finds them through
Quick Access (section 15) and agents through their list tools. That is the
minimum.

For full-text search, follow the `AGENTS.md` recipes in
`crates/opensearch_client` (index shapes), `crates/models_search`,
`crates/search_service` (queries), and `services/search_processing_service`
(Kafka consumer and backfill). Agent sessions are the newest example.
`crates/name_search` covers name-only search from Postgres. **Deploys never
create OpenSearch indices or aliases**; that is a manual step for a person, and
upserts must not create an index by accident.

## 13. AI and MCP tools

Follow the [create-ai-tool skill](../../.agents/skills/create-ai-tool/SKILL.md)
and `crates/ai_toolset/TOOL_DESIGN.md`. A new kind adds a whole toolset, which
the skill doesn't cover:

- Register it in `crates/ai_tools/src/lib.rs` (`subagent_toolset()` or the
  host-specific branches of `tools_for`), eager or deferred.
- Give its context to every place `ToolServiceContext` is built:
  `crates/ai_tools/src/build_context.rs`,
  `services/document_cognition_service/src/server.rs` and its
  `services/document_cognition_service/src/api/context/test.rs`, and `services/mcp_service/src/context.rs`. Add it to
  `with_actor` in `crates/ai_tools/src/tool_context.rs`, or agent writes are
  attributed to the default bot. Add a test in `crates/ai_tools/src/test.rs` that
  the tools resolve on every host; hosts have shipped with tools unwired.
- Prompt guidance: a section in `crates/prompt/src/` (see `databases`,
  `crm_pipelines`).
- Web: a renderer in `apps/web/src/lib/core/component/AI/component/tool/` with
  `handler.tsx`, and wording in `apps/web/src/features/block-agent/state/tool-approval-wording.ts`.
- Regenerate: `cd apps/web && bun run gen-tools` and
  `cd apps/docs && bun run generate:tools` (never hand-edit the MCP tool pages).
- Gemini rejects recursive schemas and drops records (`additionalProperties`).
  Use key/value pair lists, and keep recursive input types out of tool schemas.

## 14. SDK

Follow the [add-sdk-endpoint skill](../../.agents/skills/add-sdk-endpoint/SKILL.md).
A new noun gets `packages/sdk/src/entities/<noun>/` registered in
`src/macro.ts` (forms is the model); methods take entity handles, never raw ids.
Endpoints you don't wrap go in `src/coverage/skipped.ts` with a reason. Run
`just update-generated && just check && just coverage` in `packages/sdk`.

## 15. Frontend

Read `apps/web/AGENTS.md`. Paths below are under `apps/web/src/` unless they
start with `rules/` or `packages/`. Build the feature as `apps/web/src/features/<kind>/`
with layered `core`, `queries`, `primitives`, `components`, `views`, `context`
([frontend features](../architecture/frontend-features.md), FE-33); the block
adapter translates legacy block state into feature context (FE-34).
`features/block-form` is the newest example. Register its paths in all eight
`rules/ast-grep/{ts,tsx}-feature-*.yml` files.

**Exhaustiveness.** New branches on a kind use `match().exhaustive()` or a
`Record<Kind, ...>`, never `.otherwise`, `P._`, `default`, or `switch`. Never cast
a string to `ItemType`; parse it with `stringToItemType` (FE-31, enforced by
`rules/ast-grep/ts-no-item-type-cast.yml`). Existing catch-alls hide the new kind,
so grep for the sibling kind.

- **Item type:** `apps/web/src/lib/service-clients/service-storage/itemType.ts`:
  the `ItemType` union, `stringToItemType` (an allow-list; add a test case), and
  `blockNameToItemType`. Both functions end in `.otherwise`.
- **Block:** `lib/constants/block-registry.ts`, `lib/core/block.ts` (nesting
  combinations decide where cards render), `lib/core/blockMethodRegistry.ts`, and
  `features/<kind>/definition.ts` (found by `apps/web/src/lib/core/constant/allBlocks.ts`,
  which throws at boot when a registry name has no definition).
- **Routes (optional):** opening in a split is generic. Pages outside the split
  layout need `routes/routes.ts`, `routes/pages.tsx`, `routes/lazy-route-views.ts`,
  and `routes/app-router-view.tsx`; a chrome-free public page uses
  `FocusedShell` in `routes/shells.tsx` (see `formRespondRoute`).
- **Entity model:** `apps/web/src/features/entity/types/entity.ts` (`EntityData`),
  `utils/buildEntityData.ts`, `utils/shared.ts`, `extractors/entity-title.tsx`,
  `extractors-property/entity-key-properties.tsx`, `queries/rename.ts`.
- **Icon:** `apps/web/src/lib/core/component/EntityIcon.tsx` and
  `apps/web/src/lib/core/component/FileList/constants.tsx`.
- **Queries:** keys in `lib/queries/storage/keys.ts`, a module
  `lib/queries/storage/<kind>.ts` (plus `<kind>-sync.ts` for realtime), and a
  client in `lib/service-clients/service-storage/<kind>.ts` attached in
  `client.ts`.
- **Soup kind:** `soup.graphql` fragment, `graphql-soup.ts` mapper,
  `lib/queries/soup/transform-utils.ts`, `graphql/entity-input.ts`,
  `normalized-cache/operations.ts` (mirror the server's opt-in rule), and
  `features/next-soup/filters/{query-filters,inbox-filters}.ts`. A missing
  fragment, mapper, or filter branch shows an empty list, not an error.
- **Own catalog:** a Drive source like `features/drive-view/queries/drive-forms.ts`,
  merged in `drive-data-source.ts` and `drive-results.ts`, a facet in
  `filters/drive-facets.ts`, and the create menu in `drive-create-menu.tsx`.
- **Actions:** the deny-lists in `features/next-soup/actions/make-{copy,delete,move-to-project,rename,share}-action.ts`.
- **Preview:** `lib/queries/preview/fetchers.ts` (REST) and
  `lib/queries/preview/graphql.ts`, plus `components/app/previewTarget.ts` and
  `components/app/split-layout/components/SplitHeader.tsx`. Initiatives launched
  without a preview fetcher, so their mentions reported no access and ignored
  clicks.
- **Mentions:** `lib/core/component/LexicalMarkdown/component/menu/MentionsMenu/`
  (`MentionsMenu.tsx`, `utils/entityUtils.ts`, `utils/mentionHandlers.ts`),
  `plugins/mentions/mentionsPlugin.ts`, `component/decorator/DocumentMention.tsx`
  and `DocumentCard.tsx`, and section 11.
- **Discovery:** `lib/core/context/quickAccess/types.ts` and
  `QuickAccessSource.tsx`, `features/command/useCommandItems.ts`,
  `features/command/Launcher.tsx`, and `create.<kind>` tokens in
  `lib/core/hotkey/tokens.ts`. Quick Access and Cmd+K are separate
  registrations; CRM contacts reached one weeks before the other.
- **Sharing:** `features/sharing/global-share-modal/shareable-entity.ts`,
  `GlobalShareModal.tsx`, `lib/core/component/TopBar/ShareButton.tsx`, and
  `linkShare.ts` if team-shareable.
- **Optional by capability:** properties (`features/property/utils/entityConversion.ts`,
  `editors/selectors/entityUtils.ts`, `hooks/usePropertyEntityDisplay.tsx`),
  activity (`features/activity/core/{event,describe-action}.ts`,
  `queries/decode.ts`, `components/action-glyph.tsx`), notifications
  (`features/notifications/*`, `features/entity/extractors-notification/*`,
  `lib/queries/notification/notification-soup.ts`).
- **Analytics:** `lib/core/internal/trackBlockOpened.ts`.

## 16. Agent guide

Add `docs/agent-guide/<kind>.md` and a row in `docs/agent-guide/README.md`
covering routes, creation, and editing, and update `ai-chat.md` for new tools.

## Verify locally

```sh
cargo test -p <kind> -p entity_access -p soup -p complete_graph   # SQLX_OFFLINE unset
just rust-check && just clippy
cargo x deps --check && cargo x kafka-topics --check
cd apps/web && bun run gen-api -- --check && bun run check
cd packages/sdk && just check && just coverage
just check full
just run_local                          # or just stack up
```

In the browser (the `browser-verifier` subagent): create the entity, share it with
a second user and a team, mention it in a document and a channel, open it from
Cmd+K and the mention, trash and restore it, and watch a second session update.
Ask an agent to read and change it through its tools. Use the `live-debug` skill
for traces and logs.
