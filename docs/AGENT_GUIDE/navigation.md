# Navigation and App Structure

## Direct URLs (all under the frontend origin)

| Route | Surface |
| --- | --- |
| `/app` | Redirects to inbox |
| `/app/welcome` | Login page (when unauthenticated) |
| `/app/invite?token=<token>` | GTM invite welcome page ("Welcome, <first name>", Continue → signup). Links come from the staff portal, last 48h, and grant the first month of Premium free once the account is created |
| `/app/internal/invite-links` | Macro staff only (`@macro.com`): create GTM invite links and track opens, signups, and subscriptions |
| `/app/inbox` | Desktop: Home (notifications + recent activity); mobile: Notifications soup |
| `/app/inbox/<block-type>/<uuid>` | Home with a heterogeneous item opened inline; target metadata is stored in `sN.inbox-preview.*` query values |
| `/app/mail` | Email client |
| `/app/mail/<uuid>` | Email with a thread opened inline; a targeted message uses `sN.email-detail.messageId` |
| `/app/channels` | Channels list |
| `/app/channels/<uuid>` | Channels with a conversation opened inline; message/thread targets use `sN.channel-detail.*` |
| `/app/drive` | Files (Drive defaults to My Files) |
| `/app/drive/<recent-or-shared>` | A Drive tab (`/app/drive/tab/<...>` remains a compatibility alias) |
| `/app/drive/folder/<uuid>` | A Drive folder; breadcrumbs resolve from current accessible folder data |
| `/app/drive/<document-type>/<uuid>` | An item opened inline in My Files |
| `/app/drive/folder/<uuid>/<document-type>/<uuid>` | An item opened inline in its Drive folder; document types include `md`, `task`, `skill`, `snippet`, `canvas`, `pdf`, `code`, `csv`, `image`, `video`, `spreadsheet`, and `unknown` |
| `/app/tasks` | Tasks table |
| `/app/tasks/<uuid>` | Tasks with a task document opened inline |
| `/app/agents` | AI chats / agents list |
| `/app/agents/<uuid>` | Chat agent session with the Agents sidebar |
| `/app/coders/<uuid>` | Code session with the Agents sidebar |
| `/app/agents/chat/<uuid>` | Legacy AI chat opened in the Agents workspace (`/app/agent-chats/<uuid>` remains a compatibility alias) |
| `/app/calls` | Calls list |
| `/app/companies` | Customers (CRM; needs a team) |
| `/app/activity` | Activity heatmap + feed |
| `/app/home` | Assistant (AI-first landing) |
| `/app/calendar/<month-or-week-or-day>` | Calendar; the focused event uses `sN.calendar.eventId` |
| `/app/<document-type>/<uuid>` | Legacy document URL (including `md`, `pdf`, `canvas`, `spreadsheet`, and the other Drive document types); redirects to `/app/drive/<document-type>/<uuid>` |
| `/app/documents`, `/app/files` | Legacy Files views; redirect to `/app/drive` |
| `/app/chat/<uuid>` | A standalone AI chat |
| `/app/automation/<uuid>` | Cron routine editor; event routines show a backend-managed notice |
| `/app/agent/<uuid>` | An agent session (opened from `@macro-new` / `@coder` / `@cursor`) |
| `/app/md/<doc>/chat/<chat>` | Doc + doc-scoped chat in a split |
| `/app/md/<doc>/channel/<channel>` | Doc + channel in a split |
| `/app/settings/account` | Settings (also `/app/settings/api-keys`, `/mcp-server`, `/shortcuts`, etc.) |

On touch devices, documents (including tasks) open in legacy blocks rather than
inline Drive details. Canonical `/app/drive/.../<document-type>/<uuid>` links also
fall back to legacy document routes. This uses touch detection, not the native-app
check: in DevTools, enable touch emulation rather than only narrowing the viewport.
Legacy document URLs upgrade to Drive only when desktop detail rendering is enabled.

