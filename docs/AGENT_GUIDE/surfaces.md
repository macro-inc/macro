# Other Surfaces

## Live updates in flat Soup lists

With browser GraphQL caching enabled, locally supported flat lists reconcile their
loaded server pages with matching cached entities. Complete matching updates can
appear without a list refetch; confirmed non-matches and explicit deletions disappear.
Rows whose current predicate facts are unknown retain their previous server membership
and sort evidence until hydration or a network refresh resolves them. Unrelated
notification-only cache records do not block other rows' updates.

This is a best-effort display, not proof that every matching entity is cached. Loading
more still follows the original server cursors and preserves already loaded pages.
Changing filters or resetting the cache discards prior reconciliation evidence. Grouped
lists, unsupported filters/sorts, and native/non-cache transports keep their existing
network behavior.

## Inbox — `/app/component/inbox`

Unified triage list (emails, channel messages, task assignments, doc mentions, agent
results). Filter radios: `Signal` (default, AI-filtered "needs attention") / `Noise` / `All`
/ `Reminders`; plus `Filter` menu and `Preview` toggle (split list + preview pane; the empty
preview shows "No content selected"). With the `enable-inbox-notified-sort` flag on, `Signal`
and `Noise` order rows (and their date headers) by when you were last notified about the
item, so a fresh comment on an old task sits under "Today"; with it off they order by
recency like `All` and `Reminders`. Keyboard: `j`/`k` move, `space` preview, `enter` open, `e` mark done.
Rows are buttons named `<channel> <sender>:<snippet> <time>`.

## Email — `/app/component/mail`

With new app views enabled on desktop, Email has an inner sidebar. Its inbox
dropdown (`Choose inbox: …`) selects All inboxes or one connected account.
Mailbox navigation filters the main email list: Signal and Noise under Inbox;
Drafts, Sent, and All mail under Mail; Calendar and Shared with me under Views.
Account selection combines with mailbox filters and uses the existing filter
persistence preference.
Use Compose in the sidebar, and Search mail, Sort, and Filter above the list.
The sidebar uses the same panel surface, neutral selected rows, and aligned
header divider as Chat. Touch devices retain the original top tabs.

Compose is also available via `Create` → `Email E`. On a fresh local user it
shows `Connect your email` (Gmail/Google Workspace OAuth) — most functionality needs a
connected account. Search is `Ctrl+F` within the surface.

## Search

Sidebar `Search` button → `/app/.../component/search` with a focused query box. Results
(including a `Featured Results` group) filter live as you type; no Enter needed. `Ctrl+K` is
usually faster for jump-to-entity; `/` opens workspace search when no editor is focused.

## Files — `/app/component/documents`

Tabs `Owned` / `Shared` / `Attachments` / `Folders` / `All`; `New` menu; rows show title,
tags, updated time. Clicking a row opens the doc.

## Calendar — `/app/calendar/view`

Week view with `New event`, `Choose calendar view` menu, prev/next week, `Search events`,
`Calendar settings`, and a mini month picker in the side panel. Events require connecting a
Google account (`Connect calendar`). The `Calendar settings` (gear) menu has an `Accounts`
section listing each connected account with a per-account `Enable` (grant calendar) or
`Turn off` action, plus `Connect another account` to connect a new Google account
(email + calendar).

The side panel's `Calendars` section folds each connected account into a collapsible
group: a caret plus the account address header with a checkbox that shows or hides all of
that account's calendars at once, and the account's calendars listed beneath it (color dot,
name, per-calendar checkbox). Subscribed system calendars (Google holidays, birthdays)
carry a small RSS icon.

