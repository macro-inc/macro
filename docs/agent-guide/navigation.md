# Navigation and App Structure

The native macOS app reserves 40 px above the app layout for the inset overlay
title bar's traffic-light controls. Drag this top strip to move the window, or
double-click it to toggle zoom. The loading shell uses the same inset; browser,
Windows, Linux, and mobile layouts do not add this space.

On macOS, Back and Forward arrows beside the traffic lights navigate the active
split's history. Each arrow is
disabled when its direction has no entry. Sidebar controls remain inside each
workspace. The top-right split icon opens another Home split, even
when Home is already open, and is disabled when there is no room for a new split.
Its tooltip is “New Split” and displays the registered new-split shortcut (`\`).

## Desktop tabs (macOS, `enable-desktop-tabs` flag)

The title bar's center holds browser-style tabs; each tab is a whole split
layout. Only the active tab's layout is mounted — switching tabs swaps every
split through the router, preserving each split's back/forward history and
running unsaved-changes guards. A tab holding more than one split shows a
split icon with the count. The strip's `+` button (and `Cmd+T`) opens a tab on
Home; the `X` or a middle click closes one (the last tab cannot close;
`Shift+Cmd+W` closes the active tab); `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle.
Cmd+click (Ctrl elsewhere) on anything that navigates opens the destination in
a background tab; adding Shift also switches to it. Tabs are not draggable.
Tabs persist per user and restore on launch. In the browser and on other
platforms the strip does not render.

Reference captures (browser fixture with the desktop gates forced):
[a three-split tab beside a second tab](media/desktop-tabs/three-split-tab.png)
and [tabs restored after a reload](media/desktop-tabs/restored-tabs.png).

After native bundle updates, verify that Home and channel details load without
an update toast on every launch. Relative bundled assets such as Loro's WASM
must load through the webview, not native HTTP. A `vite:preloadError` with
`scheme tauri not supported` indicates an asset-routing failure; reloading the
same bundle does not resolve it.

## External links in the native app

Desktop external links open in the system browser, whether activated by a normal
anchor, a `target="_blank"` anchor, or `window.open(url)`. Native webview navigation
handles this, not a window-level DOM click listener. Each activation should open
exactly once, without replacing the app or creating another app window. Macro app
links (including same-origin popup links) route inside the existing SPA. Standalone
`.html` documents on trusted app origins, such as `/billing-lab.html`, instead open
in a native popup without replacing the app or emitting an SPA navigation event.

Verify the `owner/repo#number` footer link in a pull request's floating details
panel with both a click and keyboard activation. The panel stops click propagation;
that must not prevent the link from opening or dismiss the panel. Also verify a
prevented click does nothing. Browser-only URLs such as `about:blank`, `data:`,
`blob:` and `javascript:` must not launch an external handler. Web browser anchor
behavior is unchanged. iOS/Android retain their existing JS opener fallback because
Tauri's native popup callback is desktop-only.

## Returning from another page

A browser back/forward-cache restore reconnects the GraphQL cache worker and
live subscriptions in place; it must not reload the app or discard in-memory
editor state. For lifecycle verification, navigate to another document and Back,
confirm `pageshow.persisted` is true (otherwise this was a fresh load), then check
that cached reads, live updates, and the existing editor still work. Runnable
queued mutations should resume promptly, without waiting for the old poll or
local retry timer; durable leases and server-retry deadlines still apply.
Switching tabs or navigating an in-app route is not a back/forward-cache restore.

Browser cache ownership prefers a visible tab. When the owner hides, its engine
cooperatively drains and closes storage; if every app tab is hidden, storage parks
without retiring their clients or reloading pages. Background cache work waits.
Returning to any tab opens the same database in a visible owner. A visible owner
is not moved just because another visible window gets focus. Reads can wait for
normal warmup; if foreground handoff/resume exceeds one second, ordinary queries
use network fallback while cache-only reads never forward. Writes and received
mutation confirmations wait for storage instead of being sent twice.

On return, queued commits should produce a coalesced cache refresh, not rebuild
every cache-driven view after each intermediate write. Open Calendar, switch to
an unrelated tab (or fully cover Chrome with another macOS app), let remote
updates arrive, then return and immediately click an event and change the date.
Check that input is handled and the final events appear without repeated chip
rebuilds. Repeat with several hidden Macro tabs. `graphql_cache.change_batch`
reports the number of hints combined; individual commits and mutation replies
remain separate. The backend-free parking regression verifies five queued commits
produce one visible-cache refresh, but real macOS occlusion and calendar input
still need this manual check.

Verify the all-hidden case without activating the former owner: no held physical
owner lock after parking, preserved generation/queue, and successful reads/writes
from a returning tab. Start a query while parked, resume storage from another
tab, and verify that the original query completes—not just a fresh query key.
Replacement must not strand an in-flight query when it invalidates its snapshot;
cache-only reads still never use the network. Also verify a pending HTTP response
settling after parking and multiple surviving clients. A drain that Safari has already suspended still
waits for that worker to resume; no deadline kills it or steals its lock. Lifecycle
telemetry uses `park-started`, `parked`, `unpark-started`, `unpark-completed`, and
`visibility-handoff-*` owner events.

Safari can also restart the SharedWorker when its creating tab closes, leaving
another tab's port alive but its coordinator registrations gone. The surviving
page must re-register without a reload or cache wipe. Open two tabs, close the
first, and verify that cached reads and live updates continue in the second.
Repeat through another handoff and while requests are pending. Interrupted
optimistic enqueues must not be sent twice. A `graphql_cache.owner` event with
`ownerEvent: coordinator-restarted` distinguishes this from engine replacement
or a BFCache restore.

Separately, leaving the creating page while its SharedWorker is still downloading
can fail the survivor before its first ready frame. In an isolated Safari fixture,
hold that download, connect a second page, and navigate the creator through a
normal link. Release the asset and verify the survivor initializes on its bounded
registration retries without a reload. Retries wait 100 ms and 200 ms; navigating
or disposing the survivor during either wait must stop further constructors.
Verify BFCache restoration starts fresh without resurrecting the canceled retry.
Use `graphql_cache.registration_retry` to inspect wait timing and cancellation;
preserve the scope, existing queue, and conservative storage-failure handling.
Do not inject this failure into a live account or mistake it for a repeated-ready
loop.

The same write-safety rule applies when an owner navigates away without restarting
the coordinator: a surviving tab's enqueue may be committed even if its reply was
lost. It must report an uncertain outcome, not retry or fall through to a second
API write. Verify this lost-reply case only with an isolated synthetic fixture,
not by injecting mutation failures into a dev or production account.

## Android system navigation and sharing

In the Android app, Back first hides the keyboard, then dismisses the active
menu/drawer, then offers the press to the active view, then returns through
mobile pane history. Root Back backgrounds the app. A view that claims Back gets
it before history: in the mobile email composer, Back on an edited draft opens
**Draft options** with **Delete Draft** and **Save Draft** rather than leaving,
exactly as the pane's back button does. Check that a canceled predictive Back
gesture leaves the current screen and draft untouched. After changing orientation or window size, focused inputs and
sheet actions should stay above the keyboard without an extra blank keyboard-sized
gap. Font-size and display-size changes should retain the active draft and update
safe areas. Also change display size with the keyboard hidden: bottom composers
must remain visible before the keyboard is opened again. Editors expose labeled
multiline textboxes for TalkBack.

With the keyboard closed, the Android dock sits above the measured system
navigation inset with the usual 12px gutter. Check both gesture and three-button
navigation, including after rotation and display-size changes. Opening the
keyboard leaves only the usual gutter above it. iOS retains its existing 28px
bottom padding with the keyboard closed and 12px with it open.

Sharing text, links, images, or documents from another Android app opens Share to
Macro after login. A second incoming share waits behind the current one. Back or
outside dismissal asks **Discard this share?**; **Keep editing** preserves the
message and attachments. Failed uploads show **Retry** and block Send until they
succeed. Send stays disabled while posting and after success, including when
native queue cleanup fails; retrying cleanup must not post the message again.
Test rapid repeated taps with delayed cleanup and retry after a failed send.
On Android and iOS, if a send finishes after its sheet is canceled, cleanup must
leave any newer share pending with its attachments intact.
**Cancel** explicitly discards the current share. Send
is a real channel/DM mutation: do not use it in verification without authorization.
Android attachment controls open the system picker. File downloads open Android's
Save dialog; image share actions open its share chooser. Canceling either should
return to the existing editor without changing its draft. Large exports show
preparation progress and **Cancel**; a canceled save must not report success.

The native share sheet is shared with iOS. When testing iOS email attachments,
paste an image and select one from Photos: plugins without a native checksum
must hash the staged image bytes, retain the real attachment size, and upload
successfully rather than hashing the empty JavaScript placeholder.

## Direct URLs (all under the frontend origin)

| Route | Surface |
| --- | --- |
| `/app` | Redirects to Home |
| `/app/welcome` | Login page (when unauthenticated) |
| `/app/invite?token=<token>` | GTM invite welcome page ("Welcome, <first name>", Continue → signup). Links come from the staff portal, last 48h, and grant the first month of Premium free once the account is created |
| `/app/internal/invite-links` | Macro staff only (`@macro.com`): create GTM invite links and track opens, signups, and subscriptions |
| `/app/home` | Desktop: Home (notifications + recent activity); mobile: Notifications soup |
| `/app/home/<block-type>/<uuid>` | Home with an item opened inline; `<block-type>` may be an alias such as `task`; a targeted channel message uses `sN.channels.messageId` (and optionally `sN.channels.threadId`) and a document comment `sN.drive.commentId`; a calendar row renders the Calendar view inline at `/app/home/calendar/<month-or-week-or-day>` with the event, occurrence, and locator range in `sN.calendar.*` |
| `/app/mail` | Email client |
| `/app/mail/<uuid>` | Email with a thread opened inline; a targeted message uses `sN.email-detail.messageId` |
| `/app/channels` | Channels list |
| `/app/channels/<uuid>` | Channels with a conversation opened inline; message/thread targets use `sN.channels.messageId` and `sN.channels.threadId`, in the same namespace as the Channels tab |
| `/app/drive` | Files (Drive defaults to My Files) |
| `/app/drive/<recent-or-shared>` | A Drive tab (`/app/drive/tab/<...>` remains a compatibility alias) |
| `/app/drive/folder/<uuid>` | A Drive folder; breadcrumbs resolve from current accessible folder data |
| `/app/drive/<document-type>/<uuid>` | An item opened inline in My Files |
| `/app/drive/folder/<uuid>/<document-type>/<uuid>` | An item opened inline in its Drive folder; document types include `md`, `task`, `skill`, `snippet`, `canvas`, `pdf`, `code`, `csv`, `image`, `video`, `spreadsheet`, and `unknown`. Databases and forms opened from Drive use `database` and `form` |
| `/app/tasks` | Tasks table |
| `/app/tasks/<uuid>` | Tasks with a task document opened inline |
| `/app/agents` | AI chats / agents list |
| `/app/tasks/projects` | Projects collection inside Tasks (requires the Projects flag) |
| `/app/tasks/projects/<uuid>/overview` | Project detail in Tasks, with breadcrumbs, properties, description, and discussions; replace `overview` with `tasks` for the task list |
| `/app/component/project-compose` | Native project composer, sharing the task composer layout and property controls |
| `/app/component/new-project` | Alias for the project composer; existing links remain valid |
| `/app/initiative/<uuid>` | Shared project link; opens the project in Tasks |
| `/app/component/initiative-view~<uuid>~overview` | Compatibility link that opens the project in Tasks |
| `/app/agents/<uuid>` | Chat agent session with the Agents sidebar |
| `/app/coders/<uuid>` | Code session with the Agents sidebar |
| `/app/agents/chat/<uuid>` | Legacy AI chat opened in the Agents workspace (`/app/agent-chats/<uuid>` remains a compatibility alias) |
| `/app/calls` | Calls list |
| `/app/companies` | Customers (CRM; needs a team). The selected list is `sN.crm.tab` |
| `/app/companies/<company-or-contact>/<uuid>` | Customers with a company or contact opened inline, keeping its list's `sN.crm.tab`; a record tab other than Overview adds `/<team-emails-files-tasks-or-calls>`. On desktop, `/app/company/<uuid>` and `/app/contact/<uuid>` redirect here, a `comment_id` moving to `sN.crm-record.commentId`; touch devices keep those standalone pages |
| `/app/companies/pipeline/<uuid>` | Customers on a pipeline; `/<company-or-contact>/<uuid>` after it opens a record from the pipeline. `/app/pipeline/<uuid>` redirects here |
| `/app/activity` | Activity heatmap + feed |
| `/app/calendar/<month-or-week-or-day>` | Calendar; the focused event, its occurrence, and the locator range use `sN.calendar.*` |
| `/app/calendar` | Redirects to `/app/calendar/<month-or-week-or-day>` at the remembered period (Day on phones and Week on desktop by default), keeping an `eventId` |
| `/app/scheduling` | Scheduling workspace: booking links, availability, bookings, insights, and booking page |
| `/app/external` | External: link a personal WhatsApp account and adopt independently shared WhatsApp groups (requires the `enable-whatsapp-linked` flag; see [External](external.md)) |
| `/app/<document-type>/<uuid>` | Legacy document URL (including `md`, `pdf`, `canvas`, `spreadsheet`, and the other Drive document types); redirects to `/app/drive/<document-type>/<uuid>` |
| `/app/database/<uuid>` | A database with table and board views (requires the Databases flag). Links and opens outside Drive stay at this URL; opened from Drive, it shows inline at `/app/drive/database/<uuid>` |
| `/app/documents`, `/app/files` | Legacy Files views; redirect to `/app/drive` |
| `/app/chat/<uuid>` | A standalone AI chat |
| `/app/routines` | Routines list in the Agents workspace |
| `/app/routines/new` | Opens the routine creation modal |
| `/app/routines/<uuid>` | Routine settings, triggers, and run history in the Agents workspace |
| `/app/agent/<uuid>` | An agent session (opened from `@macro` under the agents rollout, or `@coder` / `@cursor`) |
| `/app/md/<doc>/chat/<chat>` | Doc + doc-scoped chat in a split |
| `/app/md/<doc>/channel/<channel>` | Doc + channel in a split |
| `/app/settings/account` | Settings (also `/app/settings/api-keys`, `/mcp-server`, `/shortcuts`, etc.) |
| `/app/debug/ui?ui=invert-util` | UI gallery, including the inverted Markdown demo on the InvertUtil page |
| `/app/debug/create-menu-demo` | Inline create-menu comparison: classic list, minimal carousel, and details on the left. Each has independent search and selection; choosing an item only updates the preview status and creates no data. |
| `/app/debug/<component>` | Registered debug views (for example `icon-gallery`, `md`, or `agent-ui`); existing environment gates apply. `/app/component/<component>` remains a compatibility alias for these views |

Each `~`-separated part of an app URL is a split (`/app/home/~/drive`). The
pages outside the app (`/app/login`, `/app/welcome`, `/app/signup`,
`/app/onboarding`, `/app/setup`, the invite pages, `/app/meet/...` and
`/app/task-slug/...`) render without the split layout and take one part only.
`/app/login/~/home` and URLs nothing matches, such as `/app/garbage`, are
replaced with `/app`, which goes to Home or to login. An unknown split among app
splits (`/app/mail/~/garbage`) shows the in-split 404 instead. A split that
navigates to a page outside the app replaces every split; Back restores them.

Search-result locations use pane-local namespaces: `channels` (message/thread),
`email-detail` (message), `markdown-detail` (node), `pdf-detail` (page and highlight
context), `agent-detail` (turn/author), and `call-detail` (transcript segment).
A `seek` value identifies each click so selecting the same hit again scrolls again.
Markdown and PDF targets also name their document so navigation to another file in
the same workspace cannot apply the previous file's target.
Channel-message @mentions and AI-generated channel mentions also preserve their
message/thread target when opening a channel or reusing its existing pane.
Returning to Home's list clears the prior target, so reopening an item without
a specific location does not replay the previous search hit.

Email snooze notifications and copied links target the original email
conversation. The **Reminders** collection is a tab inside Email; standalone
reminder routes and the former Home reminder detail route are removed.

When an event opens inline from Home, changing the Calendar period stays under
`/app/home/calendar/`, updates the period segment, and re-focuses that event.
Back/Forward restores the period and its event locator from `sN.calendar.*`.
While Home's own calendar is open, a Home calendar row (a reminder, a join
request, or any event) re-aims it in place, even when Calendar is also open in
another split, as Home's preview does for a document it already shows. When
Home shows its list or another item and Calendar is open in another split, the
row retargets that split instead: a click or Enter also focuses it, and
arrow-key browsing moves it without taking focus from the list. Shift-click
keeps reusing that split, as the notifications panel does.

