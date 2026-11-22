# graphql_soup

## What it is

Backs the Soup feature (the app's unified entity search/home surface): the
soup-domain GraphQL wrapper types. The composed schema (root query, viewer,
SDL export) lives in `complete_graph` — see `../complete_graph/AGENTS.md` for
the schema conventions (presence-of-`id` normalized-cache rules and the
viewer pattern), which apply to every type defined here.

## Gotchas

- `PROJECT` grouping forwards the Project property (initiative membership) to Soup; legacy folder IDs are not grouping keys.
- Document and initiative `appearance` fields carry entity-owned JSON overrides; the shared Soup reads supply them without changing sort timestamps.

- `SoupItemLoader` (single-entity lookups, `soupUpdates` hydration) resolves
  email threads through entity-access view receipts, the rule the REST thread
  route applies, not through the viewer's inbox scope; Soup's email leg only
  serves lists. A thread shared through a team's CRM, a project, or a share
  therefore opens through `emailThread` even though it lives in a teammate's
  inbox. Spam-only and trash-only threads render as their folder rows; the
  mutation reply reader (`mutation_thread.rs`) reads through the same rule
  with the email service's ownership check.
- `SoupItemLoader` reads channels by id with a filter that mentions
  `isParticipant` both ways (`channel_tree`), so a by-id read returns every
  named channel the viewer can open, a public or team channel they never
  joined included, as the REST channel read does; `isParticipant` on the
  record says which. Joined-only lists must still filter on it.
- `resolve_soup` runs a page with `channelReads: PRIMARY` on the
  `PrimaryChannelSoup` in the request data and errors when it is missing,
  never falling back to the replica service. It admits only channel directory
  pages (`SoupRequest::is_channel_directory_page`: a timestamp sort, newest
  first, at most 100 items, channel threads excluded, no `favoritesOnly: true`
  and no CRM association of any kind (company, contact or activity), whether
  `crmAssociation` or a `crmAssociated` literal anywhere in the document
  filter (Soup resolves each record after the check, reading a company's or
  contact's references through the channel repository; it rewrites a
  document literal into the record's document ids, and `crmAssociation` also
  restricts every source, channels included, to the record's entities; a CRM
  email scope stays allowed), and no channel
  filter or one admitting only channels it names by id, at most 100 id
  literals with nothing beside them but at most two `isParticipant` literals
  in the whole tree) and refuses the rest,
  so the primary query stays bounded by the request. `soup.page` records
  `outcome`, never error text: errors carry submitted filter values. Type the data by
  the schema's service, `PrimaryChannelSoup<<Schema as SoupSchemaService>::Service>`
  (`Arc<_>` in a shared schema), or the lookup misses. The cursor does not
  carry the choice; continuations send it again.
- Build `AgentSessionEntityLoader` and `PrimarySoupItemLoader` with `::new`,
  which rechecks the viewer's team. PRs are stored for the team; without it,
  a session row reads `pullRequestState: null` and overwrites the list's
  state in the client cache.
- Property grouping accepts optional `groupBy.bucketing` with `type: DATE_RANGES`,
  caller-defined half-open UTC `ranges`, and `missingValueBucketKey`; client query
  keys restart pagination when ranges change.
- Use `PROPERTY`, `sortPropertyDefinitionId`, and `sortDirection` for numeric property sorting through ordinary Soup requests; preserve timestamp cursor decoding.
- `NAME` orders by each item's own name and takes no property definition; it shares the selected-sort cursor, so its continuations decode as property positions.
- Property sorts and date-range groups use source-owned item access gates without a separate property-definition check; validate ranges during input conversion.
- Build `groupSoup` through Soup's shared `build_grouped_response`; keep `document_server_facts` in `GroupedSoup::from_response` for cache projections.
- `NOTIFIED_AT` maps to Soup's notified request, not a simple sort: `soup`
  accepts it descending only and `groupSoup` rejects it. Its continuation
  cursors carry their own sort tag and string identifiers, separate from timestamp and selected-property cursors.
  Each item's notification time is `SoupPage.notifiedAt`, a per-page list
  keyed by type name and id, never an entity field: it orders this list and
  other lists share the records. Selecting it on a notified page takes the
  enriched Soup read (as `frecencyScore` does); other sorts keep the plain
  read and return an empty list, since the shared `Soup` document always
  selects it.
- External chats are intentionally excluded from Soup hydration; use the `/external-chats` API.
- `SoupPatch::hydrate_updated` omits kinds without a `GraphqlSoupEntityType` (databases, forms, external chats), so a committed mutation on them returns empty effects, not a GraphQL error.