Splits: the app is a tiling window manager. Public variable-length routes use
`~` as the boundary between panes
(`/app/drive/folder/<uuid>/~/mail`). Legacy fixed `type/id`
pane routes remain accepted. Known app-view URLs under `/app/component/` redirect
to their canonical paths above; legacy composers keep their existing paths. Split-specific view state uses positionally
namespaced query parameters such as `s0.drive.sort=created_at`; route identity
and breadcrumb nesting remain in the path. Home, Email, Tasks, and Channels
store the selected tab under `sN.inbox.tab`, `sN.mail.tab`, `sN.tasks.tab`,
and `sN.channels.tab`, respectively. Channels also stores the phone list
selection as `sN.channels.mobileTab`. Omitted tab keys mean each view's default;
changing tabs updates the URL, and browser Back/Forward restores the selection
independently in each pane. Inline detail links preserve these keys. Desktop panes expose Close when available and omit
split-history back/forward buttons. Mobile content panes retain their back button.

The app views are referred to as **workspaces**. Expanded workspace sidebars start
at the shared 256px width; manual resizing and narrow layouts can change the
displayed width. Workspace navigation uses shared 32px rows (44px on touch), 16px
glyphs in aligned 20px icon slots, a 6px text gap, and compact sentence-case section
headings. Tags and folders have a separate disclosure button on the **right** of
the row: clicking the label selects the destination; clicking Expand/Collapse
only opens or closes its children. Selecting a Drive folder or tab closes an
inline detail into that destination; it does not navigate back to Drive's root.
Home, Email, Tasks, Channels, and Drive keep their workspace provider mounted
while typed child routes own the accepted inline detail. Tasks and Email replace
the list with detail, capturing its focus and scroll state before disposal. Their child
selection participates in browser Back/Forward independently per pane. Explicit
return controls navigate to the workspace's list root. Multiple panes navigate
their child routes and history independently; returning to a list does not
activate another pane. Opening a resource already displayed in another pane
still activates its owner through router claim arbitration; the compatibility
preview guard can instead reject a conflicting embedded preview. On touch, or
when the new-app-view flag cannot render the detail, Home, Email, Tasks, and
Channels detail URLs fall back to the existing full-block surface. Legacy email
and channel message targets are normalized into per-pane search by ingress
middleware, including external/history navigation; explicit namespaced values win.
Unavailable documents retain their error/retry UI rather than navigating away.
Long destination names are single-line and
expose the full name on hover. Section chevrons point right and stay visible when
collapsed. Expanded chevrons point down and appear when hovering their section;
the section heading also brightens on hover. Sections and nested branches briefly
animate height and opacity when toggled, and respect reduced-motion preferences.
The sidebar spacing contract uses 8px outer gutters, 24px between sections, and
4px between a section header and its rows. Leading icons and trailing actions
share rails 26px from either edge, including collapse, search, add, and tree
controls. Use the shared slots described in
[the sidebar spacing guide](../../apps/web/src/components/view-shell/README.md).

Desktop app navigation panels have **Hide navigation** at the right end of their
48px title bar. It hides only that split's navigation; **Show navigation** (the
hamburger) appears before the main header's title/breadcrumbs, including when a
document, email, or conversation is open. Home's filter sits beside its label.
The split's **Close** control aligns with the navigation icons when expanded and
appears immediately before the hamburger when collapsed. Both use 16px icons in
24px desktop buttons. Close remains hidden when the split cannot be closed.
The hamburger sits directly beside the item title or view breadcrumbs. Narrow
desktop Drive headers use a plain view title; use the hamburger to navigate.
**Cmd+.** (Ctrl+. on Windows/Linux) toggles navigation in the active split, even
while typing. It leaves the outer app rail and other splits in place. Docked
navigation and the adjacent content animate their width over 140ms, with a brief
sidebar fade; reduced-motion preferences skip the animation.
Narrow navigation overlays use the same brief width and opacity animation.
Visibility is a sticky preference per app type (Home, Email, Chat, Tasks, Drive,
Agents, Customers), independent of other apps and restored on reload. Narrow
workspaces reopen navigation as an overlay; the backdrop or **Hide navigation**
closes it temporarily. Opening or closing the narrow overlay never changes the
saved wide-layout preference. Widening restores that preference, including in
Home and Chat: navigation returns unless explicitly hidden at desktop width.
Shrinking again starts with the overlay closed.
The overlay never contains the split's **Close** button. Mobile keeps
its existing navigation controls. Block detail panels (including Calendar) have
**Hide side panel** in their own header and a hamburger **Show side panel** beside
the main title when hidden, with separate preferences per block type.

