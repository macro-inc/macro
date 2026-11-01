# Property sorting and date-range grouping

Status: Accepted for PR #8494.

## Decision

Extend Soup's existing dynamic query and position cursor. Do not keep a separate
candidate query, cross-source merger, hydration pass, or versioned query context.
The single Soup source does not justify that extra pipeline. The previous
external-source experiment remains archived on `rahul/property-candidates-sources`
at `4292a28f33`; it is not a contract for future expansion.

Flat property sorting covers Soup-owned documents/tasks, chats, projects,
initiatives, and database rows. It omits calendar events, email threads,
channels, calls, companies, and propertyless agent sessions. Grouped reads
retain calendar events, matching the existing grouped query. Ordinary timestamp
queries retain their existing sources and behavior.

DATE filters are evaluated by Soup and OpenSearch. Call, email, and frecency
interpret DATE literals as false, preserving outer boolean negation. Tasks
excludes calls/emails and keeps text search's result ordering.

## Sort API

REST uses `sort_method=property`, `sort_property_definition_id=<definition UUID>`,
and `sort_direction=asc|desc`. GraphQL uses `PROPERTY`,
`sortPropertyDefinitionId`, and `sortDirection: ASC|DESC`.

The selected ID is a property **definition**, not an entity's assignment ID.
Like existing filters and grouping, Soup accepts definition IDs without a separate
visibility check; each source still enforces item access. Missing definitions,
unsupported types, and mismatched value variants produce missing keys rather
than a request error. DATE bucketing on a non-DATE definition puts every item
in the configured missing bucket.

The older `property_date_earliest` / `property_date_latest` names and GraphQL
variants are removed before release. Existing timestamp `sort_direction` support
is retained because that API already exists on main.

| Property type | Ascending key |
| --- | --- |
| DATE | UTC epoch microseconds |
| NUMBER | Numeric value |
| BOOLEAN | False = 0, true = 1 |
| SELECT_STRING / SELECT_NUMBER | Selected option's stored `display_order` |
| Multi-select / TAG | Lowest `display_order` among selected options |
| STRING / ENTITY / LINK | Missing key; fall back to update-time ordering |

A missing value, empty selection, or mismatched JSON variant has no key. Option
labels and numeric option values do not control ordering. Clients choose default
direction: Status is ascending; Priority is descending (urgent first).

SQL uses double-precision keys today, with the type carried alongside the key
expression. Property pages order by `sort_key ASC|DESC NULLS LAST, sort_ts DESC,
id DESC`. Direction applies only to the property key; ties use newest update,
then descending ID. Timestamp queries retain their existing SQL ordering and
keyset expressions without a `sort_key` term.

Flat timestamp queries keep the existing lightweight top clauses. A filter proven
to match only tasks selects the constant TASK property namespace, avoiding a
second subtype probe in flat and grouped queries. Mixed filters still resolve
TASK versus DOCUMENT through `document_sub_type`; predicates that use subtype
columns retain that join even for task-only filters.

Property sorting joins `entity_properties` directly by definition, entity ID,
and canonical entity type. Uncorrelated scalar lookups provide the definition
type for the guarded sort expression, rather than a per-item definition join.
Option sorts build a `jsonb_object_agg` map from option IDs to stored display
orders through an uncorrelated lookup of the sort definition bind (`$9` flat,
`$11` grouped). PostgreSQL can build the map once as an InitPlan, instead of
re-reading options per item. Each value takes the minimum mapped order; unknown,
deleted, and non-UUID option IDs are ignored, and unknown-only values stay missing.
Grouped property sorts materialize `TopItems` before expanding multi-value groups
so each item supplies its sort key before fan-out. Timestamp grouped queries
keep their inlineable `TopItems` CTE.

Document-ID arrays start at `$9` for flat timestamp queries and `$11` for grouped
timestamp queries. Property sorts append only the definition ID and cursor key,
moving those array starts to `$11` and `$13`, respectively. There is no reserved
sign-multiplier parameter or `sort_parameters` CTE.