Home uses the shared channel and file details for channel conversations and
supported documents, with a **Home** breadcrumb that returns to the list. A
channel message or thread target stays in its conversation. Document comment
targets, spreadsheets, unknown items, and other unsupported block types retain
the legacy inline preview so their navigation still works. The URL shape stays
`/app/home/<block-type>/<uuid>` in either rendering mode.

Desktop Home names a document comment event only when it is the latest
outstanding notification and is at least as recent as the activity that placed
the row there. Newer own activity, or an event without a supported comment
description, shows the document/task title and opens the entity without a
comment target. Older notifications retain their unread state and remain
available to notification actions.

On touch devices, documents (including tasks) open in legacy blocks rather than
inline Drive details. Canonical `/app/drive/.../<document-type>/<uuid>` links also
fall back to legacy document routes. This uses touch detection, not the native-app
check: in DevTools, enable touch emulation rather than only narrowing the viewport.
Legacy document URLs upgrade to Drive only when desktop detail rendering is enabled.

The outer navigation rail uses 20px icons in 40px buttons with 4px gaps.
Command and create-menu headers have 20px horizontal and 12px vertical padding.

Splits: the app is a tiling window manager. Active light-theme panes are white;
inactive desktop panes are slightly darker than the active pane across themes,
while retaining the theme hue. Public variable-length routes use
`~` as the boundary between panes
(`/app/drive/folder/<uuid>/~/mail`). Legacy fixed `type/id`
pane routes remain accepted. Known app-view URLs under `/app/component/` redirect
to their canonical paths above; legacy composers keep their existing paths. Split-specific view state uses positionally
namespaced query parameters such as `s0.drive.sort=created_at`. Route identity
and breadcrumb nesting remain in the path. Home, Email, Tasks, Channels, and
Customers store the selected tab under `sN.home.tab`, `sN.mail.tab`,
`sN.tasks.tab`, `sN.channels.tab`, and `sN.crm.tab`. Customers uses `people`,
`list:<uuid>`, or `hidden`; a pipeline is a path instead. Companies is the
default and omits the key. Omitted tab keys mean each view's default. Mobile Channels always opens its
Recent conversation feed and ignores legacy mobile-tab selections.
Changing tabs updates the URL, and browser Back and Forward restore the
selection independently in each pane. Inline detail links preserve these keys.
Desktop panes expose Close when available and omit split-history back/forward
buttons. Mobile content panes retain their back button; Scheduling omits it in
favor of its owner and view-navigation islands, except while creating or editing
a schedule: a separate **Back to availability** pill sits beside the editor
title, matching other mobile routes.

