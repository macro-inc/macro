# Generic date-property queries

Status: Accepted. Implementation updates the task due-date work in PR #8494.

## Decision

Use the existing property model for date filtering, sorting, and grouping across
property-bearing entity types. A caller selects a property definition and uses
its ordinary entity filters. Do not introduce a task-only query restriction or
another storage model. Tasks selects the existing Due Date property; another
view can select a custom Review Date property on documents.

Date filters remain range/presence predicates. Date sorting selects a property
and direction, keeps missing values last in either direction, and orders ties
by stable entity identity. Text search retains its existing ordering.

## Grouping input

Extend property grouping with optional date-range bucketing. The caller sends
explicit ranges instead of a backend-owned relative-date preset:

```ts
{
  type: 'property',
  propertyDefinitionId: reviewDatePropertyId,
  bucketing: {
    type: 'date_ranges',
    ranges: [
      { key: 'before_period', start: null, end: periodStart },
      { key: 'in_period', start: periodStart, end: periodEnd },
      { key: 'after_period', start: periodEnd, end: null },
    ],
    missingValueBucketKey: 'no_review_date',
  },
}
```

Bounds are UTC RFC 3339 timestamp strings. Starts are inclusive, ends exclusive,
and null means unbounded. Ranges must be ordered, non-overlapping, contiguous,
and cover all dates. Keys must be unique, including `missingValueBucketKey`.
Limit the number of ranges and key lengths before compiling SQL.

`missingValueBucketKey` is configurable. It identifies the bucket containing
entities with no value for the selected property, including cleared values.
It is not the label, a stored entity field, or a missing bucket definition.

The frontend owns labels and calendar presets. Tasks uses its frozen
viewer-local calendar to produce Overdue, Today, Tomorrow, Next 7 days
(D+2 through D+7), Later, and No due date. Other views can supply month,
quarter, or custom ranges without changing the backend contract. Recompute
relative ranges at local midnight, timezone changes, and app resume, rather
than adding fixed 24-hour durations across daylight-saving transitions.

## Backend and pagination

Validate that the selected definition is date-valued. Resolve values using the
property-definition ID and each result's property entity type. Retain every
entity family's normal authorization, lifecycle, and query-filter rules.
Compute membership, counts, and ordering before applying page limits. Bind
client-supplied keys and bounds; never interpolate them as SQL fragments.

Each source returns the entity families present in its full, filtered candidate
set, not just the returned page. Reject overlapping family summaries before
adding source counts, including exhausted sources. This relies on one source
per entity family; disjoint subsets of one family need a different merge
contract. Per-group totals count memberships, not globally distinct entities.

Keep the existing grouped response shapes. GraphQL bins contain `key`,
`totalCount`, `items`, and `nextCursor`; REST uses its normalized item pool
and group metadata. Keys and range order come from the request. Display labels
and drag-to-reschedule behavior belong to the consuming feature.

Continuation context retains the selected sort property, direction, complete
grouping configuration, group key, and filters. Reject conflicting continuation
inputs. Do not recompute relative ranges while continuing a page. Preserve
legacy cursor encodings for unrelated deployed timestamp queries.
Grouped continuations must name one group. Never advance a single cursor over
concatenated, independently limited groups; that can skip unread members.

Date edits and assignment deletion must refresh property-dependent lists and
search membership, including empty results and unloaded group counts. A local
update to one entity is not evidence of complete group membership.

## Query composition boundary

Use `properties::query_support` for the shared PostgreSQL DATE-query fragments.
This is the narrow adapter-utility exception recorded in the
[Rust guardrails](../../.agents/rules/rust/guardrails.md), not a general exception
for cross-domain adapter imports. Keep property-table SQL with its owner.

Authorize selected definitions through the properties service before source
fanout. `AuthorizedPropertyQuery` binds the immutable query to its viewer;
source requests derive the viewer from that capability. Check visibility before
revealing a definition's type, require scalar DATE definitions for date
operations, and return NotFound for inaccessible definitions. Mint a fresh
capability for every continuation request. Do not repeat the same definition
lookup in every source. Each source retains its entity authorization. Its
repository supplies a fully filtered candidate CTE, executes the query, and
hydrates its own results. The helper only
composes bound property lookups, bucket membership, exact counts, and bounded
keyset selection; it does not query source tables or execute database calls.
Shared candidate DTOs live in `models_grouping` and contain no SQL.

## Rejected alternatives

- Task-specific deadline grouping: duplicates generic property selection and
  prevents reuse for other date properties and entity types.
- Named boundaries such as `today` and `dayEight` in the backend contract:
  couples the API to one feature's buckets.
- A backend preset registry: adds a separate configuration system where
  explicit validated ranges suffice.
- Client-only grouping of paginated results: produces incomplete groups,
  incorrect counts, and unstable pagination.

No database migration, indexing field, or new property definition is required.
