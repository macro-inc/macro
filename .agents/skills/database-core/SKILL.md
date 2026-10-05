---
name: database-core
description: Use when building a feature on reusable database storage, such as CRM, or deciding whether it needs a Macro database entity. Covers the storage port, ownership, authorization, and the _entity naming convention.
---

# Database core

The database engine is a reusable resource. A feature can use its tables,
columns, cells, versions, and journal with its own ownership, permissions, and
lifecycle.

## Choose the entry point

- **Building a feature such as CRM:** reference `database.id` from that
  feature's domain model. Use the `DatabaseStorage` port to `create_storage`,
  `apply_storage_writes`, and `delete_storage`.
- **Working on the Macro database app:** use `DatabasesService`. Its `CellStore`
  creates the app entity and owner grant together and enforces the entity's
  lifecycle during writes.

A new consumer authorizes access to its own resources, validates writes, and
controls discovery and cleanup. `DatabaseStorage` expects calls from a trusted
domain service; the composition root supplies its adapter. Creating core storage
requires no `database_entity` or database app grants and does not expose it in Soup.

## Keep product metadata on the entity

`database` holds the core resource identity. The optional `database_entity`
holds the Macro app's name, owner (`user_id`), lifecycle timestamps, and trash
state. Its `database_id` is both its primary key and a foreign key to the resource.

Use this pattern for new entities: a singular `<kind>_entity` table owns product
identity and lifecycle and references any reusable resource it uses. The naming
convention starts with databases; existing unrelated entity tables keep their names.

Read the [storage boundary](../../../crates/databases/README.md#storage-and-app-entities)
and [domain ports](../../../crates/databases/src/domain/ports.rs) before wiring a
consumer. Follow the [database guide](../../../docs/DATABASE_DEVELOPMENT.md) for
schema and migration work.