Multiple desktop splits appear as individually bordered, medium-rounded panels with
6px top, right, and bottom insets and 6px resizable gaps.
The leftmost panel sits flush against the app rail, whose divider is hidden while
multiple splits are open. A single split stays edge to edge. Touch layouts keep their existing presentation.

Split focus mode (`Shift+Esc`) floats the active split in a rounded, bordered
panel over the same glass scrim as dialogs. Click the scrim or use the shortcut
again to restore the split layout.

Image lightboxes, channel media viewers, sharing, and onboarding dialogs use
the standard glass scrim. Scroll-edge indicators fade smoothly toward content
and disappear at the corresponding scroll boundary. Image and video error
placeholders retain diagonal stripes.

Shift-click on content links requests a new split wherever splits are supported,
including mentions, references, folder links, and list rows with a linked preview.
Unmodified clicks keep each surface’s default (same split, preview, or new split).
Existing-content deduplication and split-capacity limits still apply; touch devices
continue to navigate in place.

A block mounted in an inline detail is reused when opened elsewhere. Mentions
and notifications activate its host without a toast; explicit list or Cmd+K
selection shows `Content already open` to explain the move. Duplicate
mounts reached through direct layout paths show the same message instead of a
second block instance.

Desktop inline content previews use a 48px header with a muted bottom divider,
aligned with the adjacent sidebar title bar (such as Home). Standalone block
headers use the same height without a bottom divider. Preview headers and toolbars
are transparent so they blend with the pane's inactive background. Header controls
stay centered and the preview body fills the remaining height below the divider.

## Sidebar (a11y names are load-bearing)

- Top: buttons `Search` and `Create`. Clicking sidebar `Search` opens a menu
  with `Command Menu` (⌘K on Mac / Ctrl+K elsewhere) and `Search everything`
  (`/`). Choose the first to open commands, or the second to open and focus
  global search. Hold Shift while selecting `Search everything` to open it in a
  new split, including when Search is already active. This left-click menu shares
  its surface and item styling with the sidebar right-click menus, in both the
  compact rail and expanded sidebar.
- Nav: `Go to Assistant`, `Go to Getting Started`, `Go to Home`, `Go to Recent`, `Go to Activity`.
- Workspace: `Go to Email`, `Go to Channels`, `Go to Calls`, `Go to Files`, `Go to Tasks`,
  `Go to Calendar`, `Go to Agents`, `Go to Customers`.
- Then `Favorites` (pinned items) and `Latest` (recent channels/DMs with an `Unread` switch).
- Bottom: button named after the user's email — menu with `Command menu (Ctrl K)`,
  `Settings (Ctrl ;)`, `Log out`.

With the new app views enabled, the outer sidebar is an icon rail. Start a new AI
chat from the Agents workspace; the rail has no separate new-chat-in-a-new-split
button. Its tooltips
use the standard 400 ms hover delay and 300 ms grace period between items. Home,
Email, and Chat show a small accent dot when the loaded data contains an unread
item. Home uses Signal; Email uses Important across all linked inboxes.
Noise does not light either dot. These are presence indicators, not counts; they
do not fetch additional pages to find every unread item. Opening a view alone does
not clear its dot — reading or completing the represented items does. The button's
accessible description is `Unread items` while its dot is active.
The Home dot stops checking rows at the first eligible unread item, using the
same Signal membership, channel/thread scoping, and local read/done overrides as
the list. Check that reading that item keeps the dot lit if another loaded row
is unread, and that completing the last one clears it. Query bounds and
pagination are unchanged.

The Agents sidebar mixes chat and coding sessions in one newest-first list.
New agent sessions use one dot in the left slot for activity and notifications:
pulsing accent for starting/working, amber for waiting for input, and solid accent
for an unread dormant session. Read dormant sessions leave that slot empty.
Hover a row for its full title and activity label. Coding sessions show a second
line with repository, captured working branch (when available), and linked PR
number/status; non-coding sessions stay on one line. The starting branch is never
presented as the working branch. PR states come from synced GitHub data; an
unsynced PR shows its number without an assumed status. Missing metadata is omitted;
"Coding agent" is never substituted for a branch. There is no right-side dot in
Agents; Home keeps its sparkle and trailing unread dot. Only the selected row has
the selected background. Legacy chat rows keep their chat icon.
Use **Search conversations** beside the Conversations heading to filter by title.
Results stay packed at the top with compact spacing, even with only a few matches;
clearing the search restores the list.
Its **New conversation** button opens the unified composer with one **Agent**
selector on the right. Choosing a coding agent reveals the repository drawer;
there is no Chat/Code switch. New sessions use the selected agent's default model
and the URL for its kind. Opening an existing row restores its own kind and URL.
Right-click a conversation for Rename, Favorite, Copy link, Share, Delete, and
the other entity actions used on Home.

