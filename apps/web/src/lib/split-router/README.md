# Split router

A standalone, route-only router for independently navigable panes. The host supplies
layout and external-location adapters; application content and resource lifecycles
stay outside this library.

## Ownership and routes

- Supply one static `SplitRoutes` declaration tree, or an explicit
  `SplitRoutesManifest`. A router compiles its own manifest once and exposes it as
  `router.routes`; there is no global runtime cache.
- `defineRoute()` preserves literal IDs and synchronous Standard Schema param
  types. Use route-object destinations and `useRouteParams(route)` for typed
  navigation and reads.
- Matching follows declaration order, trying canonical patterns before aliases.
  Schema and child failures backtrack. Formatting always uses canonical paths.
- Every accepted location has a nonempty, structurally valid match branch.
  Resolve persisted/legacy data in the host adapter before returning snapshots.
  Runtime schema outputs are not blindly revalidated as schema inputs.
- Nested outlets preserve component identity while their match remains stable.
  Use `remountKey` for intentional resets.

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
possible.

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
