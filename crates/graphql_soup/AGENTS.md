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
- Initiatives and agent sessions also hydrate through view receipts
  (`SoupViewAuthorizer`, then `SoupService::get_viewable_items`), never through
  Soup's listing policy, which deliberately leaves out public links. Its key's
  viewer is optional: a caller with no account reads exactly these types, and
  nothing that needs an inbox or a listing. To open another type to links,
  add it to `hydrates_through_receipts` and to Soup's viewable hydration.
- `NOTIFIED_AT` maps to Soup's notified request, not a simple sort: `soup`
  accepts it descending only and `groupSoup` rejects it. Its continuation
  cursors carry a different sort tag, so `inputs.rs` decodes both cursor shapes.
