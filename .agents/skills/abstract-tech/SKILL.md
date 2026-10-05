---
name: abstract-tech
description: Apply ABSTRACT_TECH when building features on reusable database technology, such as CRM, or separating a reusable engine from an app entity. Choose the core resource and domain port, and keep product identity and lifecycle on the consuming entity.
---

# ABSTRACT_TECH

Build on the inner technology through its owning domain port. Do not create an
existing app's entity just to reuse its engine.

## Pattern

- The **core resource** owns reusable data and mechanics. It must work without
  the app entity, its display name, owner, trash state, or access grants.
- The **app entity** supplies product identity, metadata, and lifecycle, and
  references the resource with a foreign key. New app entities use singular
  `<kind>_entity` tables. This convention starts with databases; it does not
  require renaming unrelated existing entities.
- The **consuming domain** authorizes access to its resource, validates commands,
  and defines discovery and cleanup. Its composition root supplies the storage
  adapter through the owning domain's port. Using the core does not bypass
  authorization or grant access to another domain's resources.

## Databases

For CRM or another feature backed by database technology, reference the core
`database.id` from that feature's domain model and use `DatabaseStorage`:
`create_storage`, `apply_storage_writes`, and `delete_storage`. Reuse its tables,
columns, cells, versions, and journal without creating `database_entity` or
database app grants. The port expects validated writes from a trusted domain;
core-only storage is not automatically discoverable through Soup.

For the Macro database app itself, use the existing `DatabasesService` path. Its
`CellStore` preserves the entity lifecycle and owner-grant transaction.
`database_entity` holds app metadata; its `database_id` is a primary key and
foreign key to the core. The plural `databases` table is rollout compatibility,
not the foundation for new consumers.

Read the [storage boundary](../../../crates/databases/README.md#storage-and-app-entities)
and [domain ports](../../../crates/databases/src/domain/ports.rs) before wiring a
consumer; follow the [database guide](../../../docs/DATABASE_DEVELOPMENT.md) for
schema and migration work.
