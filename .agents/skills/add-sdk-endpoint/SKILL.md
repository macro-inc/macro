---
name: add-sdk-endpoint
description: Wrap a new backend endpoint in the TypeScript SDK (packages/sdk), or record it as skipped. Use when `just coverage` fails, or after adding an endpoint to a Rust service.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Add an SDK endpoint

Arg `skip`: record the endpoint as skipped instead of wrapping it.
Run everything from `packages/sdk`.

Every generated endpoint must either have a call site under `src/` or be listed in
`src/coverage/skipped.ts`. Being in both also fails.

## 0. Find it

After a local Rust API change, regenerate its web contract from the repository
root with `bun run --cwd apps/web gen-api <service-name>` before running
`bun run sync-specs && bun run generate` here.

`just coverage` lists `UNCOVERED <service>.<endpoint>`.

## 1. Skip or wrap?

With the `skip` arg, skip. Otherwise **ask the user**, one line per endpoint, with a
short recommendation — don't decide silently.

Skip-worthy: internal plumbing (auth/session, health, infra, web-app internals, MCP,
batch previews) and features so narrow that no SDK user would reach for them.
Everything a user could plausibly want belongs in the SDK.

To skip: add the method name, alphabetically, to `<camelService>Excluded` in
`src/coverage/skipped.ts`, then `just coverage && just check`. Don't wrap.

## To wrap it

1. **Read** the method in `generated/<service>/sdk.gen.ts` and its types in
   `types.gen.ts` (note `path` / `query` / `body`).
2. **Pick a home**, and read a sibling first — `entities/tasks/` is the smallest
   complete example, `entities/documents/document.ts` the richest:
   - acts on one entity → method on that class
   - create/list/search/lookup → the namespace
   - new noun → new `src/entities/<noun>/` pair, registered in `src/macro.ts`
   - cross-entity capability → a base in `src/entities/entity.ts`
3. **Never take or return a raw id** (the [SDK rule](../../rules/sdk.md)). Take
   the entity handle and return handles; if the noun has no entity class yet,
   build it in this change rather than accepting a `string`.
4. **Match the conventions:**
   - `static byId(client, id)`; detail via `Lazy` + `protected fetch()`, exposed with
     `this.field(...)` / `this.mappedField(...)`
   - extend `MacroEntity` / `FavoritableEntity` / `PropertiedEntity`, setting
     `entityType` / `propertyEntityType`
   - writes touching this entity's detail → `this.mutate(...)`; others → `unwrap(...)`
   - every generated call goes through `unwrap()`
   - cursor lists → `paginate()` → `AsyncGenerator`; search → `entitySearch(...)`
   - camelCase + `undefined` on the SDK side even when the wire is snake_case/nullable
   - TSDoc every public member. No `any`. End each public method's TSDoc with its
     MCP hint tag (`@readonly`, `@write`, `@destructive`; `packages/sdk-mcp/AGENTS.md`)
     and update that package's tool snapshots (`bunx vitest run -u` there).
   - an entity with its own page in the app gets `webUrl()`, built from
     `this.client.webAppUrl` and the route the web app's copy-link action uses
     (`/app/agent/<id>`, not the entity type when they differ), plus a
     `toJSON()` override adding `url: this.webUrl()`. Agents hand these links
     to users; without one they guess the route.
5. **New service?** Only when the endpoint's service isn't reachable from
   `MacroClient` yet — per *service*, not per entity; a new entity needs none of this.
   Wire the `Sdk` into `src/utils/client.ts`, a host into `src/config.ts`, and an
   entry into `ACCESSORS` in `src/coverage/check.ts`. That last one is easy to miss:
   coverage decides "is this called?" by grepping `src/` for the literal text
   `.<accessor>.<endpoint>(`, so a service absent from `ACCESSORS` reports *every*
   one of its endpoints as `UNCOVERED` no matter how well you wrapped them. If a
   whole service looks uncovered, check that map before believing it.
6. **Already listed as skipped?** Remove it, or coverage fails with `STALE SKIP`.
7. **Verify:** `just check && just coverage && bun run lint && bun run format`.
8. **Document:** README only for genuinely new user-facing capability. New webhook
   events come from the storage spec via `src/events/types.ts` — regenerate, never
   hand-write.

## Never

- Hand-edit `generated/` or `specs/` — build output.
- Accept an id where an entity handle belongs.
- Mark something skipped just to make coverage pass.
