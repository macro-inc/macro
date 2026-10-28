# Files

## Files — `/app/component/documents`

Tabs `Owned` / `Shared` / `Attachments` / `Folders` / `All`; `New` menu; rows show title,
tags, updated time. Clicking a row opens the doc.

Shared always excludes files owned by you. Selecting **Created by → Me** therefore
returns no files; selecting Me together with another creator returns only that
other creator's shared files. Clearing the creator selection restores all Shared
results. This applies to restored filters and flat/grouped list requests—not
just client-side row filtering. Cached inserts enforce the same rule before a
refetch, including expanded groups and inactive cached Shared queries. Until
viewer identity is available, document inserts into Shared are rejected.

Files opens **Drive** using the same shell as Tasks, on desktop and touch
devices alike.

With `enable-graphql-soup` enabled, supported file/folder/chat moves, trash,
restore, permanent deletion, duplication, and share-policy changes use GraphQL
mutations. Verify moving into a folder and back to root, opening the returned
copy, and updating team/link/channel access on desktop and touch. Call-record
permanent deletion and team sharing also use these mutations. A denied or failed
GraphQL write must not retry through REST or report success; mixed bulk actions
retain successful siblings. A plan-refused chat duplicate still opens the paywall
with either transport; it must not create a copy or retry through REST. Restore immediately after trash and confirm the row
returns without waiting for retained deletion markers to expire, even if the
trash's background refresh failed. A delete started after the restore request
must still hide its row. With the flag off, the existing REST paths remain.
Deleting a non-owned item still only removes it from history. Forking a markdown
history version still uses REST because GraphQL duplication copies current content.

With `enable-databases` enabled, **My Files** includes owned databases and
**Shared with me** includes databases shared by other owners. **All files**
also includes accessible databases owned by others. **Search Drive** matches
database names and **Filter → Type → Database** narrows the list. **New →
Database** creates and opens a database from file tabs or the folder overview;
it is absent inside a folder because databases have no folder membership yet.
Database rows open their database block, including Enter and Open in new split.
Use the database block's own actions to rename, share or trash it. The list
omits unsupported duplicate, delete and move-to-folder actions for databases.
Databases have no view history and do not appear in **Recent**, folder contents,
or **Email attachments**. Creation time orders them when the selected sort has
no corresponding database timestamp.

