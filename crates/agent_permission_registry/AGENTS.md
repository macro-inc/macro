# agent_permission_registry

## What it is

Agent permissions: the one checked-in registry that gives every Macro SDK
operation (service + operationId, the key the OCaml call analyzer reports) a
permission group, an action (create, read, update, destroy, send) and a label.
Rust reads it through this crate; the web app imports the same
`registry.json` as `@agent-permission-registry` (`apps/web/tsconfig.json`)
through `apps/web/src/features/agent-permissions/core/registry.ts`.

## Start here

- `registry.json`: the groups (display order, name, description) and every
  operation, one per line, grouped by service.
- `src/lib.rs`: `groups`, `group`, `operation`, `operations`; the web's
  `permissionGroups`, `groupOperations`, `permissionOperation`.

## Recipes

- Classify a new operation (the OCaml SDK check names it): add a line under
  its service in `registry.json` with the group whose area it touches, the
  action, and a short label a person understands ("Send email"). `send` is
  anything that reaches other people (messages, email, invites, sharing,
  calendar changes guests see), even when it also creates or updates;
  `destroy` deletes; a POST that only reads is `read`. Labels are unique
  within a group.
- Remove an operation the SDK dropped: delete its line.
- New group: add it to `groups` (stable `id`, never renamed: settings are
  stored under it) and move operations into it.

## Checks

- `cargo test -p agent_permission_registry`: the file parses, groups and
  labels are consistent.
- `nix-shell shell.nix --run "dune build && dune test"` in
  `packages/sdk-ocaml`: `analyzer/test/test_registry.ml` fails on an
  unclassified operation or one that no longer exists (CI: `OCaml SDK Check`).

## Gotchas

- Group ids and actions are stored in people's settings: renaming one loses
  them.
- Keep one line per operation so a diff shows exactly what was reclassified.
