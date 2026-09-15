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

- Top: buttons `Search` and `Create`. Clicking sidebar `Search` opens a menu
  with `Command Menu` (⌘K on Mac / Ctrl+K elsewhere) and `Search everything`
  (`/`). Choose the first to open commands, or the second to open and focus
  global search. Hold Shift while selecting `Search everything` to open it in a
  new split, including when Search is already active. This left-click menu shares
  its surface and item styling with the sidebar right-click menus, in both the
  compact rail and expanded sidebar.
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
Calendar, Email, Channels, Files, Agents, Tasks, Calls, and CRM (when enabled). Calendar appears in the
dock and search scope pills only when the calendar UI flag is enabled.
Resizing the screen moves views between the dock
and More views, which always includes Settings and lists the overflow views in
reverse order. More and the separate bottom-right Search button always retain
their space. Search opens the search input and scope pills.
Once every view fits, the navigation island stops growing; Search stays aligned
to the right edge.

Primary dock navigation buttons, including Search, give haptic feedback on
pointer down and activate on click/release. Holding a button only shows its
pressed state; cancelling the touch does not navigate. More views also opens on
release so holding its trigger cannot drag or dismiss the opening sheet. Mouse,
keyboard, and assistive activation use the normal click behavior.

The dock's More views menu uses the same rounded glass bottom sheet as filters,
with a blurred backdrop, drag handle, and an even 8px outer inset. The home
indicator clearance sits inside the sheet. Tap a row to select; tap outside, swipe down, or press Escape to dismiss.
The ellipsis (**More tabs**) button on non-scrolling pill strips opens the same
drawer on release. Tap a tab to select it and close the drawer; the selected tab
moves into the visible strip. Holding and sliding from the trigger does not select
a row. The **Views** and **Tabs** footer buttons dismiss their respective drawers.
Settings opens its own glass sheet with a grouped main page. Select a settings
section, use **Back to settings** to return, or **Close settings** in the top
right to dismiss without changing the underlying app view.
Opening Settings again starts at the grouped main page. In-app actions that
request a specific section, including Getting Started actions, open that section
directly in the sheet without replacing the current view or changing its URL.
If a requested section is unavailable, the sheet shows an unavailable message
and a **Back to settings** button that returns to the grouped main page.

Fresh mobile CRM visits default to list view, including when
applying a default saved view; explicitly selected saved views and back/forward
navigation retain their layout. The mobile **+ Company** button opens the
company-creation sheet.

The labeled glass button one row above Search opens the current page's creation
flow directly: **+ Task** on Tasks, **+ Email** on Email, **+ Message** on Channels,
**+ Document** on Files, and **+ Event** on Calendar. On Home/Notifications,
**+ New** opens a blurred backdrop and a stack of glass actions: Email, Message,
Document, Event, Task, More. Event follows the calendar UI flag; unavailable
launcher actions are omitted. The plus rotates into an X; tap it or the backdrop,
or press Escape, to dismiss. More opens the full create menu as a glass bottom
sheet on mobile, with broad, screen-scaled corners and an even 8px outer inset;
home-indicator clearance is inside the glass. The mobile full menu is a scrollable
list of available create actions ordered by recent usage, with a Close create menu
button and no search field. Desktop retains search and keyboard controls. Other views
show **+ New** for that full menu. The AI composer narrows beside this
button; on Agents it fills the row with no duplicate create action. The row
hides during search, when a page supplies its own reply or compose controls, or
when an editable field outside Ask AI is focused on a touch device. The AI draft
is preserved when the row returns.
The New button also hides while the software keyboard is open.

Mobile drawers and floating dialogs share this inset glass sheet treatment,
including filters, task/event creation, file/message actions, sharing, and model
pickers. On phones, non-fullscreen dialogs use the shared drawer without an X
button: drag the handle down, tap the backdrop, or press Escape to dismiss.
Explicit actions such as Cancel or Later remain available. Closing returns focus
to the opener unless the flow supplies its own focus destination. With the
keyboard open, the sheet stays 8px above it and its body scrolls to keep inputs
and actions reachable. Fullscreen takeovers retain their fullscreen layout.

Filter sheets have a visible heading and Close filters button. Sort and filter
options use rounded rows with trailing checkmarks; accordion sections retain
their selection counts. Clear all resets selections without dismissing the sheet.
Calendar settings and the month picker use the same translucent groups and
rounded selection highlights. Calendar visibility and Show weekends are checkbox
rows; period, week start, time format, and month choices show trailing checkmarks.

All popover splits open as bottom drawers on touch devices and dialogs
on desktop, including task, calendar event, skill, and agent session composers.

`Create` button (top-left) opens a menu of: Email E, Automation U, Agent A, Skill K,
Document D, Task T, Reminder R, Snippet S, Message M, Channel G, Canvas N, Folder F, Code O.
Document navigates straight into a new doc; Task and Channel open dialogs.

Mobile glass presses animate the enclosing surface over 300ms. Round buttons
retain roughly 20% growth; wide pills and grouped controls extend their glass
fill and rim by up to 3px per edge, with 8% icon growth around each icon's center.
Labels and layout stay fixed; icons remain visually aligned through release.
Selecting or deselecting a pill updates its fill and text together, including
during release or a rapid second tap. A subtle radial sheen spreads from the tap
location and fades on release. On touch devices, buttons omit the circular
hover/press overlay and native tap highlight; the shimmer supplies feedback.
Release, cancellation, or dragging outside
restores the surface. Disabled controls stay still; reduced motion keeps only
the static highlight.

## Command menu (Ctrl+K)

Opens a dialog with a focused `Search...` textbox and bubble-style category radios
(All / Command / Agents / Files / Tasks / Channels / People). Type a name, press Enter to open
the top hit. Also exposes commands: `Create`, `Change theme`, `MCP setup`. Keys: Tab cycles
category, Esc closes. The category strip and footer have transparent backgrounds.

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