Home's inner rail starts with a full-width **New chat** plus button that returns
to Home's starting pane without creating a chat. Email and Tasks use the same
pill styling and top placement for **New email** and **New task**, replacing
the sidebar title bars. When multiple desktop splits are open, a **Close** (X)
button appears beside each sidebar's New button and closes that split. The last
logical split has no sidebar close button; mobile chrome is unchanged.
A lone non-list content split still shows a header X labeled **Return to list**,
which returns that split to the most recent list in its history, preserving
that list’s state. If there is no prior list, it replaces the current entry with
inbox. Excluded background panels do not count toward close eligibility.
These buttons and Home items activate on primary-button
press; keyboard activation remains supported. Home, Chat, Email,
Tasks, and other views using the shared inner
sidebar layout default to 256px; manually resized Chat widths remain saved.
After dragging a view's inner sidebar divider (or using its arrow keys), resizing
the containing split preserves the chosen sidebar width while space permits.
Narrow splits may shrink or collapse the sidebar; widening restores its chosen
width for the mounted view.
Widening the sidebar while its split is constrained also reduces the main
content's soft width preference, so the next split resize keeps that choice
instead of snapping the sidebar back to its constrained width.

Email, Tasks, and Agents use the same sidebar rows, including favorites, tags,
inboxes, and recent agent chats: 32px high on desktop and 44px on touch devices,
with regular-weight labels and consistent icon spacing.

Entity rows and navigation use Phosphor icons. Entity icons share one mapping
across lists, previews, and drag images, with regular and bold weights. Read email
uses an open envelope, calendar invitations use a calendar, and pull requests
retain their open/merged/closed glyphs and status colors. Direct messages may
show the other participant's avatar instead of a glyph.

## List-row dragging

GraphQL-backed Soup rows initialize dragging on the first primary-button press;
a preparatory hover is not required. REST-backed rows retain eager registration.
Verify first-press dragging after navigation as well as ordinary row clicks and
right-click menus. A completed drop can move or copy real data; use a disposable
test item when verifying drop actions.

Split-header, file-upload, and conversation drop targets use plain color
overlays with small sans-serif hints in fully rounded pills. Invalid file drops
use the failure background color. Cancel the drag to inspect these hints without
uploading or moving anything.

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
**+ Document** on Files, and **+ Event** on Calendar. On Notifications,
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

Hovering an `@user` mention or a profile picture on desktop opens the user card:
the person's name and email above Copy email, Copy name, Open contact (CRM teams
only), DM, and Assign task. Touch devices have no hover, so tapping the mention
or the picture opens that same card as a bottom sheet; any action there runs and
dismisses the sheet. Desktop keeps click-to-DM on the picture itself, which touch
drops in favour of the card's DM action.

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

## Routines (automations)

Create → Automation creates a cron-scheduled routine. Cron routines support
editing instructions and schedule, Rename, Pause/Resume, Duplicate, Run Now,
and History links to run chats. Edits autosave; Run Now also works while paused.
If a background refresh fails, cached cron routines stay listed and their editor
and queued autosave remain available. An initial load failure without cached data
shows **Unable to load automation** instead. Cached event routines remain
backend-managed even after a refresh failure.

Event-triggered routines are backend-managed through the scheduled-action API.
They do not appear in the frontend's cron-only automation lists. Opening an
API-created event routine at `/app/automation/<uuid>` shows **Backend-managed
routine**, not a cron editor. This surface offers no event editing, duplication,
or run/history controls; manage those through the API. It never replaces an
event trigger with a cron schedule. There is no event-filter composer yet.

## Command menu (Ctrl+K)

