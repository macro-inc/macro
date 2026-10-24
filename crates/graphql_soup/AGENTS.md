# graphql_soup

## What it is

Backs the Soup feature (the app's unified entity search/home surface): the
soup-domain GraphQL wrapper types. The composed schema (root query, viewer,
SDL export) lives in `complete_graph` — see `../complete_graph/AGENTS.md` for
the schema conventions (presence-of-`id` normalized-cache rules and the
viewer pattern), which apply to every type defined here.

## Gotchas

- `SoupItemLoader` (single-entity lookups, `soupUpdates` hydration) resolves
  email threads through entity-access view receipts, the rule the REST thread
  route applies, not through the viewer's inbox scope; Soup's email leg only
  serves lists. A thread shared through a team's CRM, a project, or a share
  therefore opens through `emailThread` even though it lives in a teammate's
  inbox.
- Deadline grouping accepts viewer-local UTC boundaries in
  `groupBy.deadlineBoundaries` (`today`, `tomorrow`, `dayTwo`, `dayEight`);
  retain those exact boundaries when continuing a bin instead of recomputing them.
- Keep nullable task due-date cursors distinct from legacy timestamp cursors;
  `GraphqlSimpleSortMethod` retains its deployed name and includes due-date sorts.
- `NOTIFIED_AT` maps to Soup's notified request, not a simple sort: `soup`
  accepts it descending only and `groupSoup` rejects it. Its continuation
  cursors carry their own sort tag and string identifiers, separate from timestamp and due-date cursors.
