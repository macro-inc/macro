# Chat view

## What it is

Chat's desktop sidebar, mobile conversation lists, section membership, and routed conversation detail.

## Start here

- `queries.ts` owns the bounded list sources; `channels-view.tsx` composes the shared local channel pool and views.
- `components/rail/ChannelsRail.tsx` composes section membership, favorites, and referenced-channel hydration.
- `queries/channel-list-search-pool.ts` adapts the existing account-scoped channel list for initial display, search, and mobile pins.

## Data and loading

- Use the existing persisted channel list only until the corresponding Soup source answers; an empty Soup page replaces the seed.
- Bound each seeded section to the normal first-page size and preserve membership and sorting; recreate the query graph and reference batches on account-session changes, including same-viewer reauthentication, without rebuilding for sort, cache, or tab changes.
- Keep Soup's bounded unread projection and live updates authoritative; do not replace them with a full-list fetch.
- Hydrate only referenced channels missing from the loaded sources.
- Load each sidebar list in bounded requests, never from an effect that calls `fetchNextPage`: `useCachedChannelsByIds` asks for exact IDs in batches that cannot paginate, and the collapsed-unread and Threads lists read one page of at most 500 rows. Only scrolling loads a continuation page.
- Render favorite metadata without extra skeleton rows; an unread filter can legitimately leave no rows after enrichment.
- Keep failed referenced lookups retryable and omit successfully unavailable channel favorites from the rail without deleting saved favorites.
- Require a cached or fetched Soup page before treating missing reference IDs as unavailable; an empty offline index proves nothing.
- Keep `channels.sidebar.*.render`, `channels.sidebar.references`, and Soup cache/network phases under the routed flow. `traceChannelListLoad` records each bounded list's `cache_hit`, `rows`, `pages`, `requests`, and `failed` there.

## Checks

From `apps/web`:

- `bun run test src/features/channels-view src/lib/queries/channel src/lib/queries/soup/graphql/items.test.ts`; `queries/channel-list-requests.test.tsx` counts the requests each list makes over the real Soup query.
- `bun run check`

Run repository `just check` before committing and `just check full` before pushing.
Leave browser verification to the user when requested.
