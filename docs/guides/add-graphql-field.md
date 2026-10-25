# Adding a GraphQL field, query, mutation, or subscription

The GraphQL API is composed in `crates/complete_graph` from per-domain adapter
crates (`crates/graphql_<domain>`), served by `document_storage_service`, and read
by the web app through a normalized cache. One change touches the adapter crate,
the composed schema, the service wiring, the committed SDL, the web documents,
and the cache's mutation policy. Most misses compile cleanly and fail at runtime
as a `null`, an empty list, or a stuck mutation queue; they're called out inline.

This guide covers fields, types, and operations on existing entities. For a whole
new entity kind, see [add-entity.md](add-entity.md).

Read first: [`crates/complete_graph/AGENTS.md`](../../crates/complete_graph/AGENTS.md)
(the `id` convention, the viewer pattern, the Soup entity interface), the owning
`crates/graphql_<domain>/AGENTS.md`, and section 8 of
[the normalized cache plan](../../apps/web/docs/graphql-normalized-cache-plan.md).

## Pick a model to copy

| Adding | Copy |
| --- | --- |
| User-scoped reads | `crates/graphql_calendar/src/user_query.rs`, flattened into `GraphqlUser` |
| A mutation with typed errors | `crates/graphql_calendar/src/mutation.rs` + `src/writes.rs` |
| A field on a Soup entity backed by another domain | `pipelineEntries`: `crates/graphql_crm/src/loaders.rs` + `SoupCrmRecordEdges` in `crates/complete_graph/src/edges.rs` |
| A filter or limit argument on an edge | `GraphqlNotificationFilter` in `crates/graphql_notification/src/query.rs` |
| A subscription | `agentSessionLogAppended`: `crates/complete_graph/src/realtime.rs` |

## 1. Design the shape

- **`id: ID!` means global identity.** The client cache keys records by
  `__typename:id` and merges equal keys everywhere. Name a field `id` only when it
  identifies that object globally; reference ids get descriptive names
  (`propertyDefinitionId`). Types without `id` are embedded in their parent. Never
  add a constant or synthetic `id`; it merges every instance into one record.
- **User-scoped data hangs off `user: GraphqlUser!`**, not new root fields.
- **A field every Soup entity has** goes on the `GraphqlSoupEntity` interface and
  its SDL contract test (`complete_graph/AGENTS.md` §3).
- **Additive only.** Deployed web bundles and native apps keep sending their
  existing documents, and the native cache rejects conflicting field shapes. New
  arguments and input fields are nullable or defaulted (`Option<T>`). Don't rename,
  remove, retype, or change the nullability of a field a shipped client selects.
  Add the replacement, move clients, deprecate the old field with a removal
  date, and remove it after that date. CI enforces this; see step 8.
- **Lists take `filter` and `limit` arguments, applied in the domain query before
  the limit.** Unbounded edges made the web fetch whole notification histories to
  draw unread dots; the fix added a server-side filter and a one-row limit.
- **Document every type, field, and argument.** `#![deny(missing_docs)]` and the
  `schema_types_and_fields_have_descriptions` test in
  `crates/complete_graph/src/sdl_test.rs` both enforce it. Doc comments become
  the SDL descriptions.

## 2. The adapter crate (`crates/graphql_<domain>`)

It is an inbound adapter: resolvers convert input, call the domain service, and
map output. No SQL here ([CS-53](../../.agents/rules/rust/architecture.md)). If the
domain operation doesn't exist, add it to the domain crate first.

- **Services come from request data.** Define a context struct (for example
  `CalendarGraphqlContext` in `src/reads.rs`) and read it with
  `ctx.data::<CalendarGraphqlContext>()?`. Don't add another type parameter to
  the schema; older adapters carry generics, but new ones don't.
- **Authorize.** Use `require_authenticated_user` / `require_authorized_user` from
  `crates/graphql_common/src/authorization.rs`. The viewer comes from the request
  context, never an argument. Lookups must cover every access path (owned,
  shared, team). A direct load that only queried owned email threads returned
  `null` for shared ones. See the [security rules](../../.agents/rules/rust/security.md).
- **Batch per-entity edges with a DataLoader.** A field resolved once per list row
  goes through a keyed `Loader` (copy `crates/graphql_crm/src/loaders.rs`). Poll
  hydration futures concurrently so the loader can batch them.
- **Typed errors.** Set `extensions.code` with the crate's helper (copy `bad_input`
  / `unavailable` in `crates/graphql_calendar/src/lib.rs`, or `mutation_error` in
  `src/mutation.rs`). Log internal details and return a generic message. The web
  reads codes with `thrownResultErrorHasCode` (`apps/web/src/lib/core/util/result.ts`).
