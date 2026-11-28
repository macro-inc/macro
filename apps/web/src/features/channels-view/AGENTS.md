# Chat view

## What it is

Chat's desktop sidebar, mobile conversation lists, section membership, and routed conversation detail.

## Start here

- `queries.ts` owns the bounded list sources; `channels-view.tsx` composes the shared local channel pool and views.
- `components/rail/ChannelsRail.tsx` composes section membership, favorites, and the on-screen reference window.
- `queries/channel-list-search-pool.ts` adapts the joined channels of the channel directory (`useChannelDirectory`, `lib/queries/channel/directory.ts`) for initial display, search, and mobile pins.

## Data and loading

- Seed sections from the channel directory only until the corresponding Soup source answers; an empty Soup page replaces the seed.
- Resolve whole-membership actions (built-in section mute, snooze and read, section ids, scope checks) through `directory.readComplete(signal)`, aborted when the surface goes or the viewer signs in again, or wait for `directory.complete()`: a filling directory holds only some channels.
- Bound each seeded section to the normal first-page size and preserve membership and sorting; recreate the query graph and reference batches on account-session changes, including same-viewer reauthentication, without rebuilding for sort, cache, or tab changes.
- Keep Soup's bounded unread projection and live updates authoritative; do not replace them with a full-list fetch.
- Filter Unread only and collapsed sections by `unreadOrMentionedChannelIds`, so every channel that lights Chat's dot in the app rail stays listed; the row's unread dot and section counts stay on `unreadChannelIds`.
- Fetch section and favorite members by ID only for the rows on screen in open sections (`reportSectionRange`), through one `useChannelWindow` (`lib/queries/channel/window.ts`: 200 IDs in at most 16 chunks), each open section's next discovery batch first; other rows show the directory pool’s record. A collapsed or scrolled-away section fetches nothing. The original rail (sidebar sections off) renders open favorites whole and looks them up, and looks up an open label's members only while one of its rows is on screen in an open Team channels section (its list reports `team_channels`). Never resolve a whole membership by ID.
- Unread state comes from `useCollapsedUnreadChannels`: the 100 newest unread channels, and further pages only while a section on screen (`reportSectionOnScreen`, Browse tab, no search) lists each unread member: a collapsed section showing its unread rows, or a favorites or custom section filtered to Unread only. The pages read stay while a section on show lists them, but live updates read them again only while one is on screen (otherwise the first page alone); each kept page that has missed live updates for 30 s (since the section left, or since the page landed while it was away) is read again while one is on screen, in the refresh queue's turn (`laterPages` of `registerChannelListNotificationRefresh`, the queue's `readAgain`), and a page the queue drops because the section left keeps its deadline. While one is on screen, a later page whose saved cursor no longer follows the page before it (a newer unread channel pushed a row across the boundary, which the saved cursor would skip) is read again from the cursor that does, keeping its rows until the new read lands (`graphqlRepairContinuations`, the infinite query's `repairContinuations`); once none on show lists them, the later pages are dropped (`resetToInitialPage`), so live updates revalidate the first page alone. Section count pills read that first page, so beyond 100 unread they are a lower bound.
- An open section discovers members no source holds once the directory has settled and its loading row is on screen, with a cursor that only moves forward (`core/member-discovery.ts`): the next 25 at a time, pausing for Load more after 100 misses, and starting over when a closed section opens; the records it found stay in the rows while the section is open (`keepDiscoveredRecords`), even after the window forgets them, until a settled lookup no longer returns them. Phone section tabs do the same from the list's rows on screen (`onRowsOnScreen` on `ChannelsMobileView`, which an empty list reports too), with Load more under the list (`onLoadMore`). An Unread only section discovers nothing: the unread projection lists its rows.
- A Direct messages or team section's notification conflict check reads the joined channels whole (`readJoinedChannels`) only when a channel whose own settings resist the change (`ownSettingsResist`) has no record and is in no custom section: those sections hold channels by type, and the conflict lookup is windowed too.
- Render favorite metadata without extra skeleton rows; an unread filter can legitimately leave no rows after enrichment.
- Keep failed referenced lookups retryable and omit successfully unavailable channel favorites from the rail without deleting saved favorites.
- Require a cached or fetched Soup page before treating missing reference IDs as unavailable; an empty offline index proves nothing.
- Keep `channels.sidebar.*.render`, `channels.sidebar.references`, and Soup cache/network phases under the routed flow.

## Checks

From `apps/web`:

- `bun run test src/features/channels-view src/lib/queries/channel src/lib/queries/soup/graphql/items.test.ts`
- `bun run check`

Run repository `just check` before committing and `just check full` before pushing.
Leave browser verification to the user when requested.
