# Query-backed list views

Status: design note for future iteration; this architecture is not yet fully
implemented.

## Goal

List views need one collection definition to drive both their mounted UI and
navigation after the list has opened an entity in the same split. The query and
pagination lifetime must follow the split panel, while rendering and expensive
reactive memoization should follow the mounted view.

## Layers

### Data source

A data source owns querying and fetching operations. Its values are exposed as
plain functions rather than source-owned memos so the caller decides where a
read is tracked.

The base contract should only contain data, request status, errors, and refresh.
Features extend that contract with their own operations. Pagination is not
required by every data source, so a paginated feature source adds `hasMore`,
`isLoadingMore`, and `loadMore` itself.

Tasks additionally exposes its per-group continuation sources. Each group
source returns raw group query data and its own pagination operations. The
source does not filter entities, sort them, or build list rows.

### List model

A feature-owned list model defines the semantic collection presented by the
view. It applies every rule that can change which entity navigation should open
next:

- tab and facet predicates
- sorting and grouping
- collapsed-group visibility
- parent and continuation-page merging
- deduplication
- selection of the pagination source for a row

The model exposes plain functions, including `items()` and a feature-specific
pagination resolver. The same model is used by rendering, the list controller,
and cross-block keyboard navigation.

### Controller and rendering

The data source, list model, controller, and cross-block navigation hotkeys are
owned by the split panel. They remain available after the list opens a block,
so j/k navigation can read the latest projected collection and fetch another
page when it reaches the end.

The mounted view creates local memos around the model functions for efficient
rendering and virtualization. Those memos belong beneath the view's Suspense
boundary. Presentation-only derivations remain local to row components.

The list controller must pull the model's current items during operations
instead of eagerly memoizing them in its panel-owned root. This lets mounted
rendering choose its reactive owner while off-screen navigation reads current
query and group pages on demand.

## Applying the pattern

Inbox's model owns Signal/Noise/All admission, notification enrichment, read
facets, date grouping, and ordering.

Tasks' model composes the parent query, search results, and per-group
continuations before applying task predicates, sorting, grouping, and collapsed
group visibility.

Channels' model composes channel, direct-message, and recents sources, then
owns section partitioning, recents ordering, disclosure visibility, and
section-specific pagination. Full and slim rails render the same model.

## Open questions

- Define the smallest pull-based controller change without regressing focus and
  selection reconciliation.
- Decide how the custom GraphQL query adapter should participate in Solid
  Suspense consistently with TanStack Query.
- Confirm whether grouped cross-block navigation should prefetch only the
  focused group or advance into the next visible group first.
