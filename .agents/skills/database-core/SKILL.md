---
name: database-core
description: Use when building a feature on reusable database storage or UI, such as CRM, or deciding whether it needs a Macro database entity. Covers storage and UI entry points, ownership, authorization, and the _entities naming convention.
---

# Database core

The database engine is a reusable resource. A feature can use its tables,
columns, cells, versions, and journal with its own ownership, permissions, and
lifecycle.

## Choose the entry point

- **Building a feature such as CRM:** reference `databases.id` from that
  feature's domain model. Use the `DatabaseStorage` port to `create_storage`,
  `apply_storage_writes`, and `delete_storage`.
- **Working on the Macro database app:** use `DatabasesService`. Its `CellStore`
  creates the app entity and owner grant together and enforces the entity's
  lifecycle during writes.

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

## Reuse the records UI

Use [DatabaseRecordsView](../../../apps/web/src/features/block-database/views/database-records-view.tsx)
with a host-provided `DatabaseRowsSource`, query/layout state, and action callbacks.
It needs no Macro database entity, saved-view metadata, or block context. Omit
schema actions when a feature allows record editing with a fixed schema.
The Macro app's `DatabaseGrid` supplies its API, Soup, and saved-view adapters;
other domains supply their own authorized reads, writes, and change notifications.

Read the [storage boundary](../../../crates/databases/README.md#storage-and-app-entities)
and [domain ports](../../../crates/databases/src/domain/ports.rs) before wiring a
consumer. Follow the [database guide](../../../docs/DATABASE_DEVELOPMENT.md) for
schema and migration work.
