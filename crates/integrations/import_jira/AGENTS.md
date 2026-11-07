# import_jira

## What it is

Read-only Jira Cloud workspace inventory. Used by the reviewed workspace importer in `crates/import`.

## Start here

- `import_tracker::domain::model`: the re-exported typed inventory and read port.
- `src/outbound/`: fixed reads, pagination and rate-limit handling.

## Boundaries

Provider adapters read only. Planning, authorization, approval and writes to
Macro belong to `import`; credentials belong to `pipedream_mcp`.

## Checks

- `cargo test -p import_jira`

## Gotchas

Never accept arbitrary GraphQL or request paths from callers. Inventory never
writes to the connected provider. Keep pagination complete and reject cursors
that repeat instead of silently truncating a workspace.
