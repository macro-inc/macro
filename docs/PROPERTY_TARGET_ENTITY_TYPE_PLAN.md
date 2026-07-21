# Canonical Property Target Entity Types

## Status

Implementation plan. No code or schema changes have been made as part of this document.

## Problem

Tasks are documents with `document_sub_type = TASK` in the canonical entity and access-control systems, but the properties subsystem currently exposes a separate `TASK` target type.

That creates two property namespaces for the same entity id:

```text
(DOCUMENT, <document-id>)
(TASK,     <document-id>)
```

Today a task property mutation from the web client sends `entityType: TASK`, so the properties service writes the assignment under the internal `TASK` namespace. A fresh GraphQL Soup query represents the same task as a `GraphqlSoupDocument`, mints document access, and currently loads properties under `DOCUMENT`. The mutation response is therefore correct and can update the normalized cache immediately, but a fresh read cannot find the row written under `TASK`.

The split is visible in `crates/properties/src/domain/model.rs`:

- `access_entity_type(EntityType::Task)` collapses to `entity_access::EntityType::Document`.
- `PropertiesAccessReceipt` then preserves the original properties `EntityType::Task` specifically so repositories can continue using the separate storage namespace.

The desired boundary is:

```text
external target: DOCUMENT + entity id
        |
        v
inbound adapter mints EntityAccessReceipt<Document>
        |
        v
properties domain resolves document subtype
        |
        +-- regular document/snippet -> internal DOCUMENT
        `-- task                    -> internal TASK
```

`TASK` remains an internal properties storage type for now. There is no data migration in this plan.

## Decisions

1. **Entity property targets use canonical entity types externally.** A task is targeted as `DOCUMENT`; task-ness comes from document subtype.
2. **The properties domain receives regular typed entity-access receipts.** Clients never provide receipts; inbound adapters mint them.
3. **Task/document classification is domain policy.** Inbound GraphQL, REST, and tool adapters must not inspect document subtype or choose the internal storage namespace.
4. **Document subtype lookup is an outbound fact.** Add a repository/port capability that can resolve document subtypes in batches; the domain maps those facts to internal `models_properties::EntityType::{Document, Task}`.
5. **Keep `models_properties::EntityType::Task` internally.** Existing rows, task initialization, task relationships, grouping, indexing, notifications, and permission side effects continue using it.
6. **Separate target types from referenced-entity types.** The current `GraphqlPropertyEntityType`/generated `EntityType` is used both for the entity receiving a property and for entities stored inside property values. Introduce a target-only transport type without `TASK`. Keep the existing internal/reference type in this iteration so Parent Task/Subtasks and property-definition constraints are not redesigned accidentally.
7. **Use one resolution path for reads and writes.** Fixing only `set_entity_property` would recreate the mismatch in the opposite direction.
8. **Do not add `Task` to `model_entity::EntityType`.** Tasks remain canonical documents.
9. **Do not run or create a database migration for this work.** Existing `TASK` rows remain authoritative for task documents.
10. **Prefer strong domain types over stringly typed interfaces.** Repository and service contracts should use types such as `Uuid` for UUID-backed identifiers rather than `String`, converting only at transport boundaries when necessary.

## Goals

- A frontend task property write sends `DOCUMENT`, not `TASK`.
- GraphQL, REST, tools, and internal user-facing property entrypoints mint a normal document access receipt.
- The properties domain resolves a task document to the internal `TASK` namespace before every repository operation.
- A mutation followed by a fresh, network-only GraphQL Soup query returns the persisted assignee/status/etc.
- Task assignee permission grants and notifications continue to run.
- Existing task property rows require no rewrite.
- Bulk property reads classify documents in one batched lookup rather than introducing an N+1 query.

## Non-goals

- Removing `TASK` from PostgreSQL's `property_entity_type` enum.
- Migrating existing `TASK` property rows to `DOCUMENT`.
- Changing how tasks are rendered (`TaskEntity` remains a document with `subType.type === "task"`).
- Redesigning task-to-task entity-reference values or Parent Task/Subtasks in the first iteration.
- Changing GraphQL normalized-cache identity. `GraphqlProperty.id` remains the assignment id, and tasks remain `GraphqlSoupDocument` objects.

## Proposed domain design

### 1. Canonical target receipt

Replace the original-type-preserving role of `PropertiesAccessReceipt<T>` for entity-scoped service operations with the regular:

```rust
EntityAccessReceipt<ViewAccessLevel>
EntityAccessReceipt<EditAccessLevel>
```

The receipt's entity type is canonical (`Document`, `EmailThread`, `Call`, `CrmCompany`, etc.). It proves authorization but does not encode the properties storage namespace.

If removing `PropertiesAccessReceipt` in one change is too disruptive, first reduce it to a transparent supported-target wrapper around `EntityAccessReceipt<T>` with no caller-provided properties `EntityType`. Do not let callers supply or preserve `Task` on the wrapper. The end-state service contract must not require a caller to choose Task versus Document.

### 2. Resolved internal subject

Add a private/domain model such as:

```rust
struct ResolvedPropertySubject {
    canonical_entity: model_entity::OwnedEntity,
    storage_entity_type: models_properties::EntityType,
}
```

The service resolves receipts as follows:

| Receipt entity type | Internal properties type |
| --- | --- |
| `Document` with task subtype | `Task` |
| `Document` without task subtype (including snippets) | `Document` |
| `EmailThread` | `Thread` |
| `Call` | `CallRecord` |
| `CrmCompany` | `Company` |
| `Chat`, `Channel`, `Project`, `User` | corresponding internal type |
| unsupported canonical types | domain validation error |

Keep both the canonical key and internal key while processing a request. The canonical key is used at service/adapter boundaries; only repository calls and task-specific domain behavior use the internal key.

### 3. Batched document subtype lookup

Extend the properties outbound port with a fact-oriented, batch API, for example:

```rust
fn get_document_sub_types(
    &self,
    document_ids: &[Uuid],
) -> impl Future<
    Output = Result<HashMap<Uuid, Option<DocumentSubType>>, Self::Err>
