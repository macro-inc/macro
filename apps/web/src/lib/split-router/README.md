# Split router

A standalone, route-only router for independently navigable panes. The host supplies
layout and external-location adapters; application content and resource lifecycles
stay outside this library.

## Ownership and routes

- Supply one static `SplitRoutes` declaration tree, or an explicit
  `SplitRoutesManifest`. A router compiles its own manifest once and exposes it as
  `router.routes`; there is no global runtime cache.
- `defineRoute()` infers node-local callback and synchronous Standard Schema
  output types, including `remountKey`, and types descendant references relative
  to that root. `defineRoutes()` assembles the static tree and rebinds ancestry.
- `useRouteParams(route)` reads only that node's params. `useParams(route)` reads
  the merged branch through that node; `useParams()` still reads the entire
  active branch.
- Matching follows declaration order, trying canonical patterns before aliases.
  Schema and child failures backtrack. Formatting always uses canonical paths.
- Every accepted location has a nonempty, structurally valid match branch.
  Resolve persisted/legacy data in the host adapter before returning snapshots.
  Runtime schema outputs are not blindly revalidated as schema inputs.
- Nested outlets preserve component identity while their match remains stable.
  Use `remountKey` for intentional resets.

## Typed nested routes

```ts
export const folder = defineRoute({
  id: 'folder',
  path: 'drive/folder/:folderId',
  params: z.object({ folderId: z.string() }),
  children: [defineRoute({
    id: 'document',
    path: 'document/:documentId',
    params: z.object({ documentId: z.string() }),
    remountKey: ({ documentId }) => documentId,
  })],
});
export const document = folder.children[0];
export const routes = defineRoutes({ definitions: [folder] });

navigate({
  route: document,
  params: { folderId: 'folder-1', documentId: 'document-1' },
});
const branch = useParams(document);       // folderId + documentId
const local = useRouteParams(document);  // documentId only
```

Both helpers return the same objects: they do not clone, mutate, compile, or
cache the tree. Ancestry metadata exists only in TypeScript. Export root definitions
directly and take descendant references through their named parent; positional
aliases from `routes.definitions` are unnecessary. A separately declared child
variable cannot acquire knowledge of a parent that later adopts it. Use `defineRoute`
at nodes with callbacks so schema outputs provide contextual parameter types.

Parent-bound destinations require the complete branch params, including when opening
another pane. A separately declared child reference knows only its own subtree and
may inherit matching ancestor values from the current pane. Explicit destination params override
those inherited values before each node's serializer runs. Serializers can therefore
receive additional branch fields; serialize the fields owned by that node. Transformed
outputs such as `Date` still require `serializeParams` and are not revalidated as inputs.

`InferSplitRouteParams` is node-local; `InferSplitRouteBranchParams` describes merged
reads; `InferSplitRouteNavigationParams` describes the flat destination bag.
`SplitRouteUnion<typeof routes>` collects references throughout a tree for destination
builders. `SplitRouteNavigationTarget<A | B>` keeps each route paired with its params.

Prefer distinct parameter names across ancestors and descendants, especially when
using claims, which receive the final merged bag. Reads honor child shadowing and
retain parent values when optional child fields are absent. Flat destinations must
satisfy every node's parameter types; incompatible shadows are rejected. Use path
navigation when repeated names need different values at different levels.

Without a schema, literal paths infer strings, optional strings, and `string[]` for
catch-all parameters. Reads include differently named alias params; destinations use
the canonical path's params. Renamed aliases need a schema or serializer that maps
those fields back to canonical names. Widened `string` paths retain untyped params.

## Search and history

- Raw query values are `Record<string, string[]>`; repeated values retain order.
  Route namespaces are inherited. URL reads filter unowned namespaces, while
  explicit writes reject them.
- `createSearchParams()` binds a synchronous Standard Schema to route-owned raw
  search. `createSearchParamsCodec()` is the corresponding pure conversion API.
- Per-pane history belongs to the router. Numeric navigation traverses it;
  external/browser history restores the complete positional layout.
- Clearing search retains the route. Ordinary unprefixed external/global search
  keys remain distinct from namespaced split search.

## Claims

A route may return `{ namespace, id }` from `claim(params)`. Providers are checked
from the deepest match toward the root; an undefined child claim allows ancestor
fallback. Claims identify resources independently of URL spelling and search.

### Acquisition policy

Explicit navigation, pane-history traversal, and search changes all check the
**final middleware-resolved destination**. An already accepted owner is activated
instead of committing the contender. The contender's pane and history cursor stay
unchanged. Activation cancels any pending departure of the accepted owner, keeping
that owner on the requested resource.

Changing search or route parameters without changing the target pane's current
claim is not a new acquisition. This preserves independently restored duplicates.
Initial, external, and host-layout reconciliation do not deduplicate entries.

`allowDuplicate` bypasses both accepted-owner checks and pending reservations,
including on numeric history navigation. It does not override duplicate policy in
the host layout. Claims currently cover panes within one router, not previews,
popovers, or other routers.

### Pending requests

Each entry transition tentatively reserves its proposed claim before middleware.
All contenders still run middleware: an original URL's owner must not prevent a
redirect to a different resource. Once the destination is resolved, the reservation
moves to the final claim, releasing the original one.

For a claim with no accepted owner, the first outstanding reservation gets the
first turn. Later contenders wait, then recheck accepted ownership after the prior
request commits, redirects, or exits. This avoids duplicate pending opens without
making completion timing choose the winner. A redirect joins the destination
claim's existing queue rather than jumping ahead.

Reservations are router-owned and released on completion, failure, cancellation,
supersession, layout replacement, or disposal. Cleanup belongs to the individual
transition, so a stale completion cannot release a newer reservation. Middleware
that ignores abort cannot commit after cancellation. Calls after disposal are
ignored.

## Middleware and errors

Middleware runs for proposed entries and may redirect synchronously or
asynchronously. Synchronous navigation stays synchronous when no reservation wait
is necessary. Signals cancel superseded work; middleware should honor them when
possible. For initial and external navigation, `externalSearch` contains the raw
incoming URL query snapshot, unchanged across redirects. Use it for application
compatibility normalization; `to.location.search` remains the proposed pane's
namespaced search. Local navigation does not inherit stale external query data.

Ordinary middleware errors are logged and fall back to the original valid
proposal, which still passes claim arbitration. Abort errors do not fall back.
Malformed proposals cannot enter accepted layout/history state. Async transition
failures are logged and release their reservations.

## Modules

- `routes.ts`, `path.ts`: manifest, matching, params, ownership, and claim derivation.
- `router.ts`, `transitions.ts`, `claims.ts`: orchestration, cancellation, pending claims.
- `history.ts`, `layout.ts`, `location-sync.ts`: pane history and host boundaries.
- `url.ts`, `search.ts`: URL framing and raw search state.
- `search-params-codec.ts`, `create-search-params.ts`: typed search conversion/binding.
- `solid.tsx`: providers, hooks, and nested outlets.
- `integrations/`: memory and Solid Router external-location adapters.
