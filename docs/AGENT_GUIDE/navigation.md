# Navigation and App Structure

## Direct URLs (all under the frontend origin)

| Route | Surface |
| --- | --- |
| `/app` | Redirects to inbox |
| `/app/welcome` | Login page (when unauthenticated) |
| `/app/component/inbox` | Unified inbox |
| `/app/component/mail` | Email client |
| `/app/component/channels` | Channels list |
| `/app/component/documents` | Files (documents list) |
| `/app/component/tasks` | Tasks table |
| `/app/component/agents` | AI chats / agents list |
| `/app/component/calls` | Calls list |
| `/app/component/companies` | Customers (CRM; needs a team) |
| `/app/component/activity` | Activity heatmap + feed |
| `/app/component/home` | Home (AI-first landing) |
| `/app/calendar/view` | Calendar |
| `/app/md/<uuid>` | A document |
| `/app/chat/<uuid>` | A standalone AI chat |
| `/app/agent/<uuid>` | An agent session (opened from `@macro-new` / `@coder` / `@cursor`) |
| `/app/md/<doc>/chat/<chat>` | Doc + doc-scoped chat in a split |
| `/app/md/<doc>/channel/<channel>` | Doc + channel in a split |
| `/app/settings/account` | Settings (also `/app/settings/api-keys`, `/mcp-server`, `/shortcuts`, etc.) |

Splits: the app is a tiling window manager. A second pane appends its own segment to the URL
(`/app/<left>/<right>`). Each pane has its own Close / Go Back / Go Forward buttons.

## Sidebar (a11y names are load-bearing)

- Top: buttons `Search` and `Create`.
- Nav: `Go to Home`, `Go to Getting Started`, `Go to Notifications`, `Go to Recent`, `Go to Activity`.
- Workspace: `Go to Email`, `Go to Channels`, `Go to Calls`, `Go to Files`, `Go to Tasks`,
  `Go to Calendar`, `Go to Agents`, `Go to Customers`.
- Then `Favorites` (pinned items) and `Latest` (recent channels/DMs with an `Unread` switch).
- Bottom: button named after the user's email — menu with `Command menu (Ctrl K)`,
  `Settings (Ctrl ;)`, `Log out`.

With the new app views enabled, the outer sidebar is an icon rail. Notifications,
Email, and Chat show a small accent dot when the loaded data contains an unread
item. Notifications uses Signal; Email uses Important across all linked inboxes.
Noise does not light either dot. These are presence indicators, not counts; they
do not fetch additional pages to find every unread item. Opening a view alone does
not clear its dot — reading or completing the represented items does. The button's
accessible description is `Unread items` while its dot is active.

## Favorites

Use an entity's command/context menu to add or remove it from Favorites; drag rows
within the expanded sidebar's Favorites section to reorder them. Documents, chats,
projects, email threads, channels, calls, CRM companies, and CRM contacts support
toggling. Individual channel messages are not favoritable.

With the GraphQL local cache enabled, cached favorites remain visible when offline
or when a background refresh fails. Toggle and reorder success while offline means
the change was accepted into the durable queue, not yet confirmed by the server.
Removing then re-adding an item appends it to the end; those operations are replayed
in order. A newer queued reorder replaces an older queued reorder. Server-rejected
changes roll back rather than becoming committed local favorites.

## Create menu

On mobile, the bottom dock fits fixed-width buttons in this order: Notifications,
Calendar, Email, Channels, Files, Agents, Tasks, Calls. Calendar appears in the
dock and search scope pills only when the calendar UI flag is enabled.
Resizing the screen moves views between the dock
and More views, which always includes Settings and lists the overflow views in
reverse order. More and the separate bottom-right Search button always retain
their space. Search opens the search input and scope pills.
Once every view fits, the navigation island stops growing; Search stays aligned
to the right edge.

The separate button one row above Search opens the current page's creation
flow directly: new task on Tasks, email on Email, message on Channels or
Notifications, document on Files, agent session on Agents, and event on
Calendar. It does not open a create menu. It hides during search, while the
keyboard is open, and on entity/detail pages with their own reply or compose
controls. All popover splits open as bottom drawers on touch devices and dialogs
on desktop, including task, calendar event, skill, and agent session composers.

`Create` button (top-left) opens a menu of: Email E, Automation U, Agent A, Skill K,
Document D, Task T, Reminder R, Snippet S, Message M, Channel G, Canvas N, Folder F, Code O.
Document navigates straight into a new doc; Task and Channel open dialogs.

## Command menu (Ctrl+K)

Opens a dialog with a focused `Search...` textbox and category radios
(All / Command / Agents / Files / Tasks / Channels / People). Type a name, press Enter to open
the top hit. Also exposes commands: `Create`, `Change theme`, `MCP setup`. Keys: Tab cycles
category, Esc closes.

## Keyboard model (from the in-app guide; verified partially)

- `Ctrl/Cmd+K` — jump to anything by name.
- `c` then `d`/`t`/`e`/`m`/`a` — create doc / task / email / channel / AI chat.
  Single-letter shortcuts only work when no editor has focus; press `Escape` first.
- `/` — search everything. `j`/`k` — move in lists. `e` — mark done. `g` then `i` — inbox.
- In Email and Tasks search, `Escape` returns focus to the list and keeps the query.
  Use the search field's clear button to clear it.
- Splits: `` ` `` split, `Shift+H`/`Shift+L` move focus, `Shift+Esc` maximize.
- In any text surface: `@` mentions (bidirectional links), `#` tags, `/` block commands,
  `:` emoji. Clicking a rendered tag opens a Search split filtered to that tag.

Settings → Agents and Settings → Harness render while their requests are pending.
A pending Cursor model catalog shows `Loading models…` beside a disabled model
picker; a failed catalog shows an inline error. The rest of settings stays usable.
