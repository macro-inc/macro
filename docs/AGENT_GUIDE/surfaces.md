# Other Surfaces

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
re-import of a member's own event, for example) renders once per calendar, side by side,
the way Google Calendar shows it: each chip carries its own copy's title, color, and
editability, and hiding a calendar hides its chip. Reminders, guests, and conferencing
always show and follow the primary copy, since that is the copy Macro's alerts fire from
and whose guest list and join link Macro records, and the editor only lets them be changed
there. Answering an invitation likewise addresses the primary copy. The details popover and
the editor act on the chip's copy, so editing or deleting it targets that calendar's event
at Google.

Teammates' Google Calendar out-of-office events overlay the grid as read-only chips titled
`<name>: <event title>`. The side panel's `Team out of office` section (shown only when the
user belongs to a team with other members) has a checkbox in its header row toggling the
whole overlay on or off — all teammates or none — and lists the next 90 days of teammate
absences; clicking a row navigates the grid to that date. Coverage depends on each teammate
having connected their own calendar and using Google's out-of-office event type.

## Calls — `/app/component/calls`

Tabs `All` / `Missed` / `Unattended`; `Call` button to start one. Recordings, transcriptions
and summaries appear here; empty state notes "Calls are available to agents."

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
`Agents` lists team and private agents with `Create agent` / `Edit <name>` dialogs grouped
Profile, Behavior, Runtime, Connections, Channels, Share. Connections is a radio pair:
`Use my connected apps` (default; the agent gets whatever the person running it has
connected) or `Specific apps`, which reveals a `Search connectors` box over the whole
Pipedream catalog (results are `option` rows; picking one adds it) and a row per picked app
with a connected / not-connected dot for the *current viewer* plus an inline `Connect`
that opens the Pipedream Connect flow inside the dialog. Unconnected picks never block
saving; each teammate connects their own account. An agent session that calls a picked
but unconnected app gets a tool result saying so, and the agent's reply renders a
`Connect <app>` chip that opens Settings → Connections for that app.
`Back to app` returns to the previous surface. Open via user-email button menu or `Ctrl+;`.

## Notifications

Toast regions are labeled `Notifications (alt+T)`; five empty live regions always exist in
the a11y tree (ignore them when parsing snapshots).

Email workspace refinements: the toolbar contains Sort and Filter. Tags appear as label-style rows in the inner sidebar, with their existing colors. Selecting a tag shows matching messages across All mail within the selected inbox; selecting it again clears the tag. Choosing a mailbox also clears the label filter. Read email rows are slightly dimmed.

Email sidebar sections Mail, Views, and Tags start expanded and toggle via their section-heading buttons (`aria-expanded`). Collapsing a section does not change the selected mailbox or tag. Inbox stays expanded.

The + button beside the Email sidebar Tags heading opens the shared Create tag dialog (name, color, and personal/team scope when available). It remains accessible when Tags is collapsed or empty. Saving refreshes the sidebar through the existing tags query.

Favorites are scoped to each app view: Email threads, Chat channels/messages, Tasks task documents, Files non-task documents, Agents chats/sessions, and the corresponding types for other lists. Inbox does not show a Favorites section. Email places Favorites below Views; Chat above Channels in All only (hidden in Recent); Tasks beneath its navigation. Other list views use a favorites rail. Sections are collapsible and display at most five 36px rows before scrolling internally. Clicking opens the favorited entity; Chat channel favorites select the conversation in place.

Calendar exposes its entity-filtered Favorites in the existing contextual side panel, also capped at five visible rows.

Drive (`/app/component/documents`) uses a dedicated desktop workspace under the new-views flag. The sidebar contains New, My Files, Recent (last viewed), Shared with me, Favorites, and Folders. Folders are nested under a visual Drive root; expand a branch to reveal its children and select a folder to filter the main file list without leaving Drive. The root shows all files. The header has Search files, and the second bar has Documents (Markdown/Word), PDF, Video, Image, and Canvas multi-select type chips, plus Sort. New uses the existing create/import menu. Mobile retains the existing Files layout.

Tasks (`/app/component/tasks`) uses the same aligned 48px sidebar/content headers and continuous divider as Email and Chat. The inner sidebar contains New task, My Tasks (assigned to the current user), All Tasks (all accessible tasks), Created by me, Favorites, and a collapsible Tags section with a long scrollable list of colored tag rows. Tag rows toggle the tag filter; selected rows are highlighted. Search tasks is at the top right. The second toolbar exposes Status, Assigned, Created by, and Priority as searchable checkbox dropdowns; selected labels/counts stay visible on each trigger. Each dropdown can clear its own facet; Clear filters clears all facets, including tags. Group and Sort stay at the right. Existing default status filters are shown explicitly on the Status chip. View switches restore that view's default filters/grouping. On narrow layouts the header navigation menu exposes the same task views and New task.

Agents (`/app/component/agents`) has a dedicated desktop workspace under the new-views flag. It opens on a blank New Chat composer; no chat is created until a message is sent. Its inner sidebar has Search chats, New Chat, Routines, Agents, Connections, Skills, entity-scoped Favorites, and a scrollable Recent chats list with More chats pagination. Search filters the loaded chat titles. Clicking a recent chat opens its transcript and composer in the content pane while retaining the sidebar; New Chat returns to a fresh composer. A small pulsing accent indicator to the left of a chat title means the live stream is active; it clears on the stream's closed event and respects reduced motion. Routines lists existing scheduled actions with New routine, Agents and Connections embed the existing management screens, and Skills lists skill documents with New skill. Creating/opening routines and skill documents uses their existing app flows.

Desktop Inbox uses the shared ViewShell layout: a resizable inner sidebar holds
the 48px Inbox header, Signal / Noise / All, filters, and the item list. Selecting
an item opens an embedded preview in the content pane, retaining the sidebar.
The header divider is continuous across the resize gutter. Existing preview-pair
URLs are consolidated into this workspace; mobile retains its original list flow.

The redesigned inner sidebars (Chat, Email, Drive, Tasks, Agents, and generic
list favorites rails) use `bg-sidebar`, whose semantic color sits midway between
the outer rail and the content panel. Inbox's list pane uses the same sidebar token.

Default inner sidebar widths are 288px for Email, Drive, and Tasks, and 320px for
Chat and Agents. Generic favorites rails are 256px; Inbox's inner sidebar
defaults to 384px. Resizable sidebars retain their existing drag limits.
