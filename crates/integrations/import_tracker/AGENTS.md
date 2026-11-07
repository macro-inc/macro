# import_tracker

## What it is

Shared read-only issue tracker contracts and Pipedream transport. Used by the reviewed workspace importer in `crates/import`.

## Start here

- `src/domain/`: source-neutral typed inventory and ports.
- `src/outbound/`: fixed reads, pagination and rate-limit handling.

## Boundaries

Provider adapters read only. Planning, authorization, approval and writes to
Macro belong to `import`; credentials belong to `pipedream_mcp`.

## Checks

- `cargo test -p import_tracker`

## Gotchas

Never accept arbitrary GraphQL or request paths from callers. Inventory never
writes to the connected provider. Keep pagination complete and reject cursors
that repeat instead of silently truncating a workspace.
