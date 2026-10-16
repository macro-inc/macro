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
and a `Clear all` action in the drawer. The in-view `Search Drive` field, the
Sort/Filter dropdowns, and the header New menu are desktop-only — search on
touch uses the global search overlay and creation uses the dock's New button.
The **Folders** pill opens the folder overview and stays highlighted inside
any folder; tapping it from inside a folder returns to the overview, and
selecting another pill leaves the folder tree. The sidebar contains `New file or folder`, `My Files`, `Recent`,
`Shared with me`, collapsible Favorites, and a searchable folder hierarchy. Filter
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
unchanged. Folder menus also offer Favorite/Unfavorite, Move to folder, Copy Link,
and owner-only Rename and Delete.
A folder's Share dialog, when the owner belongs to a team, has Team access
(None, View, Comment, or Edit) without a Link sharing card or Link tab.
Favorites use the same open actions and **Remove from favorites** menu as Tasks.
The **Filter** menu uses the same controls as Tasks: **Type**, searchable **Tags**,
and **Created by** submenus alongside **Files** for Default, All files, and Email
attachments. Options within a group match any selected option; different groups
combine to narrow the results. Created by is hidden while My Files
is restricted to your own files. Recent offers only file-scope filtering.
Hold Shift while selecting or deselecting Type options to keep the submenu open
and combine several file types without reopening it. Desktop filter submenus allow a
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
