# Tags on non-document entities in OpenSearch — shared design (macro-2208)

Integration plan for indexing tag/property values on non-document entity types so
tag filters apply server-side on every leg of unified search, not just documents/tasks.

| Task | Scope | Branch | Status |
|---|---|---|---|
| macro-2208 | parent integration branch + this plan | `gbirman/macro-2208-searchtags-index-tags-for-non-document-entity-types-in-opensearch` | this doc |
| macro-2209 | email threads — builds the generic pipeline | `gbirman/macro-2209-searchtags-index-tags-for-email` | not started |
| macro-2210 | AI chats — extends the pipeline | `gbirman/macro-2210-searchtags-index-tags-for-ai-chats` | not started |
| macro-2211 | projects — restores a full OpenSearch index, then extends | `gbirman/macro-2211-searchtags-index-projects-into-opensearch` | not started |

Subtasks branch off this parent and merge back into it; the parent merges to main.

---

## 1. Current state (verified 2026-07-07; baseline = main at `c824daa39`, i.e. PR #4537 merged)

### 1.1 Baseline clarifications

- **The `tags_active` leg-drop is on main** (merged in **PR #4537** /
  `c824daa39`). `perform_unified_search` sets
  `tags_active = !tag_option_ids.is_empty()` (`simple_unified.rs:241`) and ANDs
  `!tags_active` into `should_include_{channels,chats,projects,emails,call_records}`
  (`:258-262`) and the CRM leg (`:247`), so a tag filter returns only
  documents/tasks (precise but incomplete). #4537 also tag-filters the
  **email soup path** in PG (`EmailLiteral::Property` EXISTS on
  `entity_properties`) — the soup leg for emails is therefore already precise;
  it's the unified-search OpenSearch leg that 2209 restores. This parent branch
  is rebased onto that baseline.
- The frontend gate `TAG_SEARCH_TYPES`
  (`js/app/packages/app/component/next-soup/soup-view/filters-bar/search/search-filters-state.ts`)
  is now `{'all', 'task', 'document-or-file'}` — the tags facet is hidden on
  email/channel/call/agent search types.
- **No new SQS message shape is needed.** `DocumentPropertiesUpdate` already
  carries `entity_type` (`sqs_client/src/search/document.rs:12-18`); only the
  consumer hard-codes the documents index.

### 1.2 Write path today

```
properties mutation (set value / add option / remove option / status complete)
  └─ PropertiesServiceImpl calls enqueue_property_upsert            properties/src/domain/service_impl/mod.rs:150,341,404,445
       └─ GATE: matches!(entity_type, Task | Document) else return  mod.rs:73          ← the gap
       └─ SqsPropertySearchIndexer.enqueue_upsert                   document_storage_service/src/service/property_search_indexer.rs:22
            └─ SearchQueueMessage::UpdateDocumentProperties{document_id, entity_type}
               → SQS search-event-queue                             sqs_client/src/search/mod.rs:73, macro_queues/src/lib.rs:496
                 └─ SPS process_message match arm                   search_processing_service/src/process/mod.rs:93
                      └─ document::process_property_update          process/document/mod.rs:73
                           └─ update_search_with_property_update    process/document/raw_document.rs:434
                                ├─ get_entity_properties_for_index  properties_db_client/src/entity_properties/get.rs:612  (already entity-type generic)
                                └─ update_document_properties       opensearch_client/src/document.rs:47 → upsert/document.rs:370
                                   POST /documents/_update  {"doc":{"properties":[IndexedProperty…]}}, routing=_id
```

- `IndexedProperty` (`opensearch_client/src/upsert/document.rs:19-33`):
  `definition_id: String`, `values: Vec<String>` (option UUIDs / entity refs /
  links / text / bool flattened), `number_value: Option<f64>`, `date_value: Option<i64>` (ms).