- **Never make a committed write look retryable.** The web's durable mutation
  queue retries only transport failures and releases the queue on any GraphQL
  error (`apps/web/src/lib/service-clients/service-storage/graphql-mutation-retry.ts`).
  An archive mutation whose post-write reload found nothing once retried hundreds
  of times and blocked every queued write behind it. If the write committed but
  the reload is empty, return a terminal `NOT_FOUND`.
- **Skip unknown variants instead of erroring.** An error on a non-null field
  nulls its parents up to `user` and blanks the screen. Loaders that met an
  unknown entity type used to fail the whole response; log and omit instead.
- **Keep payloads off spans.** Use `#[tracing::instrument(skip_all, err(Debug))]` as
  the calendar resolvers do ([observability rule](../../.agents/rules/observability.md)).
- **Cross-domain fields on Soup entities.** `graphql_soup` can't depend on your
  crate. Declare an associated type and constructor on `SoupEntityEdges`
  (`crates/graphql_soup/src/objects.rs`), flatten it into the entity object
  (`crates/graphql_soup/src/objects/crm_contact.rs`), and implement it in
  `crates/complete_graph/src/edges.rs`. Every test implementation of
  `SoupEntityEdges` also needs the new type: `crates/graphql_initiative/src/test.rs`,
  `crates/graphql_favorite/src/mutations/test.rs`, and
  `crates/graphql_entity_mutation/src/mutations/test.rs`.
- **New crate?** Add it to `members` in the root `Cargo.toml` and as a dependency
  of `complete_graph` and `document_storage_service`. Then run `cargo x deps` and
  commit `crates/workspace-hack` and `.github/workspace-dep-closures.json`. Add an
  `AGENTS.md` from `.agents/templates/`.

## 3. Compose it in `crates/complete_graph/src/schema.rs`

- **Query:** flatten onto `GraphqlUser`, like the calendar fields:
  `#[graphql(flatten)] async fn calendar(&self) -> GraphqlCalendarQuery`.
- **Mutation:** add your root to the `CompleteMutationRoot` tuple and to its `new()`.
- **Subscription:** add a root to `CompleteSubscriptionRoot`. Put its source in
  request data, as `realtime.rs` does, not in a schema type parameter.
- **Tests:** execute operations through the composed schema in
  `src/schema/test/<domain>.rs` (copy `calendar.rs`). Assert the new SDL lines in
  `src/sdl_test.rs` (copy `calendar_reads_hang_off_the_authenticated_user`).

## 4. Wire it into `document_storage_service` (required)

1. Build the context in `src/server.rs`.
2. Add a field to `ApiContext` in `src/api/context.rs`.
3. `data.insert(...)` it in `insert_graphql_context_data` in
   `src/api/graphql_soup.rs`. HTTP and websocket requests share this one function.

Nothing checks this at compile time. A missing insert surfaces only when a client
selects the field, as a "data does not exist" error. The `complete_graph` tests
insert their own data, so they don't catch it.

**Replica or primary.** Ordinary queries, lists, and subscription hydration read
the replica (`readonly_db`). In production it lags 1–9 s. Mutation replies, and
anything read right after a write (a just-created entity, a subscribe-then-query
log), need a primary-backed loader. Copy `AgentSessionEntityLoader` in
`crates/graphql_soup/src/loaders.rs` or `email_mutation_thread_loader` in
`crates/graphql_soup/src/mutation_thread.rs`. A new agent session read from the
replica came back `null` and the client reported "not accessible". Local stacks
can't reproduce this because their replica URL is the primary, so decide
deliberately.

## 5. Regenerate the SDL (required)

```sh
SQLX_OFFLINE=true cargo run -p complete_graph --bin graphql_schema -- static_assets/schema.graphql
```

Commit `static_assets/schema.graphql`; never hand-edit it.
`sdl_matches_committed_schema_graphql` fails when it is stale. The web bundle
ships this file as the cache's runtime schema, so a frontend change that selects
new fields needs the regenerated SDL in the same change.

## 6. Web documents and codegen

- Add or extend a document in
  `apps/web/src/lib/service-clients/service-storage/graphql/<area>.graphql`, with a
  unique operation name.
