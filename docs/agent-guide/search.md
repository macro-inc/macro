# Search

## Search

Sidebar `Search` button → `/app/search` with a focused query box. Results
(including a `Featured Results` group) filter live as you type; no Enter needed. `Ctrl+K` is
usually faster for jump-to-entity; `/` opens workspace search when no editor is focused.

On touch devices, the dock's **Search** button opens a persistent input. Type a
query, then switch the scope pills between **All**, **Notifications**, **Email**,
**Channels**, **Files**, **Agents**, and **Tasks**. The selected view searches with
the same query and retains its tab/facet restrictions. Channels searches
conversation names. Clearing the
input restores the current scope's unsearched list; **Close search** ends the
session. Switching scopes keeps the input mounted and focused. The dock query is
not saved into the view's desktop search or restored entry state. Home and
top-level Tasks use this same overlay; embedded project task lists retain their
own search while the dock is open.

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
