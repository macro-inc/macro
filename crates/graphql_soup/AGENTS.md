# graphql_soup

## What it is

Backs the Soup feature (the app's unified entity search/home surface): the
soup-domain GraphQL wrapper types. The composed schema (root query, viewer,
SDL export) lives in `complete_graph` — see `../complete_graph/AGENTS.md` for
the schema conventions (presence-of-`id` normalized-cache rules and the
viewer pattern), which apply to every type defined here.

## Gotchas

- `PROJECT` grouping forwards the Project property (initiative membership) to Soup; legacy folder IDs are not grouping keys.

- `SoupItemLoader` (single-entity lookups, `soupUpdates` hydration) resolves
  email threads through entity-access view receipts, the rule the REST thread
  route applies, not through the viewer's inbox scope; Soup's email leg only
  serves lists. A thread shared through a team's CRM, a project, or a share
  therefore opens through `emailThread` even though it lives in a teammate's
  inbox.
- Initiatives and agent sessions also hydrate through view receipts
  (`SoupViewAuthorizer`, then `SoupService::get_viewable_items`), never through
  Soup's listing policy, which deliberately leaves out public links. Its key's
  viewer is optional: a caller with no account reads exactly these types, and
  nothing that needs an inbox or a listing. To open another type to links,
  add it to `hydrates_through_receipts` and to Soup's viewable hydration.
  Documents hydrate through the listing first; only a document the listing
  leaves out (a link-shared file) gets a per-item view check, so realtime
  patches, which go to a document's own grantees, rarely pay for one.
  A project's `tasks` list through `SoupItemDataLoader::hydrate_project_tasks`:
  the project's View receipt authorizes listing every task in it, with no
  per-task check, and opening a task still checks the task.
- Property grouping accepts optional `groupBy.bucketing` with `type: DATE_RANGES`,
  caller-defined half-open UTC `ranges`, and `missingValueBucketKey`; client query
  keys restart pagination when ranges change.
- Use `PROPERTY`, `sortPropertyDefinitionId`, and `sortDirection` for numeric property sorting through ordinary Soup requests; preserve timestamp cursor decoding.
- Property sorts and date-range groups use source-owned item access gates without a separate property-definition check; validate ranges during input conversion.
- Build `groupSoup` through Soup's shared `build_grouped_response`; keep `document_server_facts` in `GroupedSoup::from_response` for cache projections.
- `NOTIFIED_AT` maps to Soup's notified request, not a simple sort: `soup`
  accepts it descending only and `groupSoup` rejects it. Its continuation
  cursors carry their own sort tag and string identifiers, separate from timestamp and selected-property cursors.
- External chats are intentionally excluded from Soup hydration; use the `/external-chats` API.
