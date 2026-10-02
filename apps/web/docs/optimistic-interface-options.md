# Four optimistic mutation interfaces

These are alternative implementations on four independent branches from
`91cdc08dab` (main), including the soup row performance fix, PR #7236.
The current branch implements **1: automatic local resolvers**. Do not merge the four together.

| Option | Branch | Mutation author writes | Main tradeoff |
| --- | --- | --- | --- |
| 1. Automatic local resolvers | `synoet/optimistic-local-resolvers` | One typed resolver; ordinary `client.mutation(document, variables)` everywhere | Must register the resolver on the cached client |
| 2. Typed mutation definitions | `synoet/optimistic-mutation-definitions` | Export `defineMutation(document, recipe)`; call its `.execute(client, variables)` | Every caller must use the definition instead of the raw document |
| 3. Fragment transactions | `synoet/optimistic-fragment-writes` | Write selected fragment fields inside the mutation's transaction callback | More call-site code; useful for explicit multi-record/relation changes |
| 4. GraphQL annotations | `synoet/optimistic-document-directives` | Annotate the mutation's selected fields with `@optimistic` | Variable paths are strings; complex business rules outgrow the small DSL |

## Recommendation

I would choose **option 1 for the stated priority: ordinary mutations should be
optimistic everywhere without per-call plumbing**. A typed local resolver defines
what the mutation predicts once, and the exchange applies it for every call.
There are no UUIDs, snapshots, query-cache loops, rollback callbacks, or extra
cache reads at the call site. Keep resolvers in domain query modules and compose
the registry at client creation. Option 2 is a close alternative if explicit,
self-contained imports are more valuable than keeping `client.mutation` unchanged.

The GraphQL document alone cannot determine server business logic. For example,
`MARK_SEEN` must not reopen a DONE notification, an archive changes `inboxVisible`
to the inverse of its input, and creation returns server-assigned IDs. The missing
piece is a small local semantic definition, not a second implementation of queue
ordering or rollback. These branches demonstrate four places to put it.

## 1. Automatic local resolvers (the proposed idea)

Define the prediction once, using generated input/result types:

```ts
optimisticResolver(MarkEmailThreadSeenDocument, ({ input }) => ({
  response: {
    markEmailThreadSeen: {
      __typename: 'GraphqlSoupEmailThread' as const,
      id: String(input.threadId),
      isRead: true,
    },
  },
}));
```

Register it through `optimisticResolversExchange(resolvers)` immediately before
`normalizedCacheExchange(host)`. All callers use the normal API:

```ts
await client.mutation(MarkEmailThreadSeenDocument, {
  input: { threadId },
}).toPromise();
```

`{ optimisticMutation: false }` explicitly opts out. Revalidation/link/creation
identity recipes can be supplied by the resolver or composed with caller options.
Explicit legacy optimistic contexts take precedence, so migration can be gradual.
A broken resolver returns an error for that mutation without sending its request
or breaking other operations. Unregistered mutations retain their normal behavior.
The resolver is bound to the complete document, not merely an operation name;
an alternate selection needs its own registration.

## 2. Typed mutation definitions

```ts
export const markThreadSeen = defineMutation(
  MarkEmailThreadSeenDocument,
  ({ input }) => ({
    response: {
      markEmailThreadSeen: {
        __typename: 'GraphqlSoupEmailThread' as const,
        id: String(input.threadId),
        isRead: true,
      },
    },
  })
);

await markThreadSeen.execute(client, { input: { threadId } }).toPromise();
```

The definition carries its document and prediction together. It needs no client
registry or extra exchange, and schema types check both inputs and predicted
fields. Existing normalized records must include their ID. Per-call relation
recipes and revalidations compose with the definition. This is the smallest
runtime addition, but a raw `client.mutation(document, variables)` bypasses it.

## 3. Fragment transactions

```ts
await executeFragmentMutation(
  client,
  MarkEmailThreadSeenDocument,
  { input: { threadId } },
  (tx) => tx.write('markEmailThreadSeen', EmailReadStateFieldsFragmentDoc, {
    id: threadId,
    isRead: true,
  })
).toPromise();
```

`__typename` comes from the fragment. The compiler requires identity and checks
the patch's fields and values against the generated fragment. The selected root
must directly include that fragment; this prototype deliberately rejects an
unselected fragment instead of guessing how to route it. Array results work the
same way, and `tx.update(existingLinkRecipe)` adds a relation change to the same
transaction. There is no read-modify-write snapshot or cache enumeration.

## 4. GraphQL annotations

