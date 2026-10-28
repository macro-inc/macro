# Search

## Search

Sidebar `Search` button → `/app/search` with a focused query box. Results
(including a `Featured Results` group) filter live as you type; no Enter needed. `Ctrl+K` is
usually faster for jump-to-entity; `/` opens workspace search when no editor is focused.

On touch devices, the dock's **Search** button opens a persistent **Search…**
input in `/app/search`. It starts in **All** with Command Menu-style Quick Access
name search. Categories are **All, Email, Agents, Files, Tasks, Projects, Channels,
People** in a horizontal pill row at the top, below the status-bar safe area;
the query input stays in the bottom dock. Each filter row reads and updates its
own Search history entry, including while another entry is in front. Projects respects its feature flag.
Categories filter entities directly,
independently of view tabs, mailbox selections, and saved facets. Commands and
creation shortcuts are excluded. Empty queries show recent entities.
Typed **All** and **People** name searches also find known teammates before their
first DM, with or without CRM. Existing one-to-one DMs replace person rows while
preserving name/email matches; selecting a person opens their DM. Verify both
categories with a teammate who has no conversation or CRM record.
On phones, name-result icons and avatars are scaled to 150% (16px artwork
becomes 24px), preserving row height and text alignment.

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
the keyboard without ending search. Opening a result hides search chrome while
preserving that Search history entry's query, category, mode, result order, and
scroll position. Opening a result does not promote it within that saved list,
even when its last-viewed time changes. Swiping back, pressing the native Back control, or using browser Back
returns to those results without focusing the input or reopening the keyboard.
Name-result ordering and scroll anchors identify a one-to-one DM by its other
participant, so a person keeps their place when opening them creates a conversation
with a new channel ID. Group conversations keep their own channel identity.
Native Search captures lightweight state when covered so deeper navigation can
unmount it. History saves the query/category/mode, an account-scoped item ID and
offset within that row, a fallback pixel offset, and at most 200 ordering IDs per
mode. It never stores result row objects or virtualizer measurement caches.
A remount reads current source data; it may show loading while those rows are
unavailable. Restoration waits for layout and fetches at most three additional
pages to find the anchor. Missing anchors, exhausted/no-progress pagination, or
the page limit use the available scroll range instead. Touch, pointer, or wheel
interaction cancels pending restoration so later pages cannot move the user.
Automatic viewport paging stays paused after recovery until the user interacts
or changes the query/category.
Matching current rows follow the bounded saved order; absent rows are not revived
from history. The live source owns result data and its cache lifetime. Leaving
Search through native dock navigation disposes its result view while lightweight
entries may remain reachable through history. Starting a new dock Search supplies
a fresh route session ID and computes a fresh order.
Snapshots are released when their history entry is removed/replaced or its pane
closes. Account changes recreate result sources/scrollers and cannot restore
another account's anchor or ordering. A failed or empty source cannot revive rows
from a historical snapshot. A later search
cannot overwrite an earlier entry. **Close search** ends the
session; opening Search from the dock starts in All/name mode. Mobile search state
does not modify desktop search state. The dock search row has no Ask AI button.
If a person’s conversation lookup fails, search stays open with its query and
category intact so the result can be retried.

Verify sender-only `teo` matches with one- and two-character prefixes, then switch
categories with the keyboard up. In both name and full-text modes, scroll several
pages, open a result/snippet, and go Back: check the query, category, mode, visible
rows, and scroll position. Repeat Back/Forward and native swipe/Back; the keyboard
stays dismissed on return. Open Search from the dock and check All/name reset,
then revisit the earlier history entry and confirm its query is intact.
Open a result from midway through the list and confirm it keeps its original
position after Back, both when Search stays mounted and after deeper navigation
evicts it. Refresh row metadata and append pages; existing rows must keep their order.
Include a person without a DM: open them from midway through All/People results,
then go Back and confirm that person's new DM is still in the same place and opens
the existing conversation on a second selection. Repeat with the DM arriving after
Search unmounts, and verify group DMs stay separate.
Switch accounts with a scrolled Search entry still mounted, then remount that
entry: neither path should retain the previous account's rows or scroll offset.
Repeat with a slow refresh: a remount waits for current rows rather than showing
saved row objects. Use an anchor on a later page and confirm restoration waits
for that page and responsive layout. Remove the anchor or keep it beyond three
additional pages and verify recovery stops at the available position. While
recovery is pending, scroll manually and confirm later pages do not move the
viewport. In full-text mode, repeat Back from a deep list and check the same row
returns to the same position when it is available within the recovery limit.
Inspect captured Search entry state: it contains bounded IDs and scalar state,
with no row objects, snippets, or virtualizer caches. Switch dock views repeatedly
and confirm old source rows can be collected even while lightweight history remains.
Clear with whitespace and check category
retention; select Projects from full-text mode and confirm it shows name results.
Repeat opening with a large recent list: results are virtualized, so transferring
keyboard focus should not mount every cached row. Scroll through later results
to the end to verify additional pages load automatically without a fixed Load more bar.
Search results start below the floating category row, with the same clearance on
phones and tablets. Check both name and full-text results with the keyboard open
and dismissed; categories stay at the top while the input stays above the keyboard. Same-query full-text refreshes keep the current rows visible
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