Opens a dialog with a focused `Search...` textbox and bubble-style category radios
(All / Command / Agents / Files / Tasks / Channels / People). Type a name, press Enter to open
the top hit. Also exposes commands: `Create`, `Change theme`, `MCP setup`. Keys: Tab cycles
category, Esc closes. The category strip and footer have transparent backgrounds.

With the local GraphQL cache enabled, Cmd+K and document/channel `@` mentions
search cached entities without waiting for a server search. Background hydration
updates an already-open menu. For an empty search, scroll toward the end (or use
Down); mentions offer **View all** for a category and then load more local pages.
Counts describe loaded results, not the full server corpus. Scans through
incomplete or already-visible cache hits are bounded per action; continue
navigating/scrolling, or narrow the query, to resume from the saved cursor.
A failed local refresh keeps displayed rows and their continuation available for
another pagination attempt. A missing item may still be uncached, but should appear after hydration without retyping. Cmd+K's
local search excludes unsupported email hits before limiting entity results;
email mentions keep their separate search-service path.

Pending or failed Quick Access history, recently-viewed, and cached-channel lookups
must not hide the app shell. Verify a cold lookup with Cmd/Ctrl+K: navigation stays
mounted and usable while the optional source loads or fails. A failed background
refresh retains available history/channel items and recently-viewed ordering.
Placeholder results also remain usable while replacement data loads. A normal cache-worker
handoff between tabs preserves backfill cursors and watermarks; only a replacement
that creates or resets stored cache data discards them. Per-lane full-refresh and
Shared Mail restart rules still apply.

## Keyboard model (from the in-app guide; verified partially)

- `Ctrl/Cmd+K` — jump to anything by name.
- `c` then `d`/`t`/`e`/`m`/`a` — create doc / task / email / channel / AI chat.
  Single-letter shortcuts only work when no editor has focus; press `Escape` first.
- `/` — search everything. `j`/`k` — move in lists. `e` — mark done.
- `g` then `h` — Home (inbox); `g` then `i` remains an alias. Assistant is
  available through its sidebar link or the `Go to Assistant` command.
- In Email and Tasks search, `Escape` returns focus to the list and keeps the query.
  Use the search field's clear button to clear it.
- Splits: `` ` `` split, `Shift+H`/`Shift+L` move focus, `Shift+Esc` maximize.
- In any text surface: `@` mentions (bidirectional links), `#` tags, `/` block commands,
  `:` emoji. Clicking a rendered tag opens a Search split filtered to that tag.

Settings → Agents and Settings → Harness render while their requests are pending.
A pending Cursor model catalog shows `Loading models…` beside a disabled model
picker; a failed catalog shows an inline error. The rest of settings stays usable.

With the `claude-cloud` feature flag enabled, Claude Cloud connection setup is in
Settings → Harness, above Cursor, with the
Anthropic logo. Settings → Agents selects an agent's harness but does not host
Claude's connection form. **Connect Claude** starts authorization and opens sign-in
on the first click; a fallback link remains if the browser blocks the tab.
Approve on Claude's page, copy the complete `code#state`, then use **Finish
connecting**. Hosted and local deployments use the same flow. Grants and pending
sign-in attempts are encrypted in MacroDB and survive restarts or replica changes.
If the card says sign-in is not configured, the deployment is missing its Claude
OAuth KMS key; changing the frontend flag cannot fix that backend configuration.
Claude's model picker uses provider-reported IDs,
names, descriptions, and order. Settings discovers from recent account sessions;
session catalogs update through replay, polling, and streaming. Before any catalog
is available, only subscription default is shown with an explanation. It saves the next-turn preference
without waking an idle worker; provider model rejections surface during the turn.
Claude agents use their saved MCP selection through the shared authenticated
session egress path. Remote HTTP/SSE servers are supported; stdio servers are
rejected. Tool permission requests use Macro's standard session policy. MCP setup
failures surface as turn errors and request interruption; the first prompt also
wakes the cloud worker, so setup failure may occur after submission. Reconnecting
refreshes the session credential and restores the saved selection.
Claude sessions expose **Open in Claude** in the header
toolbar (or its overflow menu). With a live runtime, messages sent in Claude are
polled into Macro about every two seconds; disconnected runtimes must resume first.