Projects are enabled by default in development; production uses the PostHog
`enable-projects` flag. `VITE_ENABLE_PROJECTS` overrides either environment.
When disabled, project navigation,
creation, assignment, chips, and Cmd+K results are hidden; direct project links
return to Tasks after flags resolve. Existing Files folders stay available.

Projects open as native detail views within Tasks, preserving its sidebar and
shared breadcrumb navigation. The Projects breadcrumb returns to the same list,
filters, groups, and scroll position. Opening a task from a project extends the
trail so the project remains a return destination. The standard side-panel
toggle shows project properties. Their URLs preserve the selected section on reload;
discussion links append `~<message-uuid>` to the project's `overview` route.
Existing `activity` routes open Overview, preserving a target message when present.
Cmd+K includes a Projects category, authorized project search results, and
`New project`. Selecting a project opens its overview; Shift-selection opens a
new split. The global Create menu also offers `Project` (C, then P), including
the full mobile Create sheet. Project opens the same popover host as task creation: a dialog
on desktop and a bottom drawer on touch. It keeps focus in the project-name
input, and `Continue editing in split` transfers the current draft. Existing
folders remain available in Files search.

The app views are referred to as **workspaces**. Expanded workspace sidebars start
at the shared 256px width; manual resizing and narrow layouts can change the
displayed width. Workspace navigation uses shared 32px rows (44px on touch), 16px
glyphs in aligned 20px icon slots, a 6px text gap, and compact sentence-case section
headings. Tags and folders have a separate disclosure button on the **right** of
the row: clicking the label selects the destination; clicking Expand/Collapse
only opens or closes its children. Selecting a Drive folder or tab closes an
inline detail into that destination; it does not navigate back to Drive's root.
Drive's **New** menu (in the sidebar and after the header's Sort and Filter
buttons; beside the title in narrow layouts) is headed
**Create in &lt;folder&gt;** and creates everything in the open folder; on a tab or
the Drive root it reads **Create in Drive**. **Folder** opens a **New folder**
dialog with `Untitled folder` preselected; creating keeps Drive where it is, adds
the folder to the open folder's list, and shows a toast with **Open**. Every other
item opens as an inline detail in the open folder or tab once created
(`/app/drive/folder/<uuid>/spreadsheet/<uuid>`, `/app/drive/database/<uuid>`),
the same as opening an existing file: the Drive sidebar stays mounted and no
loading pane replaces Drive. Databases and forms opened from Drive's list or
favorites show inline the same way. **Database** and **Form** are offered only
outside folders.
Home, Email, Tasks, Channels, and Drive keep their workspace provider mounted
while typed child routes own the accepted inline detail. Tasks and Email replace
the list with detail, capturing its focus and scroll state before disposal. Their child
selection participates in browser Back/Forward independently per pane. Explicit
return controls navigate to the workspace's list root. Multiple panes navigate
their child routes and history independently; returning to a list does not
activate another pane. Opening a resource already displayed in another pane
activates its owner through router claim arbitration, preserves the owner's route,
and applies compatible search targets to that pane. The compatibility preview
guard can instead reject a conflicting embedded preview. On touch, Home, Email,
Tasks, and Channels detail URLs fall back to the existing full-block surface.
Legacy email
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
document, email, or conversation is open. Home's filter sits in the right group,
before search and **Hide navigation**.
A desktop view's name opens the view switcher: clicking it shows the rail's apps
in rail order, then the More apps, with a check on the current one. Choosing one
replaces the view in that split, not the active split; Shift opens it in a new
split. The navigation panel's title shows the name with a caret, sharing one
hover background. Main headers show the name alone, with the same hover:
`ViewSidebar.Title caret={false}` for plain titles, and the first breadcrumb
(Drive, Email, Tasks, Reviews) while it is the current page; deeper, that crumb
returns to the list. Titles that name content rather than the view (Calendar's
date, a channel, an agent session, a CRM record) do not switch views. Touch
devices show plain names and keep the dock.
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
Shrinking again starts with the overlay closed. Chat is the exception while no
conversation is selected: its navigation stays docked with no **Hide
navigation** control, and narrow Chat opens the overlay on its own (see
[Chat navigation rail](channels.md#chat-navigation-rail)).
Settings navigation always stays docked at desktop width with no **Hide
navigation** control; only its narrow overlay opens and closes.
The overlay never contains the split's **Close** button. Mobile keeps
its existing navigation controls. Block detail panels (including Calendar) have
**Hide side panel** in their own header and a hamburger **Show side panel** beside
the main title when hidden, with separate preferences per block type.

Desktop splits, including a single split in the browser or native app, appear as
individually bordered panels with 8px corners and 6px top, right, and bottom
insets and 6px resizable gaps. The leftmost panel sits flush against the app rail,
which has no right divider. Touch layouts keep their existing presentation.

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

The outer sidebar is an icon rail; labels appear in tooltips.

Open **More → Customize sidebar** to show, hide, or reorder available apps.
On desktop, drag an app by its **Reorder <name>** handle; Up/Down on the focused
handle also moves it. Touch devices offer move buttons. Home stays first and
cannot be hidden. Verify that hovering within a destination row keeps the drag
preview stable, dropping saves the order, and reopening retains it. In short
desktop windows, the app list scrolls while More and the footer remain reachable.
Touch devices retain the flag-gated Reviews tab in Tasks.
Scheduling appears in Customize sidebar only when the calendar-scheduling flag is
on. It starts hidden in More, including for existing sidebar preferences. Enable
its checkbox to place it on the rail, then reorder or hide it like other apps.
Showing Scheduling removes its duplicate from More; the choice survives reload.
Activity appears in Customize sidebar only when the `enable-activity-feed` flag
is on and, like Scheduling, starts hidden in More (also for existing preferences)
until enabled on the rail.
External (plug icon, `g x`) appears on the rail only with the
`enable-whatsapp-linked` flag; it starts shown and can be hidden like other apps.

- Top: buttons `Create` and `Search`. Clicking `Search` opens a menu
  with `Command Menu` (⌘K on Mac / Ctrl+K elsewhere) and `Search everything`
  (`/`). Choose the first to open commands, or the second to open and focus
  global search. Hold Shift while selecting `Search everything` to open it in a
  new split, including when Search is already active. This left-click menu shares
  its surface and item styling with the sidebar right-click menus.
- Nav: `Home`, `Drive`, `Email`, `Chat`, `Tasks`, `Calendar`,
  `Agents`, `Customers`. Calendar and Customers appear only when
  their features are enabled. Calendar shows a next-meeting badge (`Now`, or
  minutes under an hour away) unless **Next meeting countdown** is off in
  **Settings → Calendar**.
- Bottom: `Settings` (`Ctrl ;`) — a gear with the signed-in account's profile
  photo as a badge in its corner. It opens Settings directly in the active
  split (Shift-click for a new split); there is no account menu. Log out lives
  on **Settings → Account**, and the command menu is `Ctrl K`.

The rail highlights the workspace shown by the **active split**, not every app
named in the multi-split URL. Nested details keep their owning workspace selected
(for example, a thread under Email or a document under Home). Selection changes
when navigation commits; a pending preload or a refused leave guard does not
select a destination that is not shown. Pressing the current workspace preserves
its filters and nested detail; during a pending navigation, the same press
cancels that navigation without adding a duplicate history step.
A later ordinary rail press also cancels a new split still preloading from the
active split's earlier Shift-press. Already-open splits and pending work from
other splits remain intact.

Ordinary rail, More-menu, and Go To shortcut navigation resumes opted-in apps'
last locations during the current session, including nested details, tabs,
filters, and local state registered with the split entry (such as scroll or
selection). Views opt in with `useViewRestoration()`; views without the hook keep
ordinary navigation behavior. The mobile dock uses the same memory; Search taps
still start a fresh search. Memory is account-scoped and clears on reload,
sign-out, or account changes. A leave guard stages each snapshot, but only a
committed navigation saves it; refusal, cancellation, failure, and supersession
leave the saved snapshot unchanged. Direct links and explicit Shift/open-in-split
actions keep their requested destination. Closing a detail before switching apps
remembers the list, not the closed detail. Views unmount normally; this is not a
keep-alive cache for editors or other transient UI.
Verify Chat → open channel → Calendar → Chat restores the same channel, then
repeat with a filtered list and a nested Drive item. Check mobile dock switching,
split Back/Forward, refused leave guards, explicit links, and account changes.
Verify rapid app presses, returning to the currently shown app while another app
loads, split focus changes, closing a split, and split Back/Forward. The last
requested destination must win, and a later return to an earlier view must not
revive an old highlight.

Start a new AI chat from the Agents workspace; the rail has no separate
new-chat-in-a-new-split button. Its tooltips
use the standard 400 ms hover delay and 300 ms grace period between items. Home,
Email, and Chat show a small accent dot when the loaded data contains an unread
item. Home uses Signal; Email uses Important across all linked inboxes.
Noise does not light either dot. These are presence indicators, not counts; they
do not fetch additional pages to find every unread item. With GraphQL enabled,
Home uses `HomeUnreadPresence` over its existing 100-item Signal/unread candidate
page, with one state-only notification witness per entity (plus one reminder
witness for email). It must not fetch full notification history just to draw the
dot. Channel/thread scoping happens before the witness limit; seen thread reasons
still affect that scoping. Reading or completing a witness refreshes the bounded
edge so an older unread item can keep the dot lit. These witnesses must never be
used as the complete mark-read/done input. The experimental notification-time
sort remains on its existing REST path; disabling GraphQL or enabling that sort
must not construct an unsupported GraphQL input or blank the app shell.
Cold offline launch must retain navigation even while notification preferences
or badge queries are pending. Unknown preferences use the default enabled
behavior; loaded disabled preferences still suppress Email's dot, including
after a failed refresh. Verify both unreachable services while the OS reports
online and a paused offline transport, then reconnect without remounting chrome.
Opening a view alone does not clear its dot — reading or completing the represented
items does. The button's
accessible description is `Unread items` while its dot is active.
The Home dot stops checking rows at the first eligible unread item, using the
same Signal membership, channel/thread scoping, and local read/done overrides as
the list. Check that reading that item keeps the dot lit if another loaded row
is unread, and that completing the last one clears it. Query bounds and
pagination are unchanged.

The Agents sidebar opens with a **Work** / **Code** switch (radio group
"Agents mode") under New, using the shared pill tabs on desktop; touch keeps
its existing tabs. Work is the default and the choice is remembered
per user across reloads. Work lists chat sessions and legacy chats; Code lists
coding sessions only, newest first. Each mode's empty state is its own ("No
conversations yet." / "No coding conversations yet."). Opening a session of the
other kind from outside Agents (a link, Home, Ask AI) switches the mode to match;
switching modes while a session is open returns to that mode's New conversation.
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
Use **Search conversations** beside the sidebar collapse icon to open a search
field above New and filter by title.
Results stay packed at the top with compact spacing, even with only a few matches;
clearing the search restores the list.
Its **New conversation** button opens the composer for the current mode with one
**Agent** selector on the right. In Work the selector lists Macro's models and
chat agents, and the composer stays on one line. In Code it lists coding agents
only, the composer opens expanded with the repository drawer below it, and the
greeting reads "What should we build?". New sessions use the selected agent's
default model and the URL for its kind. Home keeps its usual agent composer.
Opening an existing row restores its own kind and URL.
Right-click a conversation for Rename, Favorite, Copy link, Share, Delete, and
the other entity actions used on Home.

Desktop inner sidebars place the same full-width, outlined **New** pill directly
below the title. List toolbars use its compact version, including when the
sidebar is hidden. Email, Drive, Tasks, and the Projects list use one desktop
row: title, filter controls, view options, New, and Search. Filter and view
controls use the rounded, bordered button groups from the email thread toolbar;
New and Search have their own rounded, bordered backgrounds. Search starts as an
icon and expands into a compact field when clicked or opened with Cmd/Ctrl+F.
Closing it clears the query and returns to the icon. The action stays specific to
the view: Home returns to its starting pane, Email composes mail, Chat offers a
channel or direct message, and Calendar offers an event or call. Tasks offers
**Task**, **Project** (when enabled), and **Tag** in both the Tasks and Projects
lists. Customers offers Company, Contact, and enabled Pipeline creation. Reviews
uses the general creation menu. Agents keeps New above its Chat/Code mode tabs.
Each desktop sidebar puts its Search icon immediately left of the collapse
control. Click it to reveal the view's search field between the title and New,
at the same height as the New button; click again to hide it. The field focuses when opened. Existing list-toolbar
search remains available and shares its query where the view filters a list.
Mobile creation controls, search controls, and placement are unchanged.
When multiple desktop splits are open, a **Close** (X) button appears in the
sidebar title bar and closes that split, including
when the sidebar is an overlay in a narrow split. Verify with three splits:
open **Show navigation**, then use the sidebar's **Close** button without first
hiding navigation; only its owning split closes. The last logical split has no
sidebar close button; mobile chrome is unchanged.
A lone non-list content split still shows a header X labeled **Return to list**,
which returns that split to the most recent list in its history, preserving
that list’s state. If there is no prior list, it replaces the current entry with
Home. Excluded background panels do not count toward close eligibility.
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

Split handles apply pointer movement once per animation frame and commit the
final position on release. Check a rapid drag followed by immediate release,
dragging at non-default zoom, and closing a split during a drag; later pointer
movement must not keep resizing the removed split. Arrow keys still resize
immediately, with Shift selecting the larger step.

Email, Tasks, and Agents use the same sidebar rows, including favorites, tags,
inboxes, and recent agent chats: 32px high on desktop and 44px on touch devices,
with regular-weight labels and consistent icon spacing.

Entity rows and navigation use Phosphor icons. Entity icons share one mapping
across lists, previews, and drag images, with regular and bold weights. Read email
uses an open envelope, calendar invitations use a calendar, and pull requests
retain their open/merged/closed glyphs and status colors. Direct messages may
show the other participant's avatar instead of a glyph.

### Universal Input in Command K and mobile Search

Home keeps its usual agent or classic chat composer and suggestions.
PostHog **enable-universal-input** is the only control for Universal Input in
Command K and mobile Search. When enabled, the composer is available immediately;
there is no Settings page, account-domain restriction, or saved opt-out.
Development/local builds enable the flag by default. Use
`VITE_ENABLE_UNIVERSAL_INPUT` for a local override; deployed builds follow PostHog.

Command K’s Lexical input supports rich text and **@** mentions; there are no formatting
or mention instruction cues and no Suggestions list beneath it.
Type directly; predictions refresh while typing, at most once every 200 ms with
separate classification and field-extraction queues. Each queue keeps one request
in flight and coalesces updates to the latest text; field extraction never blocks
type prediction. The classifier chooses a form; extraction supplies its addressing
and outgoing body. It recognizes AI, global Macro search, email,
Markdown note, task, calendar event, or message/DM. The main editor keeps focus
while editable fields appear below it. **Content type** defaults to **Auto**;
the strongest candidate starts a draft even when the scores are close. Field
extraction uses Cloudflare Clairic when its Workers AI account/token are configured,
with Nemotron as the fallback for missing configuration, provider errors, timeouts,
or unusable results. Clairic selects text from the draft; it does not rewrite prose.
Nemotron separately extracts structured temporal expressions and exact source
spans for tasks and events. Rust resolves these against the request time and
timezone, including this/next calendar-week semantics. Only complete, valid suggestions enter the editable form.
Absent Clairic values remain empty; uncertain nonempty values and outgoing body
spans that end early use the existing fallback. Manual edits retain precedence.
Bug reports and prioritized problems count as tasks. **Cmd/Ctrl+Shift+Right** cycles through
types in likelihood order; **Cmd/Ctrl+Shift+Left** cycles backward. The icon and
type pill opens **Content type**; there is no Next type button. Choosing a type, cycling, or editing a field locks the type.
Opening action words (message, task, search/find, email, note, schedule/calendar,
ask/agent) strongly guide model classification; the body topic does not override
the requested action. This remains model interpretation, without a local prefix
parser. Open-ended questions, including internal history such as when we last
deployed, go to an agent unless search results are explicitly requested.
Completed predictions interpret the full draft: bare bug reports and
“Find and fix notification bug” can become tasks. Manual type choices and field
edits still lock the type. Addressing distinguishes the channel from actionable text
in its body. For example, “email julia” followed by “can we reschedule the thing
tomorrow? let the investors know” prepares an email to Julia with that outgoing
body. “Remind me to email Julia tomorrow” prepares a task instead.
Email mode offers **Save as draft** beside **Send email**. Typing and prediction
only update the open menu’s transient draft; they do not create email-service drafts.
**Save as draft** explicitly saves the visible email without sending it, including
unfinished emails with no subject, body, or recipients. Any supplied recipient
must resolve to an email address, and a connected inbox is required. A successful
save closes the menu and opens the saved draft when available; a
failed save preserves the input. **Cmd/Ctrl+Enter** continues to send the email.
Search mode embeds Global Search's editor, Type/In/From filter chips, and
result rows with highlighted message snippets. Extraction first selects the search
type, then uses its schema: Channels has In/From; Tasks has status, priority,
assignees and creators; Calls has In/From/attendance; Email has importance and
connected inboxes. Other types extract keywords. Task assignees and creators are
distinct, and unsupported filter wording (including tags) remains in the keyword
query. A manually chosen search Type fixes the schema for later predictions.
Results wait for extraction; no local language parser strips commands or filter clauses. For example, “search messages from Julia in #sales about budget”
selects **Type: Channels**, resolves Julia through the people directory, selects
**In: sales**, and searches for “budget”. Names must resolve uniquely; unresolved
people or channels pause search until corrected in the filter pickers. Use
**Only** to replace an unresolved name with a specific person or channel. The
pickers include the full channel and DM directory. The model distinguishes
explicit filters from ordinary “from”/“in” phrases within search keywords.
Filter-only requests such as “search channels for messages from user@example.com”
leave **Search for** empty; category and sender wording is consumed by the filters.
Adding “about budget” searches for only “budget”.

Editing **Search for** or changing the filter chips overrides subsequent
predictions for those values. Sender-only message scopes and speaker-only call
scopes keep their filters visible and request at least three search characters:
channel/call browsing cannot enforce those message-level filters. No unfiltered
browse results appear while keywords are required. **Search Macro** or
**Cmd/Ctrl+Enter** opens Global Search with the same query and complete filters,
including when the Search view is already open. If extraction fails, results and
submission pause until both **Search for** and the filter selection are explicitly
edited, so a provider failure cannot silently broaden the search.

Click a result or message snippet to open its actual location, or use **Up/Down**
and then **Enter**. Keyboard selection scrolls into view while the editor keeps
focus. **Shift+Enter** always inserts a newline in the Command K main input,
including before Universal Input activates and when Shift is released before
Enter; neither key release opens the selected result. Multiline input hides the
Macro logo and removes its reserved spacing so text uses the full width. **Escape** exits
result navigation; a second Escape closes the menu. The content type selector
uses the shared styled dropdown with a selection checkmark and platform-specific
shortcut tooltip. Search navigation and type cycling use the app's scoped
hotkey manager; inline editor menus take precedence.

Notes use the document composer's rich title, **Note body**, slash commands,
and tag picker below the main input. Note creation saves the visible body and
selected tags; manual edits, formatting, and tags survive later predictions within the open menu.
Messages use the channel composer's rich editor and recipient chips. There is
no formatting button or toolbar row; keyboard formatting remains available. Choose existing people or one channel; external email addresses are for
email mode. Authored mentions are included when sending a message.
AI uses the existing agent/model picker, including connection and agent creation
entries; the main Universal Input remains its prompt.
The model picker supports searching on desktop and touch layouts. Escape closes
the picker while keeping Command K and its prompt open.
Task extraction waits for the field catalog before sending available names/options;
classification continues independently while it loads. Task creation uses those
definitions to retain all selected assignees. Explicit priority,
status, assignees, project, and other supported task properties populate their
pills rather than remaining as metadata lines in the description. For example,
“notification click not going to target … priority urgent” displays **Urgent**.
Unresolved or ambiguous values require a choice; manual property edits survive
later predictions. Task fields stay in sync as typing continues.
Select **Auto** to resume detection; manually edited fields remain yours.

**Enter** inserts a newline. **Cmd/Ctrl+Enter** or the labeled action button
submits only the currently displayed, complete action. There is no queued send
while inference is pending. Email and message modes show their outgoing body
and resolved recipients. Email uses the Email Composer's inbox picker, recipient
chips with address completion, separate Cc/Bcc controls, subject control, rich Markdown editor, and HTML
preparation for delivery. Task creation uses the task composer's rich title,
Markdown description, and editable property pills, including Due date.
Calendar uses the event composer's date/time popovers and calendar, guest, and
location and recurrence pills, including the shared custom recurrence builder.
Manual recurrence choices, including Does not repeat, survive later predictions.
All these controls preserve manual edits during inference.
The submit shortcut is shown beside the
action label in its button. Ambiguous names require a specific selection. Calendar
shows the absolute date, time, timezone, calendar, and invitees. For example,
“Call John at 3pm tomorrow” becomes a one-hour event at 3 PM tomorrow with no
invitation; inviting John requires an explicit invitation request or guest edit.
Bare hours use a reasonable default (1–7 PM, 8–11 AM, 12 noon). For example,
“call with Julia tomorrow at 7” becomes 7 PM tomorrow for one hour. An assumption
cue beneath the date/time range draws attention to the inferred AM/PM; editing the start
time removes that cue. The temporal model identifies clock facts, explicit AM/PM and day parts;
Rust resolves them, marks assumed AM/PM, validates timestamps and supplies
a one-hour end when absent. Explicit equal or reversed ends remain unresolved. Extraction suggestions remain
editable and require review, particularly when using the preview Clairic model.
This flow creates new emails/events/tasks; replying, forwarding and updating
existing entities remain follow-up scope.
Relative starts such as “in 30 minutes” do not set the event's duration;
“in 30 minutes for 15 minutes” creates a 15-minute event. An ISO date such as
“2026-10-10 at 7pm” still uses the default one-hour duration.

Drafts are transient for the lifetime of the open Command K menu. Failed
inference allows manual type selection and field entry; failed submission keeps
the open draft. Closing the menu discards it. Successful actions close the menu;
reopening starts with a blank query. AI and search navigate immediately. Attached
AI context must be removed before submitting another type. Home, Agents, and
mobile Home retain their usual composers and navigation behavior. Browser
fixtures use recording-only writes; real email/message buttons send to the
displayed recipients.
If email has no connected account or Event has no writable calendar, **Connect
Google** opens Google's consent flow for Gmail and calendar access together.
Complete consent in the Google browser page, then reopen Command K to compose.

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

Use an entity's command/context menu to add or remove it from Favorites. Documents, chats,
agent sessions, projects, email threads, channels, calls, CRM companies, CRM contacts,
databases, and forms support toggling; database and form favorites appear in Drive's
sidebar. Individual channel messages and pull requests are not favoritable. A
favorited agent session disappears from the list once the session is deleted.

With the GraphQL local cache enabled, cached favorites remain visible when offline
or when a background refresh fails. Toggle and reorder success while offline means
the change was accepted into the durable queue, not yet confirmed by the server.
Removing then re-adding an item appends it to the end; those operations are replayed
in order. A newer queued reorder replaces an older queued reorder. Server-rejected
changes roll back rather than becoming committed local favorites.

## Create menu

On desktop, the rail **Create** button, **C**, and the command menu’s **Create**
entry open the detailed launcher at standard dialog width. Selecting **Create**
closes the command menu and hands focus to the launcher; individual creation
commands remain searchable in the command menu. The left side is one continuous
list without section labels or gaps. Up to three recently used choices appear
first, followed by the remaining choices in this order: **Docs** (Document, Snippet), **Organization**
(Folder), **Design** (Canvas, Design, Photoshop file, Illustrator file), **Data**
(Database, Spreadsheet, Form), **Comms** (Email, Message, Channel, Call), **Tasks**
(Task, Project, Reminder), **AI** (Agent, Routine, Skill), and **Other** (Code and
any uncategorized entries). Only available entries appear.
Recent items appear only at the top, not again in their categories. With no
history, the list starts with Document. Hover or keyboard navigation updates the right detail panel;
click a row or press Enter to start that creation flow. List icons are monochrome:
muted normally and full ink on the selected row. The detail panel centers
its block-colored icon tile with a solid theme-aware fill and shared glass rim,
and description over
the shared onboarding grain. Light mode uses near-black icons and neutral, quieter grain and glow, with
the homepage composer’s fill, border and shadow. Dark-mode dots and glow use
the same shared block-icon color as the tile, rather than the workspace accent. Descriptions use two authored
lines at desktop width, with a slightly shorter second line; narrow panels
allow the text to wrap further. The **Create [type]** button
sits 8px inside the bottom-right corner as a 32px-tall pill. Its 16px
radius plus the inset matches the modal’s 24px radius. It uses
a white fill in dark mode, black in light mode, medium-weight text, and a bare
Enter symbol without a keycap. Footer keyboard hints are borderless.
Visual references: [dark](media/command/create-menu-polished-dark.png) and
[light](media/command/create-menu-polished-light.png).
A vertical divider separates it from the list. In direct shortcut mode, the
shortcut sequence (such as **C then T** for Task) appears below the centered
detail content. The Create button includes the Enter shortcut. Holding Shift
relabels the button **Create in new split** with Shift+Enter; clicking while
holding Shift uses the same new-split behavior where supported.

The **Search mode** toggle (or **/**) switches between direct entity shortcuts
shown beside each choice and the standard create search input. Search mode is
the default; the preference persists across opens. Search filters both Recents
and categories; a recent choice appears only under Recents, not again in its
category. Up/Down moves through the displayed order and scrolls the selected row into view; Left/Right
edits the search input. Enter creates the selected item, Shift+Enter opens it in a
new split where supported, and Escape closes the launcher. Typing in search mode
never runs an entity shortcut. Switching modes preserves selection and dimensions.

The detailed layout replaces the old desktop launcher, including the onboarding
Create lesson. The PostHog flag `enable-carousel-create-menu` opts into the
carousel instead; when off, unknown, or loading, the detailed layout is used.
For local testing, set `VITE_ENABLE_CAROUSEL_CREATE_MENU=true` (or `false` to force
the detailed layout). The carousel shares creation actions, recents ordering,
search mode, and shortcuts; Left/Right also navigates its cards outside search.
The inline `/app/debug/create-menu-demo` keeps all three layouts for comparison
without creating data. Mobile continues to use its create sheet.

On mobile, the bottom dock defaults to Notifications, Calendar, Email, Channels,
Agents, Files, Tasks, Calls, Customers, Reviews, Scheduling,
and External. Feature-gated views
appear only when enabled. The navigation island measures its width and fits as
many fixed-size app buttons as possible, reserving room for More. Search stays
in its own island at the right edge and opens the persistent Search… input and
entity category pills (see [Search](search.md)). Once every view fits, the
navigation island stops growing.

Notifications, Email, and Channels use the same reactive unread-presence checks
as the desktop sidebar, via `useNavigationUnread`. Their accent dots clear when
the represented items are read or completed, not merely when opening a view.
Overflow destinations keep their dots in More; More itself has a dot when any
hidden destination is unread. Resizing or reordering moves the indicator with
its destination. These remain presence indicators, with no extra pagination.

Open **More views → Customize dock** to change the order. Drag a row's handle immediately,
without holding first, and move it across the **In dock** / **In More** boundary. The counts use the
same live measurement as the dock and update on resize or rotation. Swiping
elsewhere on a row scrolls normally; dragging a handle scrolls at the list's
edges. Neighboring rows slide into their new positions during a drag, with
reduced motion respected. A tap or small finger movement leaves the order unchanged.
Keyboard users can focus a handle and press Up/Down; Escape during a drag
cancels it. Changes save immediately per user on this device and survive reload.
Search and More stay fixed. Settings and Customize dock stay in More, followed
by overflow destinations in their saved order. **Back to More views** returns to
the menu; **Done** closes the drawer.

Reviews and Scheduling can be moved into the dock when enabled. Scheduling
opens `/app/scheduling`, highlights while active, and uses header islands for its
section and Personal/team owner drawers; it does not add a search-scope pill.

Dock navigation, Search, filter pills, and create-menu taps do not trigger
haptics. Buttons activate on click/release. Holding a button only shows its
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
request a specific section open that section
directly in the sheet without replacing the current view or changing its URL.
If a requested section is unavailable, the sheet shows an unavailable message
and a **Back to settings** button that returns to the grouped main page.

CRM Companies and People are list-only on every device. The mobile
**+ Company** button opens the company-creation sheet.

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
show **+ New** for that full menu. Only Agents has the floating AI composer,
which fills the row with no duplicate create action. Other views keep their
right-aligned New button without an AI input. The row
hides during search, when a page supplies its own reply or compose controls
(including the full-screen new-email composer, whose send actions sit in its
header), or when an editable field outside Ask AI is focused on a touch device. The AI draft
is preserved when the row returns.
The New button also hides while the software keyboard is open.
After closing mobile search with the keyboard open or leaving a focused editor,
verify that the current view’s New action returns once the keyboard closes.
Removing the focused editor must not leave the action hidden on subsequent views.

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
on desktop, including task, project, calendar event, skill, and agent session composers.

Hovering an `@user` mention or a profile picture on desktop opens the user card:
the person's name and email above Copy email, Copy name, Open contact (CRM teams
only), DM, and Assign task. Touch devices have no hover, so tapping the mention
or the picture opens that same card as a bottom sheet; any action there runs and
dismisses the sheet. Desktop keeps click-to-DM on the picture itself, which touch
drops in favour of the card's DM action.

`Create` button (top-left) opens a menu of: Email E, Routine U, Agent A, Skill K,
Document D, Task T, Project P, Snippet S, Message M, Channel G, Call C, Canvas N, Folder F, Code O.
Document navigates straight into a new doc; Task, Project, and Channel open dialogs.
When calls are enabled, `C C` (Create → Call) opens `/app/meet/new`. The call is
created only after `Start call`; Escape closes the Create menu.
Project opens the native project composer; Folder remains the Files folder action.

## Mobile glass feedback

In the native iOS app, glass presses animate the enclosing surface over 300ms.
Round buttons grow by 28%; wide pills and grouped controls extend their glass
fill and rim by up to 6px per edge, with 18% icon growth around each icon's center.
Labels and layout stay fixed; icons remain visually aligned through release.
Selecting or deselecting a pill updates its fill and text together, including
during release or a rapid second tap. The fill changes with a radial spotlight
centered on the touch, brightening the surface in both light and dark themes.
The spotlight follows the finger while it moves within the surface, updating
at most once per animation frame.
These iOS surfaces omit the native tap highlight; the spotlight supplies feedback.
Release, cancellation, dragging outside, or losing window focus restores the
surface. Disabled controls stay still; reduced motion keeps only the static
color feedback. Android and web keep normal tap feedback without this expansion
or spotlight.

## Routines

Open **Agents → Routines** for your routines. Opening a routine updates the URL
to `/app/routines/<uuid>` while keeping the Agents workspace. Reloading a detail
URL restores that routine; browser Back and Forward restore the list or detail.
Existing `/app/automation/<uuid>` links resolve to the canonical routine URL.
Saved split layouts and document/channel/spreadsheet mentions using the old
block name also open routines; newly copied links use `/app/routines/<uuid>`.
On the legacy Agents screen, use the **Routines** button above the list. On touch devices,
`/app/routines` opens the routines list directly, and the hidden Agents sidebar's
entry moves to **Settings → Routines** (on phones **More views → Settings →
Routines**): tapping a routine closes the settings sheet and opens it, and
**Create Routine** opens the composer. Routines use
full-width entity rows with **Created by**, **Status**, **Runs with**, and **Enabled**
columns. The search field sits below the top bar, as in Projects; search by name,
creator, or model/agent, or press **Cmd/Ctrl+F** to focus it. **Create Routine** sits
to the right of search. Click a row to open its settings in the same pane. Toggle
the **Enabled** checkbox property directly in the list to pause or resume it.
When the list is narrower than 760px (a phone, or the Settings sheet) it drops the
column headers and **Created by**, and each row fits one line: name, status, the
model or agent icon, and the **Enabled** checkbox, with no sideways scroll. Search
fields hide their keyboard hint on touch devices.
Open the routine and use its **Run History** tab to see past runs. Each run is its
own agent session. The routine's **Runs hidden** / **Runs shown** chip decides
where its runs appear. **Hide runs** (the default) keeps them off Home and out of
the Agents sidebar until **Show hidden routine runs** is pressed. **Show runs**
lists them on Home and in Agents like the owner's own sessions. The setting
applies to runs that start after it changes. A run that finishes normally sends
no notification; a failed or cut-short run, a question the agent asks, a held tool
approval, and people the routine's prompt mentions still notify.

**Create → Routine** (U) and **Create Routine** open the same popover host as task
and project creation. Enter a name and instructions, then choose a model or agent
with the first property chip below the prompt. **Add trigger** follows it; each
saved trigger becomes a chip, with another **Add trigger** always at the end.
The last chip, **Runs hidden**, opens **Hide runs** / **Show runs**.
**Start enabled** controls whether the saved routine starts listening immediately. **Create routine** opens
its details inside the Agents pane, retaining the sidebar. Creation has no history
tab or templates. Unsaved drafts are retained for three minutes.

**Add trigger → Scheduled** offers Hourly, Daily, Weekly, Monthly, and Custom
(cron) in a single anchored panel. Choose the frequency and type a time, or type
**every weekday at 9am** or **every Monday at 3:30pm**. **Run once** offers Macro’s
natural date search (**tomorrow 9am**, **in 2 hours**) and an inline calendar with
time controls. Click **Add trigger** to confirm. Click a saved chip to edit it;
**Done** applies changes and **Cancel** leaves it unchanged. The panel floats over
the composer without moving it. Recurring schedules retain their time zones;
one-off times use the browser’s local time.

The event menu groups Macro activity triggers by surface:

- **Channels:** **Channel created**, **Message sent in channel**, and **@ mentioned in channel**.
- **Documents:** **Document created** and **Document deleted**. Tasks are separate.
- **Tasks:** **Task created**, **Status changed**, **Priority changed**, and **Any property changed**.
- **Email:** **New email received** in the routine owner's inbox, excluding spam, trash, drafts, and historical imports.
- **Calls:** **Call started**, for calls the routine owner starts (receives the call and who has joined so far); and **Call ended**, for channel calls and meetings the owner joined (receives participants and transcript, cut short for long calls).

For messages, mentions, deletion, and task changes, choose specific accessible
channels/documents/tasks or any accessible item in the same panel. Creation
triggers cover newly created accessible items; email covers the owner's inbox;
**Call started** shows **Calls you start** and **Call ended** shows **Calls you
join** — neither has an item picker. Calls the owner did not start never trigger
**Call started**; calls they did not join never trigger **Call ended**. Mentions match only @ mentions of the routine owner. **Any property changed**
also includes status and priority; overlapping selectors start only one run for
the same event. These are Macro events, not incoming HTTP webhooks. Bot-authored
or delegated changes do not retrigger routines. Saved legacy selectors remain
editable but are no longer offered in the new-trigger menu.

When `enable-routine-conditions` is on, every activity trigger panel has an
**Only run if** box for an optional yes/no question about each event, such as
**Is this email an invoice or a receipt?** Before a run starts, the event's
content (the email, channel message, document, task, or call, read as the routine
owner) is checked against it, and events answered no are skipped. The chip
shows the question after **· if**. Saving a condition fails with "trigger
conditions are not enabled" while the scheduled-action service has no
`TYPESAFE_API_KEY`.

A routine can combine up to sixteen trigger groups: each schedule is a group,
and up to thirty-two activity filters share one event group;
matching any trigger runs it. Open a trigger chip and choose **Remove trigger**
to remove it. The routine's top bar uses the task breadcrumb layout:
**Routines → routine name**, followed by the three-dot menu for duplication and
deletion. Tabs immediately beside that menu switch between **Overview** and
**Run History**. Overview follows the project home layout: an editable title,
a model property chip, an apps chip, and the **Runs hidden** / **Runs shown**
chip, and a plain prompt editor. A trigger card sits below the
model: trigger chips at the top left, **Run now** at the top right, and the
**Enabled** / **Disabled** status with **Next run** along the bottom.
The **Run options** dropdown contains
**Enable routine** / **Disable routine** and **Copy prompt**, which copies the
current instructions, including unsaved edits. **Run History** uses full-width
Soup rows for past agent sessions, with each run's
outcome, duration, and time. Runs a trigger's condition skipped show
**Condition not met** (hover for how likely the answer was yes) or **Condition
couldn’t be checked**, marked **Skipped**; consecutive skips collapse into one
**N events skipped by the condition** row that expands on click. Click a row or press Enter to open its session;
Shift opens it in another split. **Back to routines** returns to the list in the
same pane.

The apps chip (**Add apps** in the composer and Overview) opens **Required
apps**: search the Pipedream catalog and pick the apps every run needs, on top
of the agent's own. Each picked app shows **Connected** or a **Connect** button
for the routine owner. Until every listed app is connected the composer shows
**Connect every app this routine requires.** and Overview does not save; the
server rejects the save too, and a run whose app was disconnected later fails
before a session opens. Agents whose runtime opens its own sessions (macrod,
other external runtimes) cannot take routine apps.

**Disable routine** pauses immediately, including with invalid
unsaved edits. Resuming waits for valid settings to save. Settings autosave in
order without changing activation. **Run Now** waits for the latest valid edit
to save; it also works while paused. A failed save keeps the draft and offers
**Retry save**. If another editor changed the configuration, **Reload latest**
loads those settings before further edits. While running, configuration is locked; the routine can be paused
but cannot resume until the run ends. Completed one-offs remain visible with
their history and do not repeat.

An `m-document-mention` with `blockName: "routine"`, the returned routine ID,
and the saved name renders as a clickable mention in an agent reply. Once the
routine is deleted the mention reads `Deleted` and clicking it shows a card
instead of opening the routine. Routines do not appear in the mention menu.
Only the owner sees a routine's editor and can edit, enable, run, duplicate,
delete, or view run history. Anyone else who opens a routine link sees its
template when the owner shared one, and otherwise "isn't shared as a template".
Run conversations keep their own permissions.

### Routine templates

A routine runs as its owner, so it is shared as a template, never directly.
The three-dot menu's **Share as template** opens **Share: name**. It explains
what people get, takes a **Description**, and lists **What changes for each
person**: every mention in the instructions plus the schedules' time zone, each
with tabs. People can be **The person activating** (the owner's own mention
starts here), **Same for everyone**, or **They choose**; items are **Same for
everyone** or **They choose**; the time zone is **Their time zone** or **Keep** the owner's
zone. **Share template** publishes a snapshot of the saved routine;
**Update template** re-snapshots it. Once shared, the dialog shows how many
routines were activated from it, a channel-or-people picker with **Send** that
posts the routine mention, **Copy template link** (the routine's own URL), and
**Stop sharing**, which hides the template while activated routines keep
running.

Opening a shared routine someone else owns shows the template laid out like a
routine's Overview: **Activate for me** at the right of the top bar, then the
name, description, **Template by author**, activation count, triggers (marked
"Doesn't run until you activate it"), read-only instructions, and
**References**: dashed chips fill in as the viewer, amber ones they can't open. **Activate for me** opens **Activate for me: name**: the routine
as it will run on the left, and on the right **Your call · N left** for each
reference they can't open or must choose (**Keep it** / **Leave out**),
**Filled in as you**, and **Works for you as is**. **Activate** stays disabled
until every reference is decided, then creates the viewer's own enabled
routine and opens it. A left-out reference becomes plain text. That routine
behaves like any other, with a **Created from template ↗** chip beside its
model chip that opens the template.

A channel message that mentions a shared routine shows a template card under
its text: name, author, description, triggers, activation count, **View
template**, and **Activate for me** (hidden for the author). Mentions of
routines that aren't shared show no card. On phones both dialogs open as
bottom sheets.

**Run History** shows outcome, duration, and firing time. History loads fifty
rows at a time; **Load more runs** reveals older records. Accessible run rows
open the agent session created by that run. Selecting a model uses the same
Macro agent-session runtime as the new AI chat composer, with that model;
selecting an agent uses its runtime and default model or selected override.
Historical runs that created legacy chats still open those chats. Unavailable conversations
remain non-clickable. Macro event routines also support editing, history, and
activation.

MCP and Macro agent tools expose **CreateRoutine**, **ListRoutines**,
**ReadRoutine**, and **UpdateRoutine**. Select `target.type: "agent"` with the
`bot.botId` from **ListAgents** as `agentId`, or `target.type: "model"` with a runtime
model ID. `schedule.type: "once"` accepts a future RFC3339 `at` timestamp;
`"cron"` accepts a six-field `expression` and IANA `timezone`. Routine ownership
comes from the authenticated caller, never a model-supplied user ID.

## Command menu (Ctrl+K)

Opens a dialog with a focused `Search...` textbox and bubble-style category radios
(All / Command / Agents / Files / Tasks / Projects / Channels / People). Type a name, press Enter to open
the top hit. Also exposes commands: `Create`, `Change theme`, `MCP setup`. Keys: Tab cycles
category, Esc closes. The category strip and footer have transparent backgrounds.

With PostHog **enable-universal-input** enabled, typing at least **3 words or 24
characters** turns the menu into the shared Universal Input composer. The current
text and insertion point transfer to its rich input in the same header row, with
the same type size and padding. There is no additional title. The Macro logo hides
when the rich input wraps or contains multiple lines, then returns on one line;
its reserved space is removed so text uses the full input width. Classification and field
extraction run while typing continues. For example, “dinner with julia tomorrow
at 9pm” reveals an event; users can change the type and edit fields before acting.
Shorter edits keep the composer open; clearing the input returns to ordinary
Command K search. IME composition finishes before the transition. This applies to
ordinary search, including a selected category; nested command scopes, entity
actions, and the onboarding sandbox retain their existing behavior.
In composer mode, Enter inserts a newline and Cmd/Ctrl+Enter performs the displayed
action; Tab moves through form controls. Escape closes the menu (or first leaves
active inline search navigation). Successful actions close the menu and open their
result when available; errors keep the form available for correction. Command K
drafts last for the open menu only; closing or reloading discards an unsent draft.

In `Change theme`, Up/Down previews the highlighted palette across the open app,
including channels and spreadsheets. Moving between rows preserves the original
palette for cancellation without briefly restoring it between previews. Esc
restores that palette (including unsaved edits); Enter commits the highlighted
theme. Browser and notification icons change only when a theme is committed.

With the local GraphQL cache enabled, Cmd+K and document/channel `@` mentions
search cached entities without waiting for a server search. Background hydration
updates an already-open menu only when a bucket it uses changes. Email/body/tag-only
hydration must not reread History or the cached channel list; a newly hydrated note
refreshes History and matching menus, and a channel/DM refreshes channel consumers.
Ordinary query responses use the same bucket scoping. A project-search response
that only caches another viewer Soup page must not refresh History, channel lists,
or unrelated active query pages. Renames, ownership/recency changes, and moves
between buckets must still appear without retyping in every affected view.
Older cache runtimes without bucket metadata, mutations, and identity resets
refresh conservatively. For an empty search, scroll toward the end (or use
Down); mentions offer **View all** for a category and then load more local pages.
Counts describe loaded results, not the full server corpus. Scans through
incomplete or already-visible cache hits are bounded per action; continue
navigating/scrolling, or narrow the query, to resume from the saved cursor.
A failed local refresh keeps displayed rows and their continuation available for
another pagination attempt. Quick Access merges the complete channel list with
cached channels, so known channels remain searchable before cache hydration and
outside its recent page. Cached metadata wins for duplicate channels while newer
viewed timestamps from either source are retained. Other uncached items should
appear after hydration without retyping. Cmd+K's
local search explicitly excludes email hits before limiting entity results;
email mentions keep their separate search-service path. Text search loads only
its requested cache buckets, so a document-only category must not read the email
catalog. Switching categories still discovers previously unopened buckets;
renames, subtype moves, DM priority, and stable tie ordering remain unchanged.

With CRM enabled, normal `@` menus include CRM contacts under **People** in
documents, channels, discussions, and composers. Contact search loads paged
GraphQL results from all accessible CRM-enabled teams, excludes hidden contacts
and companies, and collapses duplicate full email addresses case-insensitively.
The most recently active visible team record represents each email. An eligible
Macro user with the same email takes precedence and keeps normal user-mention
notifications. External contacts insert a link to their original CRM record;
they do not invite or notify that email address. Assignee and other user-only
pickers continue to list Macro users only.

Typed Cmd+K **People** and **All** queries find known Macro users, including
teammates supplied by the contacts service, before their first DM and without a
CRM record or the CRM feature. Search by name or email. Selecting a person opens
their direct message; an existing one-to-one DM replaces the person row without
losing name/email matches, including DMs found by typed search beyond the recent
channel list. Group DMs stay separate, and the viewer is excluded
from person results. Empty queries keep the existing recency lists. Verify a
teammate with no DM or CRM record in both categories, including with CRM disabled,
then verify that loading their DM produces one row and that Files/Channels do not
show that person. Also verify a typed match whose DM is absent from the recent
list: desktop and mobile should show one DM row, including after a same-email CRM
contact arrives, with its alias still searchable.

Duplicate-row verification: [desktop](media/command/deduplicated-person-desktop.png)
and [phone](media/command/deduplicated-person-mobile.png) use the real command and
mobile search views in the backend-free universal-input fixture, with a synthetic
person and a DM available only to typed searches. All/People each show one row;
Enter and tap select that DM through recording-only navigation adapters. These
captures verify result composition, not a live account's cache or backend.

Browser examples: [desktop](media/command/teammate-desktop.png) and
[mobile](media/command/teammate-mobile.png), using a known-user fixture with no DM
or CRM record and an intercepted DM request. These captures used a bundle-only
guard for the unrelated disabled grouped-Soup startup crash in
`create-grouped-soup-live-query.ts`; unmodified app startup remains unverified.

With CRM enabled, Cmd+K **People** and a typed **All** query also find CRM contacts, using the same
accessible-team search, hidden-record exclusions, and full-email collapsing as
mentions. Cached contacts appear at once; the server search starts about 250 ms
after typing stops and pages 100 contacts at a time, so contacts beyond the first
500 cached records are found too. An empty query keeps People and All on their
usual recency lists without contacts. A contact whose email belongs to a Macro user
appears as that person instead, even when only the CRM name matched: their existing
direct message when you have one, otherwise the person, and selecting them opens a
direct message. Matching direct messages and Macro users rank ahead of CRM contacts,
even when the conversation is old or has no recorded activity. Relevance and recency
still order results within each group; other result types keep their positions.
Verify this in both People and All with a recent CRM contact and a matching DM last
viewed more than 30 days ago, including when server contacts arrive after the DM.
Other contacts show their email and open the contact page; Enter and
click open in place; Shift+Enter inserts a newline in the query. A server match that arrives after
typing takes the default selection from the Search for… row. Global Search does not
list CRM contacts; Search for… from People still opens the Channels search. Verify
a contact outside the cached rows, an email-only query, rapid query changes (rows
from an earlier query must disappear unless they still match), scrolling or Down
past the last row to load more, and that Files/Tasks/Channels/Agents never show
contacts.

Cmd+K merges cached and locally available items before applying recency order.
An empty query prefers when an item was last viewed, falling back to its update
time; equal timestamps have a stable entity-type and ID order. Typed searches give
channels (including DMs) the same 3x boost as the main search view, with the menu's
additional 1.8x DM boost; relevance and viewed recency still order those results.
This shared ranking also applies to mobile name search. Verify an older matching
channel stays above recent CRM contacts and agent sessions in All, and remains
findable in Channels while its cache entry is absent. Refreshing the cache or
reopening the menu with unchanged data must not reorder results or duplicate a
channel when its cache entry arrives. Hydration must also refresh ownership,
participants, and channel type when the name and timestamps are unchanged.

The `quick_access.search` trace includes `search.channel_index` attributes for
complete-list, cached-recent-page, and merged channel counts. `last_build_ms`
records the most recent shared channel-index build duration; that build can
precede the search and is not a child phase of the cache request.

Pending or failed Quick Access history, recently-viewed, skills, and cached-channel
lookups must not hide the app shell. Verify a cold lookup with Cmd/Ctrl+K: navigation
stays mounted and usable while the optional source loads or fails. Also hold the
skills discovery request (`/items/soup`, skill subtype) during startup: even a
paused or disabled discovery query must not suspend navigation or Home. Releasing
the request should populate skills without remounting the shell. The menu shows no
loading text: while entity rows are still loading, an empty list stays blank and
commands remain usable; a settled empty category shows **No results found**.
Background history or channel refetches alone must not blank a settled empty
category back to its loading state,
including when the active category does not use that source. Cache-update bursts
must let in-flight history, channel, and menu-search reads publish their results,
then catch up with one coalesced refresh. Verify with cache reads slower than the
250 ms update throttle, starting from an empty cache: entities appear without
waiting for background updates to stop. Changing the query/category or closing
the menu still discards obsolete search results. A failed background
refresh retains available history/channel items and recently-viewed ordering.
Placeholder results also remain usable while replacement data loads. A normal
cache-worker handoff between tabs preserves backfill cursors and watermarks.
Hydration checkpoints belong to the stored cache generation: resetting or
recreating the database starts a full scan even when an old checkpoint survives
or the page missed the reset notification. Verify that clearing only the cache
database and reloading recovers older channels as well as recent ones. A reset
during hydration must also restart the scan. Per-lane full-refresh and Shared Mail
restart rules still apply.

## Keyboard model (from the in-app guide; verified partially)

- `Ctrl/Cmd+K` — jump to anything by name.
- `?` — the focused view's shortcuts, read from its registered keys (hidden
  navigation keys and `g` sequences included); `?` again closes it. Only the
  key opens it: the command menu does not list it, since run from there it
  would describe the menu. A view's `g` letters are listed under that view.
- `c` then `d`/`t`/`e`/`m`/`a` — create doc / task / email / channel / AI chat.
  Single-letter shortcuts only work when no editor has focus; press `Escape` first.
- `/` — search everything (in Email it focuses email search). `j`/`k` — move in
  lists. `e` — mark done.
  After opening a list item in the same split, `j`/`k` continue through the
  originating list; native detail paging can still load its next page. Check
  repeated list/detail transitions as well as group-header skipping. Returning
  to the list restores scrolling to the focused row; the unmounted list's
  virtualizer must not run while viewing details.
- `#` — move email to Trash, with an Undo toast. Works on the selected or focused
  rows in a mail list and on the thread open in an email detail or block. Email
  only; other entity types keep Delete/Backspace and do not answer `#`.
- `g` then `h` — Home; `g` then `i` remains an alias. While Email is focused,
  `g i`/`o`/`s`/`t`/`d`/`e`/`a` open its tabs instead (`g i` Signal, `g t` Sent;
  see `email.md`); `g h` still goes Home.
- In Email and Tasks search, `Escape` returns focus to the list and keeps the query.
  Use the search field's clear button to clear it.
- Splits: `` ` `` split, `Shift+H`/`Shift+L` move focus, `Shift+Esc` maximize.
- Desktop app only: `Ctrl/Cmd` with `+`, `-`, and `0` zoom the page and reset it,
  through the same stops a browser uses. The level persists across relaunches,
  and the commands appear in the command menu as Zoom in / Zoom out / Actual
  size. In a browser tab these stay the browser's own zoom.
- In any text surface: `@` mentions (bidirectional links), `#` tags, `/` block commands,
  `:` emoji. Clicking a rendered tag opens a Search split filtered to that tag.

Settings → Agents, its Cursor guide, and Runtimes render while their requests are pending.
A pending Cursor model catalog shows `Loading models…` beside a disabled model
picker; a failed catalog shows an inline error. The rest of settings stays usable.
Settings → Agents → Agents ends with **Coding sessions**: per-user **Create
tasks** and **Open pull requests** switches, both off by default. Each saves on
toggle and reverts with a toast if the save fails.

Home does not bind Delete or Backspace to deleting list items. These keys remain
available to the open editor (for example, clearing a selected spreadsheet range).
Use the item menu to delete an item from Home.

Home and Agents unsent composer storage follows the current account identity.
Before identity is available, it uses memory only and does not restore legacy
shared drafts or attachment projections. Logout
clears composer drafts and attachment projections, including legacy keys. When
checking Android draft recovery, verify the actual editor text after process
death; storage unit tests alone do not establish lifecycle recovery.

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

## Entity menus

List rows (Search, Home, Email, Drive, Tasks, Recent, folders, Agents, Calls)
share one right-click menu, and the mobile long-press drawer shows the same
items. It offers an item only where its action works for the row's type:
Rename for documents, chats, folders, calls, agent sessions, and channels you
take part in (not DMs); Duplicate for
documents, chats, and folders (with GraphQL Soup); Move to folder for documents, chats, folders, and email you own (a folder is
one location shared by everyone, and its sharing passes to what it holds, so
only the owner moves an item; the server enforces the same);
Delete for email and owned documents, chats, folders, calls, agent sessions, and
routines. **Download** saves uploaded files (images, video, code, PowerPoint,
Photoshop, Illustrator, Figma, other uploads) and Word documents as `.docx`;
Markdown documents, canvases, native spreadsheets, and PDFs download from their
open view instead, since their download needs the loaded editor (a PDF's
includes its markup). Tasks add **Set status**, **Set priority**, and **Set assignee**,
which open the property editor like their shortcuts. Agent sessions add
**Archive** / **Unarchive** for their owner. Calls offer **Share**. Pull
requests offer **Open in new split**, **Copy GitHub Link**, **Open on GitHub**,
and **Copy Branch Name** when the head branch is stored. Rows inside a Drive
folder offer **Remove from folder**, as in a folder's own view. Channel message
rows have no **Copy ID**. Email rows and the email "…" menu offer **Sender →
Signal** for a sender in Noise and **Sender → Noise** for one in Signal, read
from the email itself (falling back to the view's tab); when neither says, as
for some Search rows or an email opened directly, both are offered, with
**Block Sender**. **Mark Done** (and `e`) works in Home, the triaged
Email tabs, and Search, where a marked row stays listed as done. On Home,
right-click **Mark Done** moves the preview to the next item, like the `e` key. A detail view's "…" menu also offers
**Snooze notifications…** beside Mute.

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

Email snoozing uses a command menu with quick or typed times, **If no reply** /
**Regardless**, and **Remove reminder**. Saving waits for confirmation and shows
retry errors inline. See [Email reminders](reminders.md).

Action dialogs share `ActionDialogShell` presentation slots: the same capped selection badges for single and multiple items, compact heading and copy, prominent fields, and an attached footer. Rename, delete, move, and shared confirmations use this layout. Bulk rename keeps bubble tabs and one first-item preview.

The Move to folder picker uses the Drive sidebar’s folder rows: neutral icons, trailing expand/collapse buttons, and indented branch guides. Click a folder to select it; use the chevron to expand it. Search and arrow-key navigation remain available.

### Native update-required dialog

When newer frontend JS requires a newer native app, the mobile shell offers
**Update app** and **OK**. Update app uses the native opener; Android targets the
HTTPS Play listing for `com.macro.workspace.mobile`, allowing a browser when the Store app
is absent. An opener failure displays an inline error and the dialog stays
dismissible. A missing listing is handled in the external store/browser: return
to Macro, dismiss, and retry later. Task 07 verifies the live listing.

Universal Input observability uses one draft trace, timed classification/extraction
and submission spans, and events for queue wait, predictions, readiness and edits. Inspect `input.outcome`, safe failure
categories and provider fallback spans in Tempo. Never include draft contents
or field values in telemetry. Browser tracing requires its existing OTEL flag.