On touch devices (phones and tablets), the Drive header is a scrollable pill
strip — **Recent**, **My Files**, **Shared with me**, and **Folders** — with a
leading filter-drawer button, like Tasks. Opening Files from the mobile dock
starts on **Recent**; explicit tab and folder links keep their destination. The
first pill is Recent. The drawer holds Sort (hidden on Recent, where the viewer's own
edit order applies) and, on tab locations only, the same filter groups as the
desktop **Filter** menu; active selections show a count badge on the trigger
and a `Clear all` action in the drawer. The single-row desktop list header orders the title, Filter, Sort, New, and an
expandable Search icon. `Cmd/Ctrl+F` opens the search field. These list-header
controls are desktop-only — search on
touch uses the global search overlay and creation uses the dock's New button.
The **Folders** pill opens the folder overview and stays highlighted inside
any folder; tapping it from inside a folder returns to the overview, and
selecting another pill leaves the folder tree. The sidebar contains `New file or folder`, `My Files`, `Recent`,
`Shared with me`, collapsible Favorites, a collapsible Databases section
listing every database the viewer owns or has been shared, by name (past ten,
it scrolls within its own height; hidden when there are none or databases are
disabled), and a searchable folder hierarchy.
The Drive sidebar's import card (**Import files**, see
[setup cards](setup-cards.md#import-from-connected-apps)) lists Notion; its
**Import** (or a successful **Connect**) opens a new agent chat beside Drive
that sends "Import my Notion workspace into Macro." (the agent plans with ImportFromNotion, or shows the
Notion connect chip first; a user on a team is first asked whether to share
the import with the team, keep it personal, or let AI decide per page, and a
user without a team gets a personal import without being asked). The plan
call returns within seconds and the agent presents the review card at once:
while planning it shows `Reading Notion: 40 pages, 12 databases`, then every
row with a **Deciding…** badge and `Deciding what to import: 40 of 84
decided` as the decisions fill in, with **Import** disabled until the plan is
ready. The card shows totals (Documents, Databases with rows, Task lists with
tasks, Skipped, Already in Macro), a **Team** / **Only you** badge on every
written row (the owner clicks it to flip it, and a folder flips what is below
it; databases stay **Only you**, and the card says "Databases can't be shared
with the team yet, so they stay with you."), a sharing summary line (without
a team: `N only you — you're not on a team, so nothing is shared`), and a
collapsed **Already in Macro** section linking to copies teammates already
imported and shared, which are not imported again. A database or task-list
row's caret (**Show rows of …**) shows its row count with a few sample row
titles and, for a task list, which Notion columns become status, priority,
due date and assignee. **Open full review** shows the whole plan in a dialog
(a full-height sheet on phones). **Import …** approves straight from the
card, with no confirmation step. The agent ends that
message with "Should I kick it off?"; when the owner answers yes in chat, it
approves the review itself (a `DecideReview` submit, the card's own approve with the
card's choices), and the card's run state adds **Started by the agent at your
request** ("at the owner's request" for other viewers). A message from anyone
but the owner never approves, and a plan still being made cannot be approved
yet. Filter
by tag from the **Filter** menu's Tags submenu; navigating to another tab or folder
clears tag filters. A folder with no files matching the active tag
shows the list's no-match state rather than `This folder is empty`.
Drive omits split-history back/forward buttons in both wide and narrow layouts;
the split close button remains available when multiple splits are open.
Files opened in place from Drive show a return link labeled with their originating
subview (such as `My Files`, `Recent`, or `Shared with me`) or folder name. The text-only
label's font weight matches the file title. The link
restores the originating Drive view.
The `Drive` folder row opens the folder overview. Click a folder name to browse
its contents in the main pane; its separate expand/collapse button reveals child
folders without navigating. With GraphQL caching enabled and membership metadata
hydrated, a never-visited folder can immediately show cached documents, chats,
and subfolders for supported created/modified sorts and filters. Email remains
server-owned: the full mixed GraphQL query still refreshes in the background,
keeps loaded email rows, and owns pagination. A non-email projection with no visible
rows, including when pending deletions hide every cached row, must not show
`This folder is empty` while that initial request is pending or failed. Verify that
loading and transport errors remain visible in this case; releasing a failed deletion
restores cached rows without a refetch.
Verify with a folder-specific GraphQL response delayed, then navigate to another
folder before it completes; neither cached rows nor late results may leak across
folders. The top bar keeps the full folder and file detail
path in one breadcrumb trail. Folder containment uses `/` separators, while the
transition to a file detail and nested detail navigation use the default `>`
separator. Choosing a folder breadcrumb returns to that folder and clears newer
file details. Empty folders show `This folder is empty` and a `Back to Drive`
action that returns to the folder overview. Folder search retains matching
descendants' ancestors and reveals their branches.

`Search Drive` searches the current tab or folder overview; search within a folder
is temporarily hidden, including its Cmd+F shortcut. The sidebar's folder-name
search remains available. Right-click any Drive view, the Drive folder overview,
or a folder at any depth for **Open in new split**, **Open in current split**, and
**Open fullscreen** (when multiple splits are open). Opening a location in a new
split clears search and filters in the destination, leaving the original split
unchanged. Folder menus also offer Favorite/Unfavorite, Snooze notifications…,
Mute/Unmute notifications, Duplicate, Copy Link, Copy ID, Share, and
owner-only Rename, Move to folder, and Delete, matching the folder's row menu in the Drive list.
**Duplicate** on a folder (also in its "…" menu and row menu) makes "<name> copy"
beside it (or at the top level without edit access to its parent), copying its
subfolders, documents, tasks, and chats; email threads filed in it stay with the
original. Folders with more than 100 subfolders, documents, and chats can't be
duplicated, and a failed copy leaves nothing behind.
A folder's Share dialog, when the owner belongs to a team, has Team access
(None, View, Comment, or Edit) without a Link sharing card or Link tab.
Favorites use the same open actions and **Remove from favorites** menu as Tasks.
The **Filter** menu uses the same controls as Tasks: **Type**, searchable **Tags**,
and **Created by** submenus alongside **Files** for Default, All files, and Email
attachments. Options within a group match any selected option; different groups
combine to narrow the results. Created by is hidden while My Files
is restricted to your own files. Recent offers only file-scope filtering.
The desktop Filter trigger shows the number of active filters, matching the
mobile drawer; clearing all filters removes the badge. Use the left checkboxes
(or Space) to combine Type options without closing. Row activation adds and
closes; Shift-click or **Only** selects just one type and stays open, following
[shared multiselect behavior](ui-conventions.md#multiselect-dropdowns). Verify the badge
tracks consecutive checkbox toggles (1 → 2 → 1), including when filter groups refresh
while the menu is open. Desktop filter submenus allow a
250 ms grace period when the mouse crosses the parent menu's padding; entering
the submenu cancels the pending close. While the mouse heads toward an open
submenu, including one that opens to the left, the categories it crosses on the
way do not take over. A category the mouse moves to directly, or rests on for
300 ms, opens in its place. Escape and outside clicks still dismiss immediately.
`Sort files` offers modified, created, and viewed dates.
Recent uses the viewer's own interaction order and does not offer a sort override.
The New menu and drag/drop uploads target the selected folder. **New → Folder**
and the launcher’s **Folder** action open the folder composer. Enter **Folder name**,
choose **Add tags**, and stage files or nested folders in the large drop area
(or use **Add files** / **Add folder**). Staged items can be removed before
**Create Folder** (Cmd/Ctrl+Enter); nothing uploads until submission. Confirmation
closes the composer immediately while creation and uploads finish in the background.
On touch devices, the folder composer uses the same bottom drawer as Task, with
the name and tags fields; the upload area and file/folder picker buttons are hidden.
Expanding into a split keeps the draft. Creation preserves the current location
and offers an **Open** toast action when finished. On failure, the toast’s **Retry**
action restores the draft, retaining any created folder and only unsuccessful uploads. Close an unused draft
without submitting when verifying against hosted dev data. In a folder
opened in its own split or an inline preview, drop files from the computer onto
the empty state or file list, then reopen the folder to verify membership.
Check both one file and multiple files; the nested list drop target must retain
the open folder as the upload destination.
File rows retain
selection and context menus; ordinary folder clicks and Enter browse inside Drive,
while Markdown, code/CSV, image, video, PDF/DOCX, canvas, and unrecognized file
clicks and Enter replace the list with a breadcrumbed detail. Those detail
menus include Duplicate, Rename, Move to folder, and Delete. Code, CSV, image,
video, canvas, PDF, DOCX, and unrecognized files also include Download. PDF
details include Print, and DOCX files include Download DOCX. Markdown details
use the document menu, which already includes Download. Spreadsheets keep the
editor's Import and export menu for Excel and CSV downloads. Choose the current location
breadcrumb to return to the list; choosing an ancestor file drops newer detail
entries. Opening a list row or sidebar favorite pushes a new one-item detail path;
sidebar favorites start from My Files instead of inheriting a previously selected
folder. Only navigation originating inside a detail appends to that path. Browser
Back and Forward restore the exact path saved with each entry, and renamed files
update in mounted ancestor breadcrumbs without rewriting history. Cmd/Ctrl-clicking a
row toggles selection; Shift-clicking a checkbox selects a range, and Shift+Enter
opens the focused row in a new split. Cmd/Ctrl-clicking a row's folder link or
search hit opens a new tab. Short filtered pages load more results automatically;
a failed page shows a retry action instead of silently stopping. On touch, tabs
switch via the header pills; on narrow desktop layouts the header keeps a plain
title and navigation goes through the hamburger overlay. Location, search,
filters, expanded folders, list focus, and scroll position are restored when
returning from an opened file.

## Downloading files

Open a video, image, code file, canvas, or other uploaded file in Drive. Its
header exposes **Download** on desktop, phone, and tablet. The file menu uses
the same action. Video routes also expose it in their header; channel videos
expose it over the player on hover or keyboard focus (always visible on touch)
and in the expanded viewer. Linked video cards also offer Download in their
preview header without opening the file.

- Click Download once. The control shows preparation progress when the server
  provides a length, disables repeat clicks, and offers Cancel. Browser users
  proceed directly to browser downloads. Android and iOS binaries with the
  file-export bridge proceed directly to the system save picker.
- **Download started** means the browser accepted the file; check its downloads
  UI for the location and final completion. **File saved** is reserved for a
  completed native save. Retry download remains available after a fetch failure.
- On phones and tablets that support system sharing, **Download** opens a menu
  with **Download** and **Share**. Share opens the system share sheet; desktop
  headers keep only Macro's existing Share control for access and links. If a browser's
  user gesture expires during loading, a ready notice asks for another tap on
  Share in the open menu; that tap uses the prepared bytes without another network request.
  No Macro download dialog appears. Cancelling a chooser keeps the file ready
  for another attempt and does not report success.
- Installed iOS binaries without the optional file-export bridge use the system
  share sheet for saving too. After a slow preparation, tap **Save file** to open
  it, then choose Save to Files or another available system action. The dedicated
  save picker becomes available when the new native binary ships.
- Change files or close the viewer during preparation: the old request must stop
  and must not save a late response. Close the expanded viewer with Escape and
  confirm focus returns to its opener.

Verification: use an existing video in a channel and Drive. Check both message
and expanded-viewer download actions; compare downloaded bytes, filename, and
extension with the original. Repeat at 390px with touch enabled and at tablet
width. Exercise a failed request, retry, cancellation, and changing selection.
Native save/share dialogs require physical iOS/Android verification in addition
to browser emulation.
