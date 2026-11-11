# SDK MCP tools

## What it is

The tool surface of the MCP server for ChatGPT, generated from the public
Macro SDK (`packages/sdk`): every public SDK method is an operation, grouped
into tools by SDK entity and hint class. Operations run the SDK as the
caller, so no tool is handwritten.

## How it works

- `scripts/generate.ts` reads the SDK with the TypeScript compiler and writes
  `src/generated/catalog.ts` (never committed): each method of every
  namespace under `Macro` and every class with a `static byId`, its
  parameter schemas from the TS types, and its hint class from TSDoc tags.
- `src/tools.ts` turns operations into tools. `entity` grouping (default):
  `<entity>_read` / `_write` / `_delete`, one `op` discriminated union each.
  `method` grouping: one tool per operation (`document-edit`). Both are
  snapshotted in `src/__snapshots__/`, one line per tool: name, hints, its
  operations and a hash of its input schema (descriptions left out, so doc
  edits don't churn them).
- `src/call.ts` validates input with the Zod schemas `src/validate.ts` builds
  from the same catalog, mints the handles references name (an id, a Macro
  URL, or the ids a nested `byId` takes), calls the method and returns its
  JSON-safe result plus the entity's `url`.

## Tags

Every public SDK method carries exactly one of `@readonly`, `@write`
(undoable change) or `@destructive` (deletes, overwrites, sends outside
Macro, cancels), plus `@openworld` and `@idempotent` when true.
`@mcp-exclude <reason>` on a method or class leaves it out. Generation fails
on an untagged method, a parameter JSON can't carry (callbacks, bytes,
streams; optional ones are dropped), or a class with methods no operation
can reach (add a `static byId` or exclude it).

## Checks

From this directory, after `bun install --frozen-lockfile` at the root and in
`packages/sdk`: `bun run type-check`, `bun run test`. A new or changed SDK
method signature or hint tag changes the snapshots: review the diff, then
`bunx vitest run -u`.

## Gotchas

- Keep URL enrichment optional: a failed `webUrl()` lookup must not replace
  a completed operation's result with an error; direct `webUrl` operations
  still report their own failures.
- Synchronous methods that only build a handle (`thread.channel()`) and
  `byId`/`toJSON` are not operations; argument-free calls returning a
  sub-object (`document.canvas()`) and readonly sub-object properties
  (`document.access`) are paths to that object's operations.
- Results serialize handles through `toJSON`; any other class instance is
  reduced to its class name so no authenticated client leaks.
- Groups are code mode's entity directories
  (`packages/code-mode-sdk/scripts/catalog.ts`); a tool's description starts
  with its entity's `@routing` sentence.
