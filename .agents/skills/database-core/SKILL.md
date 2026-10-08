---
name: database-core
description: Use when building a feature on reusable database storage or UI, such as CRM, or deciding whether it needs a Macro database entity. Covers shared storage, a host-independent database UI and API contract, ownership, authorization, and the _entities naming convention.
---

# Database core

The database engine is a reusable resource. A feature can use its tables,
columns, cells, versions, and journal with its own ownership, permissions, and
lifecycle.

## Choose the entry point

- **Building a feature such as CRM:** reference `databases.id` from that
  feature's domain model. Use the `DatabaseStorage` port to `create_storage`,
  `apply_storage_writes`, and `delete_storage`.
- **Working on the Macro database app:** use `DatabasesService`. Its repository
  creates the app entity and owner grant together; `CellStore` enforces the
  entity's lifecycle during writes.

A new consumer authorizes access to its own resources, validates writes, and
controls discovery and cleanup. `DatabaseStorage` expects calls from a trusted
domain service; the composition root supplies its adapter. Creating core storage
requires no row in `database_entities` or database app grants and does not expose
it in Soup.

## Keep product metadata on the entity

`databases` holds the core resource identity. An optional `database_entities` row
holds the Macro app's name, owner (`user_id`), lifecycle timestamps, and trash
state. Its `database_id` is both its primary key and a foreign key to the resource.

Use this pattern for new entities: a plural `<kind>_entities` table owns product
identity and lifecycle and references any reusable resource it uses. The naming
convention starts with databases; existing unrelated entity tables keep their names.
Rust type names stay singular.

## Build one database UI for multiple hosts

The Macro database app, CRM pipelines, and other consumers are hosts of the same
editor. A host supplies an authorized API and its capabilities; it should not
reimplement database editing, pagination, option creation, or refresh behavior.
Follow the [frontend architecture](../../../docs/FRONTEND_FEATURE_ARCHITECTURE.md).

### Target ownership

Use `apps/web/src/features/database/` for reusable database behavior and UI. Keep `features/block-database/` as the Macro app composition and
`features/crm/` as the CRM composition. Move code with its dependencies and migrate
its callers; a directory rename alone does not establish the boundary.

- `core/` owns editor models, operations, errors, and capability vocabulary.
- `queries/` adapts injected transport into schema, row and view sources, and owns
  pagination, cache updates, conflict handling, and refresh after mutations.
- `primitives/` owns shared editing, selection, draft, and layout behavior.
- `components/` and `views/` render the grid, board, record panel, column controls,
  filters, sorting, and view controls using supplied sources and actions.
- Host entry points wire identity, permissions, concrete clients, navigation,
  sharing, entity pickers, and presence. Shared components do not import these
  entry points, app singletons, Soup, or legacy block context.

### API contract and shared controller

Define a feature-owned, typed contract for reading schema, reading rows for a
query (including pagination and table versions), and applying an operation batch.
Preserve the existing `DatabaseOp` / `OpBatch` semantics instead of defining a
CRM-specific mutation language. Keep generated HTTP DTOs and route choices in
transport adapters; shared rendering consumes feature models.

Build the rows source and schema/view actions once from this contract. A Macro
adapter can call the database routes and a pipeline adapter can call CRM routes;
neither should duplicate cell-to-op conversion, option-label handling, batch
submission, or committed-write refresh semantics. Keep transport errors distinct
from a refresh failure after a successful commit so the UI does not retry a
committed insert.

Reads must implement the requested filtering, sorting, cursor, and version
semantics. Do not silently replace a server query with sorting one loaded page.
SQL reads are an optional adapter capability, not a requirement for every host.
Query keys must distinguish host/resource identities and query state.

### Capabilities and extension points

Expose supported actions as cohesive capabilities: row editing, schema editing,
stored views, board positioning, relations, history/undo, and presence. UI controls
appear only when the corresponding capability is available and permitted.
A missing capability is absent, never a callback that pretends to save successfully.
Keep column protections and requiredness in shared schema metadata and enforcement;
frontend capabilities guide the UI but do not replace server authorization.

Use slots for host-specific presentation such as entity pickers, record links,
and surrounding toolbars. Standard column controls and database interactions
belong to the shared editor; hosts should not need to assemble them individually.
Keep local view preferences explicitly separate from persisted shared views.
Change notifications may be supplied through events or polling; the shared query
adapter owns invalidation behavior, while the host owns the subscription lifecycle.

### Current extraction points

Start from [DatabaseRecordsView](../../../apps/web/src/features/database/views/database-records-view.tsx)
and [DatabaseRowsSource](../../../apps/web/src/features/database/context/table-source.ts).
`DatabaseProvider` creates the shared controller from `DatabaseApi` and scoped
capabilities. `DatabaseRecords` wires the standard schema controls once. Read the
[API contract](../../../apps/web/src/features/database/core/api.ts) and
[provider](../../../apps/web/src/features/database/context/database.tsx) when adding
a host. `DatabaseGrid` composes the Macro app with its SQL cache and inference
source; ordinary API hosts use the provider's paginated source. Keep host-specific
optimizations behind the same data-source contract. CRM uses `createPipelineApi`
in `features/crm/queries/pipeline-data.ts` with the same provider and controller.
Its adapter converts transport values and calls pipeline-authorized endpoints;
it does not own pagination or mutation planning.

Verify the same editor against a small fake API without app providers, then test
the Macro and CRM adapters against the same behavioral contract. Cover a failed
batch, a successful write followed by failed refresh, version conflicts, and
unsupported capabilities. Exercise changed interactions in both hosts in a browser.

## Keep API authorization and tools at the host boundary

A host may accept the common operation types while restricting their scope (for
example, CRM allows edits only to its pipeline table). Validate that scope and
resource access in the host's domain service before calling the database engine.
UI and AI adapters should call that same authorized host service. An API endpoint
or a shared database engine does not automatically make a host available to AI;
wire host discovery/read/write tools explicitly without bypassing its permissions.

Read the [storage boundary](../../../crates/databases/README.md#storage-and-app-entities)
and [domain ports](../../../crates/databases/src/domain/ports.rs) before wiring a
consumer. Follow the [database guide](../../../docs/DATABASE_DEVELOPMENT.md) for
schema and migration work.