- On **full** document (re)indexing, `attach_indexed_properties`
  (`raw_document.rs:89-118`, called at `:313` and `:423`) re-fetches and attaches
  properties so a content reindex never wipes them. No equivalent exists for any
  other entity processor.
- Definition renames don't need reindexing (only ids are indexed). Option
  **deletes** do not enqueue anything, so stripped option ids (macro-2128
  cascade) linger in the index until the entity's next property write —
  pre-existing gap for documents, inherited here (follow-up, §7).

### 1.3 Read path today

- `tag_option_ids` flows request → `simple_unified.rs:237` → documents leg only
  (`:323`) → `DocumentSearchArgs` → `build_tag_filter`
  (`opensearch_client/src/search/documents.rs:297-309`):

  ```json
  { "nested": { "path": "properties", "ignore_unmapped": true,
      "query": { "terms": { "properties.values": ["<option-id>", …] } } } }
  ```

  No `definition_id` constraint — tag option ids are globally unique UUIDs and a
  caller only learns ids of tag sets they can see (`GET /properties/tags`), so
  the terms filter is the visibility boundary. `ignore_unmapped: true` means the
  clause no-ops (matches nothing) on indexes without the nested mapping.
- Legs of unified search: OpenSearch legs (documents, emails, channels, chats,
  call_records) OR'd inside one query (`opensearch_client/src/search/unified.rs:536-648`),
  plus Postgres name-search legs (chats, **projects** via trigram
  `idx_project_name_trgm`, CRM companies) joined in `simple_unified.rs:411-507`
  and merged by `updated_at` (`:524-575`).
