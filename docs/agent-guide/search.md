# Search

## Search

Sidebar `Search` button → `/app/search` with a focused query box. Results
(including a `Featured Results` group) filter live as you type; no Enter needed. `Ctrl+K` is
usually faster for jump-to-entity; `/` opens workspace search when no editor is focused.

On touch devices, the dock's **Search** button opens a persistent **Search…**
input in `/app/search`. It starts in **All** with Command Menu-style Quick Access
name search. Categories are **All, Email, Agents, Files, Tasks, Projects, Channels,
People**; Projects respects its feature flag. Categories filter entities directly,
independently of view tabs, mailbox selections, and saved facets. Commands and
creation shortcuts are excluded. Empty queries show recent entities.

For a nonempty query, **Search full text for “…”** appears above name results,
including when there are no matches. It retains the query and category and stays
in full-text mode while editing or switching categories. Clearing the query,
including whitespace-only input, returns to name search and retains the category.
Projects is always name-only: selecting it returns to name results and omits the
full-text action. People full-text search uses the existing channel-content scope.
Name mode makes no full-text requests; explicit full-text mode retains the search
service's validation for short queries.

Email Quick Access searches cached thread subjects, sender display names, and
sender addresses, including the thread's earlier senders after someone else
replies. It returns one row per thread and never matches only a snippet or body.
Coverage is existing cached mail: automatic backfill includes 90 days of signal
mail and 30 days of noise mail, plus other cached threads. Use full-text search
for uncached older mail. No new backfill or server name-search fallback is added.
Email name results require the existing normalized GraphQL cache rollout. When
verifying a local iOS build without PostHog configuration, enable that path with
the build-time `VITE_ENABLE_GRAPHQL_SOUP=true` override; see the
[cache guide](../../apps/web/docs/graphql-normalized-cache-plan.md#cached-email-quick-access).

Category/mode changes keep the same input mounted and focused. Enter dismisses
the keyboard without ending search. Opening a result or **Close search** ends the
session; reopening starts in All/name mode. Mobile query/category state is transient
and does not modify desktop search state. The dock search row has no Ask AI button.
If a person’s conversation lookup fails, search stays open with its query and
category intact so the result can be retried.

Verify sender-only `teo` matches with one- and two-character prefixes, then switch
categories with the keyboard up. Select full text, edit the query, open a snippet,
reopen search, and check All/name reset. Clear with whitespace and check category
retention; select Projects from full-text mode and confirm it shows name results.
Repeat opening with a large recent list: results are virtualized, so transferring
keyboard focus should not mount every cached row. Scroll through later results
to the end to verify additional pages load automatically without a fixed Load more bar.
Search starts below the status-bar safe area without reserving space for the
hidden view/filter header; check both name and full-text results with the keyboard
open and dismissed. Same-query full-text refreshes keep the current rows visible
so paging does not collapse the list and reset its scroll position. Appending a
page preserves existing row elements, including when the service rematerializes
their data; scroll through multiple pages to check that the position stays put.

Search snippets carry their target in the destination pane's route search. Channel
messages open Chat at the message (replies open their parent thread); email snippets
open the matching message, Markdown snippets the matching node, PDFs the matching
page and highlighted text, agent snippets the matching turn/author, and call
snippets the matching transcript segment. Plain rows keep their existing behavior:
email rows open normally, while agent and call content results use their first hit.

Verify both a cold open and a result whose entity is already open in another pane,
including a Home or Drive detail: reuse keeps that pane's workspace and filters,
leaves the search pane intact, and scrolls to the target. Scroll away and click the
same snippet again to verify it re-targets. Repeat with Shift-click and Cmd/Ctrl-click
(new split and new browser tab), and check Back/Forward restores the earlier target.
Channel checks should include an older offscreen message, a reply, and then a root
message to ensure the previous thread target is cleared.
For a PDF that is still loading, clear its route target before pages become visible.
The old search hit must not apply afterward, and its normal initial position should
still restore if no target has been applied. A newer mention or preview target must
survive that cleanup and still open when the viewer is ready.

Agent-session results use the robot icon and show a highlighted transcript snippet.
`Show more [N]` expands additional matches, labeled **User / Agent · Turn N**.
Click a snippet to open `/app/agent/<uuid>` at that folded message; a plain row click
opens the first content match, or opens the session normally for a title-only hit. These are
ACP-backed sessions, distinct from legacy chat results. Legacy chat rename, delete,
copy, and move-to-folder actions are not offered on agent-session search rows.
