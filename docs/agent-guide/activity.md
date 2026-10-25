# Activity

## Activity — `/app/component/activity`

To verify document content activity, keep Activity open in one tab and edit an
existing document's body in another, without renaming it. The editor's Edited
entry should arrive for the first edit. Keep typing across multiple saves: the
activity count must stay unchanged. After five minutes without editing, the next
edit should add one new event. Reconnecting within that window and opening or
closing a document without edits must not add an event.

Requires authentication and the `enable-activity-feed` flag. Direct navigation and
restored splits wait for flags to load; when disabled, they redirect to Home
(`/app/home`) without loading the activity feed.

Open it from **More → Activity** in the sidebar rail (or `g y`); Customize sidebar
can pin it to the rail.

The header has **You** and **Team** tabs (view tabs after the title on desktop,
a pill strip above the list on touch); the choice is stored in the split's URL as
`sN.activity.scope=team` and survives reloads. You is the user's own feed. Team
lists teammates' activity, newest first, on items shared with the user directly
or through a project, team, or channel, on channels the user is in, and on
threads in the user's own inbox (a link share alone does not count; forms never
appear), with each row naming the teammate. Team has no heatmap or Most active
section. Each server page reads a bounded slice of the team's history, so a page
can add few rows or none; the list keeps showing `Loading…` and paging on its own
until rows arrive or the history ends, and only then reads `No activity from your
team yet.` (also when the user is not on a team). Switching tabs opens the other feed at
the top; switching back shows the pages already loaded. Team needs a backend that
accepts `scope: TEAM` on `user.activity`; against an older one only that tab
fails, with the feed's unavailable copy.

When checking Activity, enable GraphQL Soup as well as the activity flag. Verify
that an initial visit resolves entity names in both the feed and Most active,
then reload and scroll through another page. Preview loading and live name
updates should keep the page responsive without repeatedly fetching previews.

Activity refreshes live after recorded actions. With two pages loaded, make an
action in another tab and verify the feed retains its page-boundary rows while
the action count and heatmap update. An open entity activity panel should also
refresh for actions by another authorized user. After disconnecting and
reconnecting the websocket, verify recovery without requiring another action.
Hidden tabs defer refresh until visible; purges refresh all mounted activity
queries through the normal access checks.

GitHub-style actions heatmap (one a11y node per day — makes snapshots huge; prefer saving the
snapshot to a file), then a `Most active` section header (styled like the feed's day headers)
over a wrapping row of pill chips (entity icon, name, action count; click opens the entity,
shift-click opens a new split; the section is absent when there are no entities), then a feed
of "You edited/created X · 17h" entries grouped under day headers, with the compact relative
time (`17h`, `8d`, `1mo`) inline after a middot rather than right-aligned; hovering the time
shows the full date. Each row is a plain action glyph joined to its neighbours by a thin
connector line (the line stops at day headers) and never wraps: a long entity name truncates
with an ellipsis, and the full name is in the mention's hover preview. Consecutive same-actor,
same-entity, same-action events within a day read as one line with a count (`You edited Doc X
5 times · 2h`; property changes read the net change, `changed Status from A to C on Doc X · 3
changes · 2h`), so the row count is lower than the event count (`[data-activity-run-size]`
carries the fold size). The whole page is one virtualized list: only rows near the viewport
are in the DOM, and scrolling near the bottom fetches the next page automatically (a
`Loading…` tail appears while it lands). If a page fails, the tail reads `Couldn't load more.`
with a `Retry` button and automatic paging stops until it is pressed. There is no `Show more`
button.
Once the heatmap card scrolls away, the day header for the topmost visible row stays pinned at
the top of the list (`[data-activity-pinned-day]`, a non-interactive copy), so a snapshot taken
mid-scroll shows that label twice at most. The heatmap always shows the whole year, including
the partial first and current weeks, and spans the card at every width: in a wide pane the
space between week columns opens up, its cells shrink from 14px to 8px as the pane narrows, and
below that (a phone) the week area scrolls sideways with the month letters, opened on the newest
week and with no visible scrollbar. Under ~672px the four stats read as a two-column grid; under
~448px (a phone) the legend drops its `Fewer`/`More` words, each stat stacks its label over its
value, and chips shorten. Rows stay on one line at every width. On touch devices the list rests
below the floating page title and above the bottom toolbar.

With Databases on, databases are activity entities too: creating, renaming, trashing,
restoring, or permanently deleting one, and every write to its tables (grid edits and
agent tools) lands on the acting user's feed as `You created/edited/deleted <database>`;
the mention opens the database. Databases also appear in the Ctrl+K command menu under
**All** and **Files**, ordered by creation time. Home's merged feed and the Recent view read Soup, which
does not list databases.
