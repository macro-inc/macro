---
description: "The TypeScript SDK exposes entity handles, never raw ids: methods take and return entity objects, and a missing noun gets a new entity class."
paths:
  - "packages/sdk/src/**"
globs: "packages/sdk/src/**"
alwaysApply: false
---

# SDK methods take and return entities, not ids

Ids are correlation data, not parameters; a `string` id argument lets callers
pass the wrong kind of id and scatters operations away from the thing they act on.

- A public method never takes a raw id. It takes the entity handle and reads `.id`
  internally: `task.addComment(...)`, not `tasks.addComment(taskId, ...)`.
- A public method never returns a raw id; it returns a handle.
- If the id names a noun with no entity class yet, create the entity (class plus
  namespace under `src/entities/<noun>/`, registered in `src/macro.ts`) in the
  same change. Sub-resources too: a listing returns handles, and mutations are
  methods on them (`entry.edit(...)`, `entry.remove()`).
- The only id-taking entry point is `static byId(client, id)`, which mints a handle.

Separate the import block, top-level declarations, and class members with blank lines; place JSDoc above the member it documents.

Details and conventions: the `add-sdk-endpoint` skill.

Check: no exported SDK method has a parameter or return type that is a bare id
string, apart from `byId`.
