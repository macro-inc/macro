# agent_permission_registry

## What it is

Agent permissions: the one checked-in registry that gives every Macro SDK
operation a JS tools program can call (service + operationId, the key the
JS tools analyzer reports) a permission group, an action (create, read,
update, destroy, send) and a label.
Rust reads it through this crate; the web app imports the same
`registry.json` as `@agent-permission-registry` (`apps/web/tsconfig.json`)
through `apps/web/src/features/agent-permissions/core/registry.ts`.

## Start here

- `registry.json`: the groups (display order, name, description) and every
  operation, one per line, grouped by service.
- `src/lib.rs`: `groups`, `group`, `operation`, `operations`; the web's
  `permissionGroups`, `groupOperations`, `permissionOperation`.

## Recipes

- Classify a new operation (generating the JS tools catalog names it): add a line under
  its service in `registry.json` with the group whose area it touches, the
  action, and a short label a person understands ("Send email"). `send` is
  anything that reaches other people (messages, email, invites, sharing,
  calendar changes guests see), even when it also creates or updates, and
  anything that carries text the program chose out of Macro (searching the
  web, fetching or previewing a URL), even when it only reads;
  `destroy` deletes; a POST that only reads is `read`, but nothing that
  saves a file, may write (a query that can run any statement) or reaches
  an outside app is. Changing who can see or edit something is `send` in
  `sharing`, whatever area the item is in. Labels are unique within a group.
- Mark an operation `"always_allowed": true` only when it can do nothing
  but restrict the agent itself (today: `tighten_agent_tool_permissions`):
  no setting then applies to it, so a person's Ask or Never on its group
  can't stop the agent restricting itself. The test pins the list.
- Remove an operation the SDK dropped, or one the JS tools catalog now
  skips (added to the SDK's `Excluded` list in
  `packages/sdk/src/coverage/skipped.ts`): delete its line. The registry
  holds exactly the operations a program can call, so the permissions page
  offers no setting that does nothing.
- New group: add it to `groups` (stable `id`, never renamed: settings are
  stored under it) and move operations into it, each keeping its action. A
  move needs a migration that copies every saved `<old>:<action>` rule to
  `<new>:<action>` in each permission table, or the moved operations lose
  their settings; pin the moved list in `src/test.rs`. `channel_admin` (moved
  out of `channels`, migration `20261122220000`) is the example.
- Channel operations: sending and reading messages, threads, mentions,
  reactions, DMs and channel labels are `channels`; creating, deleting and
  renaming a channel, its picture, members, join links, access requests and
  channel bots are `channel_admin`.

## Checks

- `cargo test -p agent_permission_registry`: the file parses, groups and
  labels are consistent.
- `bun run test` in `packages/code-mode-sdk`: generating the JS tools catalog
  fails on a tool without a line here, and `catalog.test.ts` fails on a
  line for an operation that is not a tool (skipped or gone). A JS tools
  program calls an operation as
  `tools.<service with - written _>.<operationId>`.

## Gotchas

- The key is the spec's operationId (`create_task_handler`), as the JS tools
  analyzer reports it. Code mode's `fetch` and the TypeScript SDK name
  operations by method (`createTaskHandler`). An operationId declared on
  two routes is one entry here and two tools (`<operationId>_2`).
- Some operations do whatever their input says: running a routine or an
  agent session, a connected app tool. Their action says what they are, not
  everything the work they start may do.

- Group ids and actions are stored in people's settings: renaming one loses
  them.
- Keep one line per operation so a diff shows exactly what was reclassified.