```graphql
mutation SetEmailThreadArchived($input: SetEmailThreadArchivedInput!) {
  setEmailThreadArchived(input: $input) {
    __typename @optimistic(value: "GraphqlSoupEmailThread")
    id @optimistic(from: "input.threadId")
    inboxVisible @optimistic(from: "input.archived", invert: true)
  }
}
```

Call it with ordinary `client.mutation`. The exchange compiles the document once,
predicts annotated fields, strips the directives, and passes the operation into
the same normalized cache. The network transport also strips annotations when
local caching is disabled. `each`/`item` cover bulk notification IDs; `when`/`equals`
guard the unconditional DONE prediction. Aliases, fragments, skip/include,
variable defaults, and explicit null are covered. Unannotated fields are omitted.

Codegen validates GraphQL selections and directive argument syntax. It does not
validate a `from` string against the generated input type. Missing paths, ambiguous
sources, and invalid boolean inversion fail locally. Annotated inline fragments
are rejected: polymorphic predictions need a richer compiler or a resolver.
This option has the most new machinery and the weakest refactoring support.

## What all four implementations preserve

- Real read, unread, archive/undo, and ID-based notification mutations use the new
  interface. Other mutations keep the existing API. Entity-scoped notification
  writes stay authoritative because exact undo needs the returned notification IDs.
- Only explicitly predicted fields enter the cache; unrelated record fields remain
  intact. No whole-query snapshot is captured or restored.
- The existing cache-core transaction owns durable enqueue, optimistic layers,
  network dispatch, canonical commit, and rollback on permanent failure. Retryable
  failures retain the layer and return `queued`, with existing replay behavior.
- Each intent gets a fresh UUID by default. An older rollback cannot erase a newer
  layer. Explicit UUID reuse remains an advanced, deliberate coalescing decision.
- Existing relation updates, revalidation descriptors, and creation identity
  bindings remain available. This is not automatic inference of list membership,
  pagination, counters, server-generated values, or conditional state transitions.
- Cache-disabled clients continue to use network responses. No server changes or
  Rust cache changes are required by these interfaces.

## Reactivity and performance evidence

All branches use the existing production worker, freshly built WASM cache-core,
and the reconciled soup row store from PR #7236. The browser harness seeds 1,000
rows in a disposable OPFS scope and drives real mutation helpers against a delayed
fake network. No hosted data is edited.

The common assertions check optimistic visibility before the network resolves,
canonical correction, permanent rollback, rapid read/unread with an older failure,
a stale server refresh while layers are pending, and retryable failure returning
`queued`. For a single read change, all 1,000 row identities survive and **only one
read-field observer runs again**; name, inbox-visible, and all other rows' observers
remain untouched. Rollback changes only the affected field again.

These interfaces have the same rendering behavior. They do not eliminate the
worker/OPFS round trip before cache acknowledgement. Existing immediate done
visibility overlays remain necessary and are preserved. Cache-core currently
tracks dependent records, so affected query results may still be reread and the
row store reconciles their snapshots. This is evidence of narrow DOM reactivity,
not a claim of constant-time cache materialization or a latency benchmark.

## Validation results

| Branch option | Focused Vitest tests | Chromium scenarios | Full web TypeScript | `just check` |
| --- | ---: | ---: | --- | --- |
| Local resolvers | 215 passed | 5 passed | Passed | Passed |
| Mutation definitions | 213 passed | 5 passed | Passed | Passed |
| Fragment transactions | 214 passed | 5 passed | Passed | Passed |
| Document annotations | 217 passed | 5 passed | Passed | Passed |

The Vitest totals include the existing cache-exchange regression suite on each
branch; they are not counts of newly added tests. TypeScript includes negative
compile-time assertions for wrong variables, wrong fields, wrong scalar types,
and missing record identity. The annotation branch uses runtime compiler checks
and GraphQL code generation instead of typed variable-path assertions.

## Reproduce

Build the WASM from the repository root (shared Rust sources are identical across
these four branches):

```sh
nix develop --command cargo x cache-wasm --force
```

Enter `apps/web` and run the focused tests and the standalone browser suite:

```sh
\cd apps/web
bunx vitest run --project graphql-cache --project service-clients \
  src/lib/graphql-cache/exchange \
  src/lib/service-clients/service-storage/graphql-email-read-state.test.ts \
  src/lib/service-clients/service-storage/graphql-soup.test.ts
bunx playwright test --config src/lib/graphql-cache/worker/browser-test/playwright.optimistic.config.ts
NODE_OPTIONS=--max-old-space-size=16384 bunx tsc --noEmit --project tsconfig.json
```

The browser suite owns port 4196 and refuses to reuse another server. It requires
an installed Playwright Chromium. Run `just check` from the repository root.