## Grouping input

Property grouping accepts optional date-range bucketing:

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

Bounds are UTC RFC3339 strings. Starts are inclusive; ends are exclusive. Null
means unbounded. Ranges must be ordered, contiguous, non-overlapping, cover all
dates, and have unique keys distinct from `missingValueBucketKey`. Validate range
counts and key lengths in REST/GraphQL input conversion before calling the service.

The grouping SQL returns a range index, which Rust maps to the caller's key.
Interpolate typed UTC bounds with `to_rfc3339()`, as quoted `timestamptz` literals,
matching the existing date predicates. Never interpolate raw date strings or
caller bucket keys. Document-ID sets remain bound arrays.
Missing or cleared dates use the configured missing-value bucket. Keep the
existing count and row-number windows, per-group limits, and single-group
load-more behavior. REST keeps raw UUID pool keys; GraphQL keeps typed entities.

Property grouping reads definition types through uncorrelated scalar lookups.
After expanding stored values, one `property_options` join supplies both option
existence and `display_order`. Deleted options retain the empty/Not Set group;
legacy DOCUMENT assignments on tasks never override canonical TASK assignments.

## DATE filters

The AST has one date literal: `{"dr": {"start": ..., "end": ...}}`. Both
bounds are optional. `{"dr": {}}` matches any present DATE value; wrap the
literal in `!` (REST AST) or `not` (GraphQL) for missing or cleared dates.
GraphQL uses `value: {dateRange: {}}` and no `hasDate` variant. The flat
REST/search `has_date` flag remains for Tasks search, expanding to the same
open range or its negation.

## Pagination and authorization

Use the existing position cursor, extended with a typed property key (`Number`
today) and its direction. Missing keys serialize as null. For a non-null key,
compare it with `>` for ascending or `<` for descending, then use descending
`(sort_ts, id)` ties; include missing keys after present keys. A null cursor key
continues only through missing keys with the same descending tie-breakers.

Do not add a frozen source list, context version, unused email view, or link IDs.
The client sends grouping configuration again on continuation requests. Its
query key includes property, direction, filters, and ranges; a changed query key
starts fresh pages. Keep deployed timestamp cursor decoding compatible.

Property-definition authorization is not added solely for sort or grouping.
Any future policy must cover filter, group, and sort IDs together. Item access,
lifecycle gates, and complete filters stay in the existing source clauses.
Preserve projection-backed document facts and property enrichment without a
second fetch-by-ID pass.

## Client behavior

The view owns labels and calendar presets. Tasks builds Overdue, Today,
Tomorrow, Next 7 days (D+2 through D+7), Later, and No due date from viewer-local
calendar boundaries. Recompute at midnight, timezone changes, and resume;
do not add fixed 24-hour durations across daylight-saving transitions.

Loaded items move immediately between date buckets using the same half-open
range rule in TypeScript. Revalidation corrects unloaded rows and authoritative
counts. Refresh a query when the edited definition is its sort property, its
group property, or appears in a date predicate. Match those request fields,
not serialized-key substrings. Assignment deletion without a definition ID
refreshes all property-dependent queries.

Tasks uses cached property definitions/options for its local numeric comparator,
with missing values last and the same update/ID tie-breakers as SQL. Group
metadata uses the same stored option `display_order`; leave assignee labels in
alphabetical order. Status and Priority are explicit sort choices. Do not add
property sorting or date predicates to the WASM reconciliation engine:
property-sorted pages remain server-backed.

## Alternatives rejected

- A candidate pipeline for one source: duplicates the existing UNION and adds
  a merger, separate hydration, authorization capability, and cursor context.
- Task-only deadline handling or backend-relative presets: couples shared APIs
  to one feature instead of the selected property and caller-provided ranges.
- String/entity sorting through the numeric key: needs text collation or display
  names that this query does not provide.
- Client-only grouping of all results: cannot establish complete counts or
  membership from a bounded page. Local movement is optimism, not authority.

No database migration, new property definition, or WASM change is required.