> + Send;
```

Implementation requirements:

- Keep UUID-backed identifiers strongly typed as `Uuid` throughout domain and repository interfaces; do not weaken them to `String` for convenience.
- Query `Document`/`document_sub_type` for all supplied document ids in one SQLx query.
- Return `Some(Task)` only for task documents; `None` means a regular document/no subtype. Snippets resolve to internal `Document`.
- Deduplicate input ids.
- Define and test missing-document behavior. Recommended compatibility behavior is to resolve a missing subtype row as `Document`; authorization and the eventual repository operation remain responsible for their existing not-found/deleted behavior.
- Use SQLx compile-time checked macros.
- Do not put the Task-versus-Document policy in the SQL adapter; return subtype facts and map them in the domain service.

The existing properties repository already contains document metadata lookup, so this capability may live on `PropertiesRepo` without adding another service generic. If a dedicated resolver port is introduced instead, wire it only in composition roots and keep the domain independent of its concrete database implementation.

### 4. Canonical bulk result keys

`get_bulk_entity_properties` currently returns maps keyed by `EntityPropertiesKey`, whose type can be internal `Task`. That prevents a caller holding only a canonical `Document` receipt from finding the result.

Change the service boundary to return canonical keys. Options, in preferred order:

1. A map keyed by a new canonical `PropertyTargetKey` containing `model_entity::EntityType` and id.
2. A map keyed by `model_entity::OwnedEntity`.
3. A vector aligned with the input receipts, if that is clearer for all callers.

Keep `EntityPropertiesKey` with `models_properties::EntityType::Task` inside the repository boundary. During bulk reads, retain a canonical-to-internal mapping, query with internal keys, then map results back to canonical keys before returning.

## Transport contracts

### GraphQL

Create a target-only GraphQL enum, e.g. `GraphqlPropertyTargetEntityType`, which excludes `TASK` and maps to canonical entity-access types. Use it only for `SetEntityPropertyInput.entity_type` and any other entity-scoped property target input.

Do not reuse or remove `GraphqlPropertyEntityType` yet; it is also used for:

- `GraphqlEntityReferenceInput.entity_type`
- `GraphqlProperty.specific_entity_type`
- property filter inputs

Those uses may still need a Task value and are outside this plan's first iteration.

Change the GraphQL mutation flow to:

1. Parse canonical target type and entity id.
2. Mint `EntityAccessReceipt<EditAccessLevel>` at the inbound boundary.
3. Pass the receipt, definition id, and value to `PropertiesService::set_entity_property`.
4. Let the service resolve internal Task/Document storage type.

Change the GraphQL property reader similarly:

1. Keep `GraphqlSoupDocument`/`model_entity::EntityType::Document` for tasks.
2. Mint canonical view receipts.
3. Call the bulk properties service.
4. Consume results under canonical Document keys.

Do not add task-subtype branching to `graphql_soup`, `complete_graph::SoupEdges`, or `graphql_properties`; that decision belongs in the properties domain.

Likely files:

- `crates/graphql_properties/src/mutations.rs`
- `crates/graphql_properties/src/loaders.rs`
- `crates/graphql_common/src/property_filter.rs` (only if types must be split/exported here)
- `crates/complete_graph/src/edges.rs`
- `crates/complete_graph/src/schema.rs`
- `services/document_storage_service/src/api/graphql_soup.rs`
- `static_assets/schema.graphql` (generated, never edited manually)

### REST/OpenAPI

The REST path currently uses the same properties `EntityType` that includes `TASK`. Introduce a target-only API type without Task for entity-scoped paths and bulk subject references. Convert it to canonical entity-access types in the receipt extractor.

Keep value-level `EntityReference.entity_type` separate so this change does not silently alter Parent Task/Subtasks or constrained property definitions.

Likely files:

- `crates/models_properties/src/api/**`
- `crates/properties/src/inbound/axum_router/extract.rs`
- `crates/properties/src/inbound/axum_router/entities.rs`
- `crates/properties_service/**` and DSS OpenAPI composition as required

### Tools and internal adapters

Update user-facing tools to target tasks as documents and pass canonical receipts. Internal task lifecycle ports may continue using internal `Task` rows where they bypass the user-facing target contract deliberately.

Review at least:

- `crates/properties/src/inbound/toolset/get_entity_properties.rs`
- `crates/properties/src/inbound/toolset/set_entity_property.rs`
- `crates/ai_tools/src/tool_context.rs`
- `services/document_storage_service/src/api/context.rs`
- `crates/documents/src/domain/ports/mod.rs`
- `crates/documents/src/domain/service.rs`

Do not blindly replace every Task occurrence: task relationship values, filters, system-property initialization, and internal repository keys remain Task in this phase.

## Properties service changes

Add one internal resolution helper and use it consistently before repository access. Audit every method that currently reads `access.entity_type()` or constructs `EntityReference`/`EntityPropertiesKey` from a receipt, including:

- `get_entity_properties`
- `get_property_value` / `get_system_property_value`
- `set_entity_property`
- `add_entity_property_option`
- `remove_entity_property_option`
- `get_entity_properties_with_definitions`
- `get_entity_metadata_properties`
- `get_bulk_entity_properties`
- `delete_entity_properties`
- assignment deletion authorization comparisons
- search reindex dispatch after writes

Task-only behavior must use the resolved internal type:

- assignee permission grants
- task-assigned notifications
- Parent Task/Subtasks relationship writes
- task-specific validation
- search indexing as a task

Authorization comparisons must use canonicalized types. For example, an assignment lookup returning internal `Task` belongs to a receipt for canonical `Document`; comparing those enums directly would incorrectly reject access.

Likely files:

- `crates/properties/src/domain/model.rs`
- `crates/properties/src/domain/service.rs`
- `crates/properties/src/domain/service_impl/mod.rs`
- `crates/properties/src/domain/service_impl/task_properties.rs`
- `crates/properties/src/domain/ports.rs`
- `crates/properties/src/outbound/metadata_queries.rs`
- `crates/properties/src/outbound/properties_pg_repo.rs`
- `crates/properties/src/domain/test.rs`
- `crates/properties/src/outbound/test.rs` and focused query tests

## Frontend changes

After backend schema/OpenAPI changes and code generation, make property **targets** canonical:

- `TaskEntity` remains `{ type: "document", subType: { type: "task" } }`.
- `macroEntityToPropertyEntityType` (or its replacement target helper) returns `DOCUMENT` for a task.
- Task grid, inline task properties, side panel, row tags, inbox property editors, title/editor property calls, and hotkey bulk property edits pass `DOCUMENT` as the target.
- `graphql-properties.ts` maps the new target type and no longer sends `TASK` for `SetEntityPropertyInput`.
- Entity-reference conversion remains separate and may still emit `TASK` where the value schema requires it.
- Do not manually edit generated TypeScript.

Audit the hardcoded target call sites found by searching for `EntityType.TASK`, `'TASK'`, and `isTaskEntity`, especially:

- `apps/web/src/features/property/utils/entityConversion.ts`
- `apps/web/src/features/entity/extractors-property/entity-key-properties.tsx`
- `apps/web/src/features/next-soup/soup-view/views/tasks/task-grid-layout.tsx`
- `apps/web/src/features/next-soup/soup-view/views/inbox/inbox-card-layouts.tsx`
- `apps/web/src/features/block-md/component/InlineTaskProperties.tsx`
- `apps/web/src/features/block-md/component/sidepanel/MarkdownSidePanelSections.tsx`
- `apps/web/src/features/entity/composed/list-entity/wide-layout.tsx`
- `apps/web/src/lib/service-clients/service-storage/graphql-properties.ts`

Classify each occurrence as either:

- **target type**: change to canonical `DOCUMENT`; or
- **reference/filter/rendering/internal task classification**: retain Task semantics.

## Compatibility and atomic rollout

This work uses an atomic deployment strategy. Removing `TASK` from the GraphQL target input enum is a breaking contract, so the backend and every client must deploy together.

Create the target-only enum without `TASK` immediately, regenerate all clients in the same change, and deploy the backend and clients atomically. Do not add a deprecated `TASK` alias or a compatibility phase.

Changing the committed GraphQL SDL rotates the normalized cache schema hash, so persisted client caches will rebuild automatically. Do not add manual cache-version logic.

## Test plan

### Properties domain tests

Add focused tests proving:

1. A canonical Document edit receipt for a task resolves to internal `EntityType::Task` for writes.
2. A canonical Document view receipt for a task resolves to internal Task for reads.
3. A regular document and snippet resolve to internal Document.
4. Mixed bulk task/document reads issue one batched subtype lookup and return results under canonical Document keys.
5. Assignee updates through a canonical Document receipt still grant permissions and send notifications.
6. Parent Task/Subtasks behavior still uses internal Task rows.
7. Add/remove option and delete flows resolve the same internal key as set/get.
8. Assignment deletion accepts a canonical Document receipt for an assignment stored under Task, but still rejects a receipt for a different entity id.
9. Search reindex dispatch retains the resolved internal Task type.
10. Missing subtype/document facts follow the documented fallback/error behavior.

### Outbound tests

Add query tests for batch subtype resolution:

- task document
- regular document
- snippet
- duplicate ids
- missing id
- mixed batch

Any SQLx query changes require `just prepare_db` from the repository root. Never edit `.sqlx` files manually.

### GraphQL tests

Add tests proving:

1. `SetEntityPropertyInput` accepts canonical `DOCUMENT` for a task target.
2. The target-only enum does not expose Task.
3. Entity-reference values can still represent the existing Task reference type where required.
4. A mutation setting Assignees followed by a fresh/network-equivalent GraphQL Soup query returns the assignee.
5. A regular document with the same shape still reads Document-scoped properties.
6. The committed SDL matches generated schema.

The key regression test is a mutation-then-fresh-query test; an optimistic-cache-only assertion is not sufficient.

### Frontend tests

Add or update tests proving:

1. Task property targets are sent as `DOCUMENT`.
2. Regular document targets remain `DOCUMENT`.
3. The assignee mutation still sends `multiEntityReference` values correctly.
4. Task references used as property values are not accidentally converted unless that contract is intentionally changed.
5. A real mutation response and subsequent network query keep the task's property linked in the normalized graph.

## Generated artifacts

After changing the GraphQL schema:

```bash
cargo run -p complete_graph --bin graphql_schema -- static_assets/schema.graphql
(\cd apps/web && bun gen-graphql)
```

After changing REST/OpenAPI types:

```bash
(\cd apps/web && bun gen-api properties-service)
```

Use the appropriate DSS/cloud-storage target too if its generated OpenAPI exposes the affected routes. Never manually edit generated Rust/TypeScript schema artifacts.

## Validation sequence

Run focused validation before workspace-wide checks:

```bash
cargo test -p properties
cargo test -p graphql_properties
cargo test -p complete_graph
cargo test -p document_storage_service
just prepare_db                         # required if SQLx queries changed
(\cd apps/web && bunx vitest run <focused-test-files>)
(\cd apps/web && bun type-check)
```

Then run the repository Rust validation sequence from the root:

```bash
just check
just clippy
just format
```

Also verify generated contracts are clean/up to date and run `git diff --check` (or the repository equivalent). Follow the repository rule to create a `jj` revision after each successful verification checkpoint.

Do not run migrations for this plan; none are expected.

## Acceptance criteria

- Web task property mutations send a canonical `DOCUMENT` target.
- No user-facing property target API requires callers to distinguish Task from Document.
- Existing task property rows remain stored and retrieved under internal `TASK`.
- Both single and bulk property reads resolve task subtype inside the properties domain.
- A successful Assignees mutation remains present after a hard reload/fresh GraphQL Soup network response.
- Assignee permissions and notifications still occur.
- Regular document properties are unaffected.
- No N+1 subtype queries are introduced.
- GraphQL SDL, OpenAPI clients, SQLx metadata, and tests are updated through generators.

## Hexagonal architecture boundary

This design keeps dependencies pointing inward:

- **Inbound adapters** parse canonical target ids/types, authenticate, mint typed entity-access receipts, and call the service. They do not decide whether a document is a task.
- **Properties domain service** owns Task-versus-Document classification policy and task-specific side-effect orchestration.
- **Outbound adapter** returns document subtype facts and performs internal Task/Document-keyed persistence; it does not choose business behavior.
- **Composition roots** wire concrete access, repository, notification, permission, and indexing adapters.

Authorization remains represented by `EntityAccessReceipt<ViewAccessLevel/EditAccessLevel>`. The subtype resolver must never become a substitute for authorization.