The `New event` composer (also opened by dragging a range on the grid) has an `Event kind`
pill choosing between `Event` and `Out of office`. Picking `Out of office` hides the guests,
conferencing, and location pills and the description field (Google rejects them on this
type), forces a timed (not all-day) range, restricts the calendar
pill to primary calendars, and shows a `Decline meetings` pill (`Don't decline meetings` /
`Decline new meetings` / `Decline all meetings`) plus, when declining, an optional
`Decline message` pill; a warning note discloses the away/auto-decline effect before saving.
When editing an existing event the kind is read-only (Google treats it as immutable), and an
out-of-office event's decline settings can still be changed — they read as unset because the
provider does not report the stored ones. Out-of-office events render on the grid as solid
chips filled with their calendar color (like Google), unlike regular events' outlined chips,
and their details card shows an `Out of office` line under the schedule.
An event that Google carries on several of an account's calendars (a shared calendar's
re-import of a member's own event, for example) renders as one chip, not one per calendar:
the chip carries one thin color bar on its left edge per shown calendar the event is on
(the details popover's color square splits the same way), and shows the title, color, and
editability of the first shown copy in primary-first order — hiding the primary calendar
switches the chip to the shared copy, hiding every one of its calendars hides the chip.
Reminders, guests, and conferencing always show and follow the primary copy, since that is
the copy Macro's alerts fire from and whose guest list and join link Macro records, and the
editor only lets them be changed there. Answering an invitation likewise addresses the
primary copy. The details popover and the editor act on the displayed copy, so editing or
deleting it targets that calendar's event at Google.

With the `enable-calendar-team-ooo` flag on, teammates' Google Calendar out-of-office events
overlay the grid as read-only chips titled `<name>: <event title>`. The side panel's
`Team out of office` section (shown only when the user belongs to a team with other members)
has a checkbox in its header row toggling the whole overlay on or off — all teammates or
none — and lists the next 90 days of teammate absences; clicking a row navigates the grid to
that date. Coverage depends on each teammate having connected their own calendar and using
Google's out-of-office event type.

## Calls — `/app/component/calls`

Tabs `All` / `Missed` / `Unattended`; `Call` button to start one. Recordings, transcriptions
and summaries appear here; empty state notes "Calls are available to agents."
New recordings stage a shared screen with cameras in a side strip. Older
recordings stay an equal-tile grid.

## Customers (CRM) — `/app/component/companies`

Board/List views, `Company` create button. Requires a team ("Join a team to enable CRM" →
`Open team settings`).

## Activity — `/app/component/activity`

GitHub-style actions heatmap (one a11y node per day — makes snapshots huge; prefer saving the
snapshot to a file), then a `Most active` section header (styled like the feed's day headers)
over a wrapping row of pill chips (entity icon, name, action count; click opens the entity,
shift-click opens a new split; the section is absent when there are no entities), then a feed
of "You edited/created X" entries.

## Home — `/app/component/home`

Greeting, getting-started checklist, example prompt buttons (`Draft a document`,
`Draft an email`, `Search & research`), and the ubiquitous `Ask AI` composer.

## Settings — `/app/settings/<section>`

Left nav: General → `Account` (profile, delete account), `API Keys` (create /
list / delete personal keys; the secret is shown only once and is sent as
`x-macro-user-api-key`), `Notifications`, `Billing`,
`Appearance`, `Mobile App`, `Shortcuts` (interactive keyboard visualization, not a list);
Workspace → `Team`, `Tags`, `CRM`, `Connections` (email/tool OAuth), `MCP server`
(setup snippets for Claude Code / Codex CLI / Claude.ai / ChatGPT / IDE), `Agents`, `Bots`;
`Log out`.
`Agents` lists team and private agents with `Create agent` / `Edit <name>` nested editors grouped
Profile, Behavior, Runtime, Connections, Channels, Share. Connections is a radio pair:
`Use my connected apps` (default; the agent gets whatever the person running it has
connected) or `Specific apps`, which reveals a `Search connectors` box over the whole
Pipedream catalog (results are `option` rows; picking one adds it) and a row per picked app
with a connected / not-connected dot for the *current viewer* plus an inline `Connect`
that opens the Pipedream Connect flow inside the editor. Unconnected picks never block
saving; each teammate connects their own account. An agent session that calls a picked
but unconnected app gets a tool result saying so, and the agent's reply renders a
`Connect <app>` chip that opens Settings → Connections for that app.
API Keys, Bots, Agents, MCP server, and Harness share wide centered management pages,
subtle bordered cards, and consistent headings/actions. Search keys/bots/agents filters
loaded records. Create/edit, key and bot deletion confirmation, new bot webhook tokens,
Cursor configuration, and harness pairing use nested in-pane pages with parent/back
buttons, not modal overlays. The settings URL continues to identify the active tab;
use the in-page Back control to return from an editor. API keys and bot tokens remain
visible only in their creation result; copy them before leaving. Harness pairing
still accepts the `pair` query parameter and requires explicit approval. MCP server
lists clients; selecting one opens its setup instructions and copyable configuration.
These settings manage real data, unlike the Agents workspace design previews.
`Back to app` returns to the previous surface. Open via user-email button menu or `Ctrl+;`.

## Notifications

Toast regions are labeled `Notifications (alt+T)`; five empty live regions always exist in
the a11y tree (ignore them when parsing snapshots).

Email workspace refinements: the toolbar contains Sort and Filter. Tags appear as label-style rows in the inner sidebar, with their existing colors. Selecting a tag shows matching messages across All mail within the selected inbox; selecting it again clears the tag. Choosing a mailbox also clears the label filter. Read email rows are slightly dimmed.

Email sidebar sections Mail, Views, and Tags start expanded and toggle via their section-heading buttons (`aria-expanded`). Collapsing a section does not change the selected mailbox or tag. Inbox stays expanded.

The + button beside the Email sidebar Tags heading opens the shared Create tag dialog (name, color, and personal/team scope when available). It remains accessible when Tags is collapsed or empty. Saving refreshes the sidebar through the existing tags query.

Favorites are scoped to each app view: Email threads, Chat channels/messages, Tasks task documents, Files non-task documents, Agents chats/sessions, and the corresponding types for other lists. Inbox does not show a Favorites section. Email places Favorites below Views; Chat above Channels in All only (hidden in Recent); Tasks beneath its navigation. Other list views use a favorites rail, except Search and CRM, which do not show Favorites. Sections are collapsible and display at most five 36px rows before scrolling internally. Clicking opens the favorited entity; Chat channel favorites select the conversation in place.

Calendar exposes its entity-filtered Favorites in the existing contextual side panel, also capped at five visible rows.

Drive (`/app/component/documents`) uses a dedicated desktop workspace under the new-views flag. The sidebar contains New, My Files, Recent (last viewed), Shared with me, Favorites, and Folders. Folders are nested under a visual Drive root; expand a branch to reveal its children and select a folder to filter the main file list without leaving Drive. The root shows all files. The header has Search files, and the second bar has Documents (Markdown/Word), PDF, Video, Image, and Canvas multi-select type chips, plus Sort. New uses the existing create/import menu. Mobile retains the existing Files layout.

Tasks (`/app/component/tasks`) uses the same aligned 48px sidebar/content headers and continuous divider as Email and Chat. The inner sidebar contains New task, My Tasks (assigned to the current user), All Tasks (all accessible tasks), Created by me, Favorites, and a collapsible Tags section with a long scrollable list of colored tag rows. Tag rows toggle the tag filter; selected rows are highlighted. Search tasks is at the top right. The second toolbar exposes Status, Assigned, Created by, and Priority as searchable checkbox dropdowns; selected labels/counts stay visible on each trigger. Each dropdown can clear its own facet; Clear filters clears all facets, including tags. Group and Sort stay at the right. Existing default status filters are shown explicitly on the Status chip. View switches restore that view's default filters/grouping. On narrow layouts the header navigation menu exposes the same task views and New task.

Agents (`/app/component/agents`) has a dedicated desktop workspace under the new-views flag. It opens on a blank New Chat composer; no chat is created until a message is sent. Its inner sidebar has New Chat, Routines, Agents, Connections, Skills, entity-scoped Favorites, and a scrollable Recent chats list with More chats pagination. The search icon in the Agents sidebar header replaces the sidebar navigation with a focused Search agent chats field and a single combined conversation list; the search shortcut opens it too. Escape or Close sidebar search clears the filter and restores navigation. With the new agent flag enabled, the blank composer starts a managed agent session on send; its first prompt is delivered after provisioning even if the user navigates away. Recent chats combines legacy chats with new agent sessions created or opened in this browser, ordered by recency. Session recents are stored per signed-in user locally and survive reloads; historical sessions from other devices are not listed yet because there is no user session-list API. Search filters both kinds of loaded titles. Clicking a recent chat opens its transcript and composer in the content pane while retaining the sidebar; New Chat returns to a fresh composer. A small pulsing accent indicator to the left of a chat title means the live stream is active; it clears on the stream's closed event and respects reduced motion. Routines and Agents open interactive design previews with sample data: searchable Mine/Team lists, templates, and nested settings pages. The URL uses `agentView=routines|agents`, `agentItem=<sample-id>|new`, and optional `agentSection=trigger|tools|history`. New routine/agent and template rows open an editor; breadcrumbs and Back return to the parent. Trigger and tool selection use nested pages, without modals. Settings include name, description, enabled state, access, instructions, and model. Save updates the mounted preview only; leaving that management view or reloading resets edits, and nothing is scheduled or provisioned. Existing sample records have illustrative run history/activity; newly created previews have empty history. Connections retains the existing management screen, and Skills lists skill documents with New skill using its existing app flow.

Desktop Inbox uses the shared ViewShell layout: a resizable inner sidebar holds
the 48px Inbox header, Signal / Noise / All, filters, and the item list. Selecting
an item opens an embedded preview in the content pane, retaining the sidebar.
The header divider is continuous across the resize gutter. Existing preview-pair
URLs are consolidated into this workspace; mobile retains its original list flow.

The redesigned inner sidebars (Chat, Email, Drive, Tasks, Agents, and generic
list favorites rails) use `bg-sidebar`, which aliases the content panel color (`--color-panel`).
Settings navigation and the Inbox list pane use the same sidebar token.
The outer rail and expanded app sidebar retain their original surface color.

Default inner sidebar widths are 288px for Email, Drive, and Tasks, and 320px for
Chat and Agents. Generic favorites rails are 256px; Inbox's inner sidebar
defaults to 384px. Resizable sidebars retain their existing drag limits.


The desktop Inbox, Chat, Email, Drive, Tasks, and Agents sidebars share
`ViewSidebar.Root`, `.Header`, and `.Title`: a 48px header, 20px title,
20px header insets, the sidebar surface token, and a subtle right divider.
Navigation rows are 36px with normal-weight text, section headings are 28px
with 12px muted labels, and sidebar groups use a 24px gap. Search controls are
36px tall with 14px text and visible focus rings; filter controls are 32px.
Chat scroll fades use the sidebar surface token to avoid a visible color seam.

Agent session tool calls use compact icon-and-title rows with result-count or path chips, following the Beautiful UI reference. Consecutive tool calls and thoughts are grouped under an initially expanded tool-count disclosure; its state is preserved while streaming. Click a row or press Enter/Space to expand its result. Macro tools render directly in the session's result surfaces rather than nesting a second legacy tool disclosure: lists show bounded, scrollable records, tags are grouped by scope, and each record can reveal its fields. Large lists initially show 20 records, with Show more exposing the rest. Request & response retains the full payloads; Copy controls copy output without sending anything. Entity results and newly created documents/folders retain their preview links, and DisplayResults retains its dynamic view. Terminal output has an exit-code header; edits retain per-file diffs. Plans show status rows and a completed count. Permissions and user-action drafts stay outside collapsed tool groups; these session records are read-only, and pending email/event drafts open by default. The composer starts as a compact single line, with model and send/stop controls inline beside the editor; longer drafts can grow naturally. Expanded results scroll within the transcript while the composer remains at the bottom.

Chat, Agents, and Drive share sidebar-local search: activate the magnifying glass at the right of the inner sidebar header (Chat/Agents) or the Folders section heading (Drive) to replace its navigation with a search field and one scrollable results list. Chat searches channels and direct messages together, Agents searches loaded legacy chats and local agent sessions, and Drive searches all folders including nested folders (not files). Selecting a result updates the content pane; search stays open. Escape in the input or Close sidebar search exits and clears the query; Chat and Agents also retain their header toggle. Drive preserves expanded folder branches. Email and Inbox do not use this sidebar search mode; Drive’s existing content search still searches files.

View layout gutters use `px-4`. Filter toolbars and Chat/Notifications tab rows use `py-2`; regular content sections use `py-4`. Inner sidebar headers retain their shared 48px height and centered controls; compact buttons, list rows, and inputs retain their own control padding.

The bell navigation item and its workspace are named Notifications (the route remains `/app/component/inbox`). Its tabs are Signal and Noise; the former All tab is removed, and restored All selections fall back to Signal. Email combines Signal, Noise, Drafts, Sent, All mail, Calendar, and Shared with me under one collapsible Inbox section, followed by Favorites and Tags. Desktop filter/sort/group controls use compact 28px heights and 12px labels with 8px vertical filter-bar padding and 16px horizontal gutters. The Drive, Email, and Tasks filter rows have a compact 44px minimum height.

Routines shows its Mine/Team list and New routine action without featured suggestions or templates. The Agents design preview features the default Macro agent, with Cursor, Hermes, and Grok Bot templates below the user list. These remain local design previews, not provider integrations. Active outer navigation tabs use their filled icon variants.

Inner sidebar titles match content header titles (`text-sm font-semibold`). Workspace headers and toolbar rows have no horizontal divider, and inner navigation lists omit horizontal separators. Vertical pane dividers remain to distinguish sidebar and content.

Workspace chrome now keeps only a continuous horizontal divider beneath the aligned 48px top headers. Filter bars and inner sidebar lists remain without horizontal separators.


Inner sidebars remain expanded with no manual collapse control. The second action row in Drive, Email, and Tasks uses a shared 72px minimum height to center sidebar actions and content filters on the same horizontal axis. The outer Create button is circular and uses the accent-filled CTA variant.

### Opening items from full lists

Ordinary item opens in Email, Drive, Tasks, and standalone Soup lists use the shared PreviewPanel inside the main content area. The workspace sidebar stays available. The preview header prefixes the item title with the originating view (for example, Drafts / Proposal); click the view breadcrumb to return to the list with its current filters and scroll position. Choosing another sidebar tab, tag, or Drive folder closes the inner preview. Folder rows retain folder navigation. Cmd/Ctrl-click still opens a new tab, and explicit split/preview-pair actions retain their existing behavior. Inbox/Notifications and Chat keep their dedicated preview layouts.

### Right-hand reference tabs

Each channel, agent session, or item opened in a workspace’s main content has its own reference panel. Clicking a document link, mention, attachment, or other block reference through the split navigation helpers opens a tab on the right, preserving the current main content and workspace sidebar. Reopening the same block selects its existing tab and applies any new location. Tabs display the actual content title; click a tab (or use Left/Right/Home/End while focused on a tab) to switch, and its close button to remove it. Collapse reference panel hides the panel without unmounting its open editors; Open reference panel restores it. Closing the last tab collapses the panel. On narrow content areas the panel overlays the right side instead of squeezing the main content. Tabs, their order and locations, the selected tab, and the collapsed state are saved per main item and per user in this browser. Switching channels or items restores that item’s panel; tabs from a different item are not carried over. They also restore after leaving the view or reloading. List views keep separate reference state from the items opened from them. Top-level navigation and ordinary full-list row opens retain their existing behavior.

The reference tab strip uses horizontal scroll indicators; scrollable block content uses the shared vertical gradient indicators. Indicators disappear at their respective scroll boundaries.

Reference tabs hide the embedded block’s title/share header. The expand control in the tab strip (Open reference full screen) opens the active item as the full-screen block, with its normal header and referenced location.

The open action on an item’s hover preview also opens its actual block in the right reference panel, preserving the referenced location. Its label is “Open in right panel”; calendar previews open the calendar at the referenced event. Outside a workspace reference panel, the existing fullscreen/split actions remain available.

The plus button beside the reference tabs opens Cmd+K in content-picker mode. Choose an existing file, task, conversation, channel, or other supported content to add/select a reference tab in that same panel. Dismissing the picker clears its destination; normal Cmd+K keeps its normal navigation behavior.