Home does not bind Delete or Backspace to deleting list items. These keys remain
available to the open editor (for example, clearing a selected spreadsheet range).
Use the item menu to delete an item from Home.

`C A` (Create → Agent) opens the Agents new-conversation page and focuses its
message input; `C Shift+A` requests a new split. It does not open a modal or
create a session before the user sends. Repeating it focuses the existing draft.

### Content already open

Splits navigate independently. The retired Preview Pair mode no longer creates
an adjacent viewer, redirects list navigation, or links split sizes and history.
Inline details in Home, Email, Tasks, Channels, and Drive use typed split-router
child routes; there is no competing view-local detail stack or persisted selected
ID. List filters, sidebar preferences, and focused-list state remain view-owned.
Split back/forward navigation skips entries whose entities are open elsewhere,
without moving focus or showing a toast. Those entries remain in history and
become reachable again after their owning view releases them. A direction is
unavailable when no reachable entries remain. Mobile swipe navigation reuses
an already-mounted conversation without losing the other pane.
History controls update when an inline detail claims or releases an entry,
including when the detail closes.
Resetting a split clears its previous history and starts at the default view;
after opening another item, Back returns to that default view.

Entity content can be open in only one split or inline preview/detail view at a
time. Shell components may have duplicate splits when `allowDuplicate` is enabled.
An Agents conversation route counts as the same entity as its agent or chat block.
Following a mention or notification reuses the existing split or inline detail,
activates its workspace, and navigates to any specified location without a toast.
Explicit entity selections from lists or Cmd+K also reuse the existing view, but
show the duplicate-content toast to explain the move. A list whose detail cannot
claim that entity keeps its previous selection and history.
Opening an entity already in a split focuses that split when activation is
requested; the sidebar's **Open in new split** also shows a **Content already open** toast.
Selecting an entity owned by another view from a detail view leaves the current
detail and navigation history unchanged, focuses the owning view, and shows a
**Content already open** toast. Close or navigate away
from the owning view before opening it elsewhere. The same rule applies to mouse
selection, keyboard preview navigation, and detail breadcrumbs. Touch layouts
never render inline previews or detail views: a tap opens the entity in the
split, so the toast only appears when the content is genuinely open elsewhere.

Split-router ownership checks use the final redirected destination. Concurrent
opens of the same claimed resource wait for the first outstanding request rather
than creating duplicate panes. If pane-history navigation reaches content owned
by another pane, it focuses that owner without advancing the requesting pane's
history cursor. Restoring a saved layout preserves existing duplicate panes;
search-only updates within those panes do not collapse them.

## Entity action dialogs

Rename, Delete, and Move to folder use compact centered dialogs on desktop and
the shared drawer on mobile, with actions in a separated footer. One selected
item shows a compact name chip; multiple items show two chips and
`+N`, which expands single-line names for review.
Selected-item chips in action command menus and dialogs use the shared Badge,
cap each name at 192px, and reveal truncated names on hover. Overflow counts
remain on one line.

Bulk Rename uses bubble tabs for Prepend, Append, Replace, and Total. It starts
with the first item’s name and shows one before/after example. Replace
shows only Find and Replace with fields; Total applies one name to all items.
The preview counts changed names.
Partial deletes keep the dialog open, report confirmed successes, and leave only
failed items selected for retry.
Cancel and Escape dismiss the dialog. Use Cancel when
reviewing dialogs against hosted data; confirmation performs real mutations.

The New reminder dialog uses the same compact panel and fixed action footer.
Its referenced item is a capped Badge; repeat options use bubble tabs (Does not
repeat / Weekly / Monthly). Date, time, weekdays, and timezone retain their
scheduling behavior. Creating a reminder dismisses the composer before saving,
with success or failure reported by toast.

Action dialogs share `ActionDialogShell` presentation slots: the same capped selection badges for single and multiple items, compact heading and copy, prominent fields, and an attached footer. Rename, delete, move, reminder creation, and shared confirmations use this layout. Bulk rename keeps bubble tabs and one first-item preview.

The Move to folder picker uses the Drive sidebar’s folder rows: neutral icons, trailing expand/collapse buttons, and indented branch guides. Click a folder to select it; use the chevron to expand it. Search and arrow-key navigation remain available.
