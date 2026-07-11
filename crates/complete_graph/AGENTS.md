# complete_graph — schema conventions

This crate composes the domain GraphQL adapter crates (`graphql_soup`,
`graphql_properties`, `graphql_notification`, with shared plumbing in
`graphql_common`) into the complete GraphQL schema consumed by the client's
**normalized cache** (`crates/client`, design doc:
`apps/web/docs/graphql-normalized-cache-plan.md`). Two field-naming
conventions in this schema are load-bearing for cache correctness. The
cache's build validates *shapes* but cannot validate *semantics* — that's
what schema review is for.

## 1. `id` is a reserved, semantic field name (presence-of-id convention)

Clients key cache records by `__typename:id`. Consequences:

- **An output object type with an `id: ID!` field is a normalized entity.**
  Two responses containing the same `__typename:id` pair are *merged into
  one record* — so `id` must identify the same logical value everywhere it
  can appear, across all queries, arguments, and parent objects.
- **Only name a field `id` when it is the object's global identity.** If a
  type carries a reference to something else's id, name it accordingly:
  - `GraphqlSoupProperty` exposes `propertyDefinitionId`, **not** `id` — a
    property instance's `value` is per-entity, while the definition id is
    shared. Naming it `id` would merge property values across entities.
  - `GraphqlSoupChannelMessage.id` (renamed from `messageId`) — it *is* the
    message's identity, so it uses the reserved name.
- **Types without an `id` field are embedded** inline in their parent
  record (`SoupPage`, participants, property values, `DocumentSubType`).
  This is correct for value objects and query-scoped wrappers. Do **not**
  add constant or synthetic ids to such types — a constant id (e.g.
  `"soup_page"`) would merge every instance into a single record globally.
- `id` fields must be exactly `ID!` (non-null, non-list); the cache build
  (`crates/client/cache-core/build.rs`) fails otherwise, and fails if
  the query root exposes an `id`.

Review checklist when adding/changing a type:
1. Does it have a stable global identity? → expose it as `id: ID!`.
2. Is its content dependent on where it appears (parent entity, arguments)?
   → no `id` field; expose reference ids under descriptive names.
3. Renaming/removing an `id` field changes client caching semantics — it
   rotates cache keys and turns entities into embedded values (or vice
   versa). Deliberate, but call it out in review.

## 2. `QueryRoot → user` (viewer pattern) is the identity witness

All user-scoped data hangs off `user: GraphqlUser!`, and `GraphqlUser.id`
must be the **authenticated** user's id from the request context. The
client extracts it from every response and passes it to the cache as a
session tag: a response for a different user than the one bound to the
cache triggers a full wipe-and-rebind (cross-user leak protection on
account switches).

- Never resolve `GraphqlUser.id` from anything other than the
  authenticated request context.
- New user-scoped root data should be added under `GraphqlUser`, not as
  new root fields.

## Regenerating the SDL

After schema changes:

```sh
cargo run -p complete_graph --bin graphql_schema -- static_assets/schema.graphql   # from repo root
```

The exported `static_assets/schema.graphql` feeds both the client codegen
(`apps/web && bun gen-graphql`) and the cache metadata codegen (hashing it —
any change rotates all persisted client caches, which rebuild from the
network automatically).