- **Select `id` on every type that has one, and `__typename` on interfaces and
  unions.** Otherwise the cache rejects the response ("every query fetching `X`
  must select its key").
- **If one selection has the same field name with different nullability on two
  union members, alias it.** Codegen rejects the conflict; `soup.graphql` uses
  `reminderDescription: description`.
- **Soup list rows:** a field that rows render goes into the `SoupItemFields`
  fragment in `soup.graphql` *and* into `mapGraphqlSoupItem` in
  `apps/web/src/lib/service-clients/service-storage/graphql-soup.ts`. Reminders
  once shipped with no `... on` selection, a mapper returning `null`, and a
  dropped filter branch. Each failed silently, and the view was simply empty.
  Data that only one view needs gets its own small document instead
  (`home-unread.graphql`); keep the shared Soup document lean.
- Regenerate. This writes `graphql/generated/graphql.ts` and
  `apps/web/src/lib/graphql-cache/generated/entity-resolver-schema.ts`. CI does not diff
  them, so commit both.

  ```sh
  cd apps/web && bun run gen-graphql
  ```

- Read through `createLiveQuery` from a query module, not from UI code. Copy
  `apps/web/src/features/crm/queries/pipeline-entries.ts`. See
  [FE-01 and FE-38](../../.agents/rules/web/data.md) and
  [libraries](../../.agents/rules/web/libraries.md).

## 7. Cache policy

- **Every mutation document needs a policy** in
  `apps/web/src/lib/queries/mutation-coverage.test.ts`: `resolver`, `custom: …`,
  `authoritative: …`, or `inactive: …`. The test fails without one.
- **`resolver`:** register one `optimisticResolver` per mutation *field* in
  `apps/web/src/lib/queries/optimistic-resolvers.ts` (entity-generic ones go in
  `entity-optimistic-resolvers.ts`). The representative document passes every field
  argument as a same-named variable with the schema's exact type. A second
  registration for the same field throws. Resolvers used to be keyed by document
  text; now any document that selects the field gets the prediction. If one
  shouldn't, list it in `declinedByResolver` and return `undefined` for it.
- **Don't predict what the server decides:** assigned ids, permission outcomes,
  undo targets. Those mutations are `authoritative`.
- **Return the changed entity, with its `id`,** from every mutation so
  normalization updates every view that shows it. Don't refetch lists.
- **Optional:** if a query takes an id argument and returns a keyed entity, add an
  `entityFromArgument` to `entityResolvers` in `graphql-soup.ts` so the cached
  entity answers offline.
- **Live updates.** Changes made elsewhere reach clients only through Soup
  realtime patches. A field derived from another domain's data refreshes only if
  that domain publishes an event that `crates/soup_realtime/src/inbound/kafka_consumer.rs`
  maps to a patch. GitHub PR metadata missed this and needed a follow-up.
- **Local filtering or search** on a new field also needs a projection in
  `crates/soup_filter_cache_adapter`. That is native code and ships only with a
  native release.

## 8. Compatibility and rollout

- Removal waits for a dated deprecation. App Store builds run their embedded web
  bundle until the bundle updater replaces it, and cached tabs and desktop OTA
  bundles keep running for days, so a removed field, type, argument, input
  field, or enum value fails every document that names it ("Try again" on
  Soup, Inbox, Mail, Channels, and Calendar after #7536). To remove one:
  1. Deprecate it with `Remove after YYYY-MM-DD` in the reason, at least 30 days
     out: `#[graphql(deprecation = "Use x. Remove after 2026-11-30.")]`. Types
     cannot be deprecated in GraphQL, so put the marker in the type's doc
     comment. Keep resolving it, or return `null` or an empty list.
  2. Move the web documents off it.
  3. After the date, delete it.
  If the backing feature is already gone, keep an inert stub: a nullable field
  returning `None`, an ignored input field, or an uninhabited type (see
  `crates/graphql_soup/src/objects/reminder.rs`).
- `cargo x graphql-schema-compat` enforces this. It compares
  `static_assets/schema.graphql` with the schema at the merge base with
  `origin/main` and fails on removals before their date, output types that
  became nullable or changed, inputs that became required or changed, new
  required arguments or input fields, dropped interfaces or union members,
  and removal dates under 30 days out. The `graphql-schema-compat` job in the
  cloud storage code check runs it against the base branch tip when the schema
  changes, and `just check` runs it locally. There is no override; set a date
  and wait.
- Deploy the schema before a frontend that selects it. A DSS without the field
  rejects the whole document.
- Additive fields keep existing client caches. An incompatible change to identity
  or field shape needs a bump of `CACHE_SCHEMA_COMPATIBILITY_EPOCH` in
  `crates/client/cache-core/src/codec.rs` and a native release, because the
  native cache retains old definitions and rejects conflicting ones (see
  [`crates/client/README.md`](../../crates/client/README.md)). Prefer a new field.

## Verify locally

```sh
cargo test -p graphql_<domain>
cargo test -p complete_graph            # SDL contract + schema tests; SQLX_OFFLINE unset
cargo x graphql-schema-compat           # no breaking change vs origin/main
SQLX_OFFLINE=true cargo check -p document_storage_service
cd apps/web && bun run gen-graphql && bun run check
cd apps/web && bunx vitest run src/lib/queries/mutation-coverage.test.ts
```

Then start the stack ([running locally](../development/running-locally.md)), run
the operation in GraphiQL (`GET` on DSS `/items/soup/graphql`), and exercise the
view in a browser. Use the `live-debug` skill for traces.