- **Projects have no OpenSearch presence**: removed by `1969f70f7` (#909);
  `OpenSearchEntityType` has no `Projects` variant (`models_opensearch/src/lib.rs:77-88`).

### 1.4 Index inventory

| Alias | Physical | Doc model | `_id` | properties field |
|---|---|---|---|---|
| `documents` | `documents_v2` | parent/child join (doc/chunk) | document id | nested, parent-only (`create_indices.ts` DOCUMENT_BODY) |
| `emails` | `emails_v1` | flat, **per message** | `{thread_id}:{message_id}`, `entity_id` = thread id | none |
| `chats` | `chats_v2` | parent/child join (chat/message) | parent `_id` = chat id | none |
| `channels` | `channels_v2` | flat per message | — | none (out of scope) |
| `call_records` | `call_records_v2` | — | — | none (out of scope) |
| projects | — | **no index** | — | — |

All mappings live in `infra/stacks/opensearch/helpers/scripts/create_indices.ts`
(fresh envs / local) and are applied to live clusters with the operator scripts
in `infra/stacks/opensearch/helpers/` (`utils/add_field.ts` = putMapping).
Every index sets `dynamic: 'false'`.

### 1.5 Taggability matrix

`models_properties::EntityType` (`entity_type.rs:15`): Channel, Chat, Company,
Document, Project, Task, Thread, User. Email threads tag as `Thread`
(entity_id = `email_threads.id`, per-link so per-user).

| Entity | PG accepts tag values | FE tag UI | Indexed in OS | Tag-filterable in search |
|---|---|---|---|---|
| Document / Task | yes | yes | yes | yes |
| Thread (email) | yes | yes (#4537) | no → **2209** | no → **2209** |
| Chat (AI) | yes | no — deferred from 2181, task filed | no → **2210** | no → **2210** |
| Project | yes | no — deferred, task filed | no index → **2211** | no → **2211** |
| Channel | yes | no | no | no — out of scope here |
| Company / User | rejected (`UnsupportedEntityType`, `permissions.rs:91-101`) | — | — | — |

---

## 2. Target architecture — the generic pipeline (2209 builds it)

Principle: **one choke point per layer; each later subtask adds one match arm
and one mapping block.**

### 2.1 Gate (properties crate)

Replace the inline allowlist at `service_impl/mod.rs:73` with a single helper
next to `enqueue_property_upsert`:

```rust
fn is_search_indexed(entity_type: EntityType) -> bool {
    matches!(entity_type, EntityType::Task | EntityType::Document | EntityType::Thread)
}
```

2210 adds `Chat`, 2211 adds `Project`. Nothing else in the properties crate changes.

### 2.2 Message (sqs_client) — no wire change

Keep `SearchQueueMessage::UpdateDocumentProperties(DocumentPropertiesUpdate)`
as-is for now: it already carries `entity_type`, and reusing it avoids any
producer/consumer deploy-ordering window (old SPS would DLQ an unknown variant).
The `document_id`-naming cleanup is a **post-integration follow-up**: rename to
`UpdateEntityProperties` with `#[serde(alias = "UpdateDocumentProperties")]`
once every environment runs the generic consumer (§7).

### 2.3 Consumer dispatch (search_processing_service)

New `process/properties.rs` owning the shared fetch/map, replacing the direct
route to `document::process_property_update` at `process/mod.rs:93`:

```rust
pub async fn process_entity_property_update(ctx, msg) -> Result<()> {
    let entity_type = msg.entity_type.parse::<EntityType>()?;
    let rows = get_entity_properties_for_index(&ctx.db, &msg.document_id, entity_type).await?;
    let props: Vec<IndexedProperty> = rows.into_iter().map(Into::into).collect();
    match entity_type {
        Task | Document => ctx.opensearch_client.update_document_properties(&msg.document_id, &props).await,
        Thread          => ctx.opensearch_client.update_email_thread_properties(&msg.document_id, &props).await, // 2209
        Chat            => ctx.opensearch_client.update_chat_properties(&msg.document_id, &props).await,          // 2210
        Project         => ctx.opensearch_client.update_project_properties(&msg.document_id, &props).await,       // 2211
        other           => { warn!(?other, "property update for unindexed entity type"); Ok(()) }
    }
}
```

`get_entity_properties_for_index` is already generic over entity type — no DB work.

### 2.4 OpenSearch writers (opensearch_client)

- Move `IndexedProperty` (and the row→IndexedProperty mapping) out of
  `upsert/document.rs` into a shared module (e.g. `src/properties.rs`); update
  imports, no re-exports.
- **Documents** — unchanged (`_update` on parent, routing = id).
- **Chats (2210)** — same shape as documents: `_update` on the parent chat doc,
  `_id` = chat id = property entity_id, `routing` = chat id (join index),
  `document_missing_exception` → no-op.
- **Emails (2209)** — the index is per-message but the tag lives on the thread,
  so denormalize to every message doc via `_update_by_query`:

  ```
  POST /emails/_update_by_query?conflicts=proceed
  { "query": { "term": { "entity_id": "<thread_id>" } },
    "script": { "source": "ctx._source.properties = params.props",
                 "params": { "props": [ … IndexedProperty … ] } } }
  ```

  `entity_id` is the per-link thread UUID, so this touches only the tagging
  user's copies. `conflicts=proceed` skips docs that race a concurrent message
  upsert; the attach-on-upsert path (§2.5) heals them. Tag mutations are
  human-rate, so update_by_query cost is fine.
- **Projects (2211)** — flat index, plain `_update`, `_id` = project id.

### 2.5 Attach on full (re)index — required per entity type

Mirrors `attach_indexed_properties` for documents; without it, any content
reindex/backfill wipes the properties field, and docs first indexed before
tagging never pick tags up.

- **Emails (2209)**: in `process/email/upsert.rs`, fetch thread properties
  (`Thread`) once per thread and set `properties` on each `UpsertEmailArgs`
  (add the field to the struct + doc body). The `ExtractEmailThreadBatch` path
  should group by thread; add a simple IN-list bulk variant of
  `get_entity_properties_for_index` if needed.
- **Chats (2210)**: in `process/chat.rs`, attach chat properties to the
  **parent** doc body whenever it is written.
- **Projects (2211)**: attach in the restored project processor.

### 2.6 Mappings + rollout

Add the identical nested block (copy of DOCUMENT_BODY, `create_indices.ts:287-295`)
to each index body:

```ts
properties: {
  type: 'nested',
  properties: {
    definition_id: { type: 'keyword' },
    values:        { type: 'keyword' },
    number_value:  { type: 'double' },
    date_value:    { type: 'date' },
  },
},
```

- 2209 → `EMAIL_BODY`; 2210 → `CHATS_V2_BODY` (join index: mapping is flat,
  only parents will carry values); 2211 → new `PROJECTS_BODY`.
- Live dev/prod: additive putMapping via `helpers/utils/add_field.ts`
  (`DRY_RUN=false`), **before** the write path deploys. Because mappings are
  `dynamic: 'false'`, a write landing first is not corrupting — the field sits
  unindexed in `_source` — and the backfill (§2.7) re-writes and indexes it.
  No reindex / alias swap needed (precedent: #4175 / `2a9b61db9`).

### 2.7 Backfill — property-only, generic

New internal endpoint in SPS alongside the existing backfills
(`search_processing_service/src/api/internal/backfill.rs`):

```
POST /internal/backfill/properties   { "entity_type": "THREAD" }
```

`SELECT DISTINCT entity_id FROM entity_properties WHERE entity_type = $1`,
bulk-enqueue one `UpdateDocumentProperties` message per entity, DynamoDB job
progress like the other backfills. 2209 builds it; 2210/2211 just call it with
their entity type. Volumes are tiny today (tagging non-doc entities is barely
shipped), but the endpoint stays useful for drift repair.

### 2.8 Read side — per leg

- Hoist `build_tag_filter` (and `PROPERTIES_PATH`) from `search/documents.rs`
  into a shared module so every query builder uses one implementation.
- Per leg, mirror the documents threading exactly
  (`unified.rs:83`, `documents.rs:87,127-130,179-181,399,415`):
  1. `tag_option_ids: Vec<String>` on `UnifiedXSearchArgs` (`unified.rs:164-215`)
     and on `XSearchArgs` + its `From` impls,
  2. builder field + setter, apply as a `bool.filter` in `build_bool_query`,
  3. set it in `perform_unified_search` next to `:319` (needs `.clone()` per leg).
- Emails: the nested filter ANDs per-message docs down to tagged threads; every
  message of a tagged thread matches and unified pagination already dedupes by
  `entity_id`.
- Projects: 2211's OpenSearch leg applies the same filter; the PG name leg
  cannot (see **D2**).

### 2.9 Lifting the `tags_active` exclusion, per leg

#4537's `perform_unified_search` computes `tags_active` once and ANDs
`!tags_active` into each non-document leg's `should_include_*`. Each subtask's
read-side change is therefore exactly two edits, shipped together:

1. remove `&& !tags_active` from its leg's `should_include_*`, and
2. thread `tag_option_ids` into that leg's args (§2.8),

so the leg rejoins unified search only once the filter actually applies to it.
Channels, call records, and CRM companies keep their `!tags_active` guard
indefinitely (not in scope for 2209–2211). The rendered-row client-side guard
#4537 adds stays as defense in depth.

### 2.10 FE enablement (with each subtask)

Add the search type to `TAG_SEARCH_TYPES` (`search-filters-state.ts`) once the
leg is tag-capable and backfilled: `'email'` (2209), `'agent'` = AI chats
(2210). Projects have no dedicated search type; they surface on `all` only, so
2211 needs no FE type change beyond the leg itself.

### 2.11 Visibility model — no change needed

Indexed docs carry no per-property owner info; visibility holds because
(a) tag option ids are unguessable UUIDs disclosed only via `GET /properties/tags`
scoped to caller + team, and (b) email/chat/project docs are already scoped by
`user_id`/ACL fields per index. Display of tags on rows keeps using
`get_bulk_entity_properties_values_filtered(tag_viewer_user_id)` in PG. One
flag for 2211: the restored projects index must include ACL fields matching the
*current* sharing model (the removed 2026-01 index predates teams) — see §5.

---

## 3. macro-2209 — email (builds the shared pipeline)

Scope, in dependency order within the branch:

1. `create_indices.ts`: nested `properties` on `EMAIL_BODY` (+ local dev picks
   it up via run_local index creation).
2. opensearch_client: shared `IndexedProperty` module; `update_email_thread_properties`
   (update_by_query, §2.4); `properties` field on `UpsertEmailArgs` + doc body.
3. SPS: `process/properties.rs` dispatch (§2.3) replacing the document-only
   route; attach thread properties in `process/email/upsert.rs` (§2.5);
   `POST /internal/backfill/properties` (§2.7).
4. properties crate: gate → `is_search_indexed` incl. `Thread` (§2.1).
5. search_service + opensearch_client read side: thread `tag_option_ids` into
   the email leg and drop its `&& !tags_active` (§2.9); add `'email'` to
   `TAG_SEARCH_TYPES`.
6. Tests: mirror `documents/test.rs:291-345` tag-filter tests for the email
   builder + unified query; consumer dispatch unit tests.

Dependencies: none — PR #4537 (merged) provides the `tags_active` baseline this
lifts and the FE email-thread tagging UI that produces email tags.

Ops runbook (dev, then prod with the release):
putMapping `emails` (`add_field.ts`) → deploy → `POST /internal/backfill/properties {THREAD}` → verify with a tagged thread in unified search.

## 4. macro-2210 — AI chats (extends)

Rebase onto parent after 2209 merges. Adds:

1. `CHATS_V2_BODY` nested `properties` + putMapping `chats`.
2. `update_chat_properties` (parent `_update`, routing = chat id).
3. `Chat` arm in `process/properties.rs`; attach properties on parent-doc writes
   in `process/chat.rs`.
4. `Chat` in `is_search_indexed`.
5. Read side: `tag_option_ids` through `UnifiedChatSearchArgs` → `ChatQueryBuilder`
   (`chats.rs:88`); drop the chats leg's `&& !tags_active`; add `'agent'` to
   `TAG_SEARCH_TYPES`.
6. Backfill: `POST /internal/backfill/properties {CHAT}`.

**Ship dark (D3, resolved):** chats are not yet taggable in the FE (deferred
from macro-2181, task filed). Land the full indexing pipeline + backfill live,
but do NOT add `'agent'` to `TAG_SEARCH_TYPES` — the taggability follow-up task
flips it. Constraint: that follow-up must need FE-only changes (search type +
tag UI); leave no backend work behind.

## 5. macro-2211 — projects (restore index, then extend)

Rebase onto parent after 2209 merges (parallel with 2210). Reference for the
removal being reversed: #793 (`21bdcb2da`, reads → PG `name_search` crate) and
#909 (`1969f70f7`, write path + index deleted to avoid dual-writes on rename).
Adds:

1. New `projects_v1` + alias `projects` in `constants.ts` / `create_indices.ts`,
   with `properties` nested from day one. Mapping sketch: `entity_id`,
   `name` (text + keyword), `owner_id`, `updated_at_seconds`/`created_at_seconds`,
   `properties` (nested). ACL follows the documents pattern: index **only
   `owner_id`**, resolve the caller's accessible project ids at query time via
   `get_user_accessible_items` (already supports projects) — shares/moves never
   reindex.
2. models_opensearch: `OpenSearchEntityType::Projects` + `index_name()` +
   `From` impls + tests (`lib.rs:94-141`).
3. sqs_client: restore `UpsertProject` / `RemoveProject` variants; producer
   hooks in document_storage_service / `macro_project_utils` for create, edit
   (rename), delete, restore, upload_folder, and onboarding flows — note
   `delete_project` today publishes removals only for contained docs/chats,
   nothing for the project itself. Also decide whether `update_project_modified`
   callers (many flows bump `Project.updatedAt`) should refresh the index, since
   `updated_at` drives unified ranking.
4. SPS: restore `process/project.rs`; `POST /internal/backfill/projects`;
   `Project` arm in `process/properties.rs`; `update_project_properties`.
5. `Project` in `is_search_indexed`.
6. search_service: OpenSearch projects leg in `build_unified_search_request`
   with name match + tag filter; drop the projects leg's `&& !tags_active`.
   The response model needs no change (`UnifiedSearchResponseItem::Project` and
   its enrichment already exist) → likely no gen-api regen.
7. Backfills: full project backfill (indexes properties via attach), then the
   generic properties backfill is a no-op safety pass.

**Ship dark (D3, resolved):** projects are not yet taggable in the FE
(deferred, task filed). The index restore and leg replacement go live (that IS
the task — name search moves source), with the tag plumbing included from day
one; no FE change is needed since projects only surface on the `all` type, so
tags start matching projects the moment the taggability follow-up lets users
create them. That follow-up must need zero search-side work.

**D2 (resolved 2026-07-07): retire the PG name leg.** Once the OS leg is
verified at parity, 2211 replaces `simple_project::search_names`
(`name_search/src/project.rs`, trigram `idx_project_name_trgm`, cursor
`project_name_cursor`) with the OpenSearch leg as the single source. The
interim PG `EXISTS` tag-filter option is rejected.

---

## 6. Sequencing

```
PR #4537 / macro-2181 (FE taggability: non-md docs + email threads; tags facet
on 'all'; tags_active leg-drop; email soup PG tag filter)  ── MERGED c824daa39
        │
macro-2208 parent ── rebased onto main, this doc
        │
   2209 email ── generic pipeline + email specifics ── merge → parent
        │                                   (2210 and 2211 rebase onto parent)
   2210 chats ──┐
   2211 projects ─┴─ merge → parent
        │
   parent → main   (per-env ops interleaved: putMapping → deploy → backfill → FE facet)
        │
   cleanup follow-ups (§7)
```

Per-environment order for every subtask: **putMapping → deploy write path →
run properties backfill → enable read/FE**. Dev deploys on merge-to-main;
prod only via the tagged release (put-mappings can run against prod ahead of
the release; backfills run after it).

## 7. Follow-ups / accepted gaps

- **Message rename**: `UpdateDocumentProperties`/`DocumentPropertiesUpdate.document_id`
  → entity naming with `#[serde(alias)]`, one release after the generic
  consumer is everywhere.
- **Option-delete staleness** (pre-existing, all entity types): deleting a tag
  option strips PG values (macro-2128) but never re-enqueues affected entities,
  so the option id lingers in `properties.values` until the entity's next
  property write. Harmless while deleted option ids can't be selected in the
  UI; a proper fix is enqueueing property updates for affected entities on
  option delete. File separately.
- **Channels / calls / CRM** legs stay tag-incapable (keep `!tags_active`).
- **update_by_query conflict skips** (emails): healed by attach-on-upsert;
  residual risk is a stale properties array on one message copy until the next
  write on that thread.
- **sqlx**: the backfill's new query needs `.sqlx` regen — run per-crate
  `cargo sqlx prepare` (librdkafka breaks workspace-wide `just prepare_db`).
- **Codegen**: no public API model changes are expected (`tag_option_ids`
  already exists on the request; all new args are internal), so no
  `gen-api`/`gen-tools` runs should be needed — re-check per PR.

## 8. Decisions (resolved by gab, 2026-07-07)

- **D2** (§5): yes — 2211 retires the PG projects name leg once the OpenSearch
  leg is verified at parity.
- **D3** (§4, §5): yes — 2210/2211 ship dark (indexing + backfill live, FE
  facet off), with the constraint that the chats/projects taggability
  follow-up tasks can hook in with FE-only changes: add the search type to
  `TAG_SEARCH_TYPES` and enable the entity's tag UI, nothing else.
