# Tasks

## Surface

`Go to Tasks` → `/app/component/tasks`. Tabs: `My tasks`, `Created by me`, `Team tasks`, and `Projects`.
The desktop toolbar contains search (`Ctrl+F`), `Sort`, `Group`, and `Filter`;
the filter uses the legacy compact option rows and searchable Assignee, Created by,
and Tags submenus. Multi-select choices keep the menu open; Escape dismisses it.
Task creation is available from the `New` button in the Tasks sidebar. Below the tabs the
sidebar has a collapsible `Tags` section listing every personal and team tag, with a
`New tag` button beside the heading. Clicking a tag narrows the current tab to tasks
carrying it (the same selection as the `Tags` group of the `Filter` menu); clicking it again
clears it, and switching tabs clears it like any other filter. On mobile, the tabs
are pills and the leading sliders button opens one drawer containing Sort, Group, and
Filters (including Tags). The mobile bottom dock has the Ask AI input, a separate **+ Task**
button, and Search.

New accounts are seeded with three sample tasks (`Intro to tasks`, `Advanced task features`,
`How we use tasks at Macro`).

Click a task row or favorite to replace the list with the editable task document. Its top
bar shows the originating task tab as a text-only return breadcrumb,
followed by the task name and actions, Share, and the Details/Properties side-panel
toggle. The return label matches the task title's font weight in both wide and narrow
layouts. Narrow splits also show a close button when multiple splits are open. Choose
the originating tab breadcrumb, a task tab, or a tag to return to the list.
Shift-click a row or favorite to open it in a new split
instead. Keyboard list navigation only moves focus; press Enter to open the focused task.

## Reviews view

With `enable-tasks-reviews` enabled (on by default in development), a
`Reviews` shortcut appears above `My Tasks` in the Tasks sidebar and mobile tabs.
It opens a separate `/app/reviews` shell with `Involving me` first and selected
by default, followed by `All PRs` and `Authored by me`. The selected tab is
stored in the URL and survives opening a PR and returning through the breadcrumb.
The list contains accessible GitHub pull requests of any status. `Involving me`
uses the server's participant filter for your linked GitHub account: author,
requested reviewer, assignee, commenter, or reviewer. Participant IDs are retained
across partial GitHub refreshes, so this is not strictly a list of current
review requests.
`Authored by me` matches the linked GitHub login or user ID. If the link-status
endpoint has no identity, the list explains why Authored by me is unavailable.
Search, repository and author filters, and Updated/Created sort controls appear
above the list. PR rows use the shared entity layout with selection checkboxes,
author avatars and names, and a context menu. The current user's Macro display
name appears when their linked GitHub identity matches the PR author; other
authors fall back to GitHub names. The virtualized list fetches more pages as
you scroll, including when local filtering removes most fetched rows.

PR rows can be added to or removed from Favorites through their context menu or
bulk entity actions. When at least one accessible PR is favorited, Reviews shows
a collapsible Favorites section below the views; the section is hidden otherwise.
Favorite rows open the PR in Reviews (Shift-click opens another split), and their
context menu can remove the favorite. PR favorites also open in Reviews from the
global Favorites sidebar or command menu.

Select a PR to open `/app/reviews/pr/<foreignEntityId>` in the Reviews shell.
Its breadcrumb returns to the Reviews list. Old `/app/pr/<id>` links redirect
to the Reviews detail. When the flag is off, the Reviews shortcut is hidden,
but copied PR detail links still work.

Check all three tab URLs, author avatars and display names, row selection and
context menu, favorites add/remove and collapse/empty visibility, filters, sort,
illustrated empty states, loading, errors, and pagination after filtering. Use
Open in new split from a PR row's context menu; verify the Reviews list stays in
the original split and the PR appears beside it. Open a favorite from the global
sidebar, return through the breadcrumb, and open a copied link in a second split.
Use existing PRs and do not modify hosted data.

## Create a task

On touch devices, task creation opens in a bottom sheet with a drag handle and
scrollable, keyboard-aware content. Its glass pane has broad screen-scaled
corners, an 8px outer inset, and a blurred backdrop, matching the create and
filter sheets. Desktop uses the centered composer dialog.

1. Click the `Task` button (or `Create` → `Task T`, or keyboard `c` then `t`).
2. A dialog opens with the title contenteditable focused (placeholder `New task`), plus
   `Add description...`, and property buttons: `Not Started` (status), `Priority`, assignee
   chip (defaults to you), `Due Date`, `Change or select tags`, `Attach image or video`,
   a `Create More` switch, and `Create Task Ctrl ↵`.
3. `type_text` the title, then press **Ctrl+Enter** to create (the `Create Task` button
   enables once there is a title). Dialog also offers `Continue editing in split` to open the
   task as a full document.

Tasks are documents under the hood (creation hits `POST /dss/documents/create_task`), so they
also show up in Files/`All` and in AI-chat document listings.

## Projects

Projects are gated by PostHog `enable-projects` and are off by default. Local
development can opt in with `VITE_ENABLE_PROJECTS=true`. When off, Tasks hides
the Projects tab, project column, and assignment actions. A saved Projects tab
temporarily shows My Tasks without overwriting the saved selection.

Choose the `Projects` tab in Tasks, or open `/app/component/tasks-projects`.
Projects use the same list rows, property cells, selection, group headers, and
keyboard navigation as Tasks. Search (`Cmd/Ctrl+F`), `Sort projects`,
`Group projects`, and `Filter projects` sit above the list. Groups default to
Status; choose None, Priority, or Assignee to change them. Click a group header
or use the list's disclosure keys to collapse or expand it. Sort by Updated,
Name, or Due date. Filters include Status, Priority, and Assigned to me;
`Filter due date` provides From and Through bounds and `Clear dates`.
Search and filters apply before pagination. Scrolling or navigating near the
end loads more projects; `Load more projects` also continues the list.
Keyboard movement changes focus; Enter opens the focused project and
Shift-selection opens it in a new split. Folders remain separate in Files.

`New project` and the global Create menu's `Project` action (C, then P) open
the same native composer host and layout as task creation,
with a project name and the shared property pills for Status, Priority,
Assignees, and Due date. Team sharing is enabled by default.
Project Status offers `Not Started`, `In Progress`, and `Completed` in the
composer, list, and detail/side-panel pickers. The Status filter uses the same
three choices. Task statuses are unchanged. Existing project values from the
previous status catalog remain visible until an editor changes them.

Submit with
`Create Project` or Cmd/Ctrl+Enter. `Continue editing in split` preserves the
name, properties, and sharing choice; `Clear Draft` resets an uncreated draft.
Leaving a property unset keeps its normal server default. If creation succeeds
but a property write fails, `Retry saving properties` finishes the existing
project, including after continuing in a split, without creating a duplicate.

Opening a project keeps the Tasks workspace and its navigation. The top bar
shows the Projects return breadcrumb and the project name, with the same Share
and side-panel controls as task detail. Choose Overview or Tasks in
that top bar. Opening an associated task extends the breadcrumb trail; choose
the project breadcrumb to return, or Projects to restore the collection and its
filters, groups, and scroll position. Project URLs retain identity and section:
`/app/component/initiative-view~<project-id>~overview` (or `tasks`).
Project properties live in the shared Details/Properties side panel and honor
project access. Editors can rename the project; its owner can delete it.
Deleting a project leaves its tasks in the workspace.

Share uses the existing `To: Email or group` field, optional message, access
choice, and `Share` action. Owners can open `Manage collaborators` from People.
The usual team and link-access controls and Copy link action use the same menu
as other entities. Access changes also apply to the description. Sharing to a
channel posts a native project chip, which opens the project in Tasks; channel
attachments list it in their Projects section.

Assigning a person to a project also adds them as a collaborator with edit access.
Clearing the assignee leaves that access in place; the owner can remove it through
Manage collaborators in Share. Removing a collaborator does not clear assignees.

Overview's Description uses the shared collaborative Markdown editor and saves
automatically to the existing backing document. Edit/owner access allows typing;
view/comment access is read-only. The description is part of the native project
view and does not open a separate document block. Discussion appears below the
description, using the same discussion component as tasks.
Backing descriptions remain available through direct reads, but are omitted from
ordinary document search, history, and Soup lists.
An unavailable connection shows `Retry description` without clearing saved content.

The project's Tasks tab starts with the task search, controls, and unified list;
the project title and property pills appear only on Overview. Use
`New task` to create a task associated with the project, or `Add existing tasks`
to choose existing tasks. `Remove` clears a task's project association.
The regular Tasks list includes a Project column; clicking a project chip opens
that project. Right-click a task and choose `Set project…` to choose or clear its
project. On mobile the same action is in the long-press menu. Selecting several
tasks exposes `Set project` in the selection toolbar, and a context action on a
selected row applies to the selection. Partial assignment failures leave only
failed tasks in the picker for retry.

Discussion at the bottom of Overview uses the new discussions system. Comments
appear from oldest to newest, with the comment input below them. The Discussion
heading collapses the section, and `Load earlier comments` loads older comments
at the top. Comments, replies, and reactions stay attached to the project identity.
Notification links open Overview at the relevant discussion. Existing `activity`
URLs also open Overview and preserve the target discussion. Project history is
not included in this discussion section.

## Bulk delete

Select task rows with their leading checkboxes, choose **Actions → Delete items**,
then confirm **Delete**. With GraphQL Soup enabled, selected rows disappear while
requests are pending, including rows loaded through grouped pagination. The
confirmation closes when the whole batch succeeds. After a partial failure it
reports how many items were deleted and keeps only failed items in the dialog for
retry; successful items must not be submitted again. Confirmed deletions are
removed from split histories immediately, even if the dialog is then canceled.
Cancel clears stale selection and focuses a surviving failed item or a live
neighbor; it does not undo successful deletions or run deferred email deletions.
After a partial deletion is retried successfully, focus uses a surviving neighbor
captured before deletion (next, then previous), rather than restarting at the top
of the list. If both neighbors disappeared, it falls back near the original list
position, skipping group headers and load-more rows.
Failed items return to Soup and search immediately, while successful removals
remain absent from both.
Successfully deleted items stay hidden until all enabled GraphQL Soup lists
revalidate successfully, even if the first refresh fails. Refresh is attempted
at most three times (one- and two-second retry delays); suppression expires one
minute after deletion finishes if revalidation remains unavailable. The
GraphQL-disabled path retains its existing behavior.

For verification, use disposable tasks and delay only their DELETE requests:
rows should disappear before those requests complete. Then fail a Soup refresh:
successful deletes should remain hidden after the confirmation closes and clear
their suppression after a successful retry. Partial deletion failures restore
only the failed items.

## Other list actions

With GraphQL Soup enabled, **Rename** updates the row title before the request
finishes, as well as updating previews. **Move to folder**, **Remove from folder**,
and **Duplicate** refresh mounted GraphQL lists after the server responds; a
manual page reload is not required. Duplication does not show a placeholder before
the server returns the new item ID. Use disposable tasks/folders for these checks.

## View and edit task properties

An open task shows Status, Priority, and Assignees as property pills below its title. Task
mentions and document references also show the same three pills in their hover-card preview,
including properties that do not have a value yet. Click a preview pill to edit it without
opening the task; the property picker keeps the preview open while you make a selection.
Users with view or comment access see the same pills read-only.

Selecting Status or Priority dismisses the picker immediately, without waiting
for the save request. With the GraphQL cache active, the pill updates
optimistically while the request is pending. To verify, delay `SetEntityProperty`
on a disposable task: the picker should close before the response, and reopening
it during that delay should not let the earlier save close the new picker.
A failed save uses the mutation's rollback/error handling; it must not reopen
the picker or trigger a success refresh.

For multi-tab status checks, open the same task in several browser tabs
and change status repeatedly in the visible tab. Hidden tabs defer cache-change
refreshes for Quick Access searches, its channel list, and history, plus
cache-triggered GraphQL query rereads. Switching back catches up each affected
reader once against the latest cache state; closed readers must not restart.
Existing rows remain available while hidden. Initial loads, explicit requests,
saves, realtime cache writes, worker recovery, and the shared cache worker still
run. A query already fetching from the server must finish normally rather than
be canceled/reissued on return. Verify task status, mention search, and history
catch up after switching tabs, including when the cache-owning tab is hidden.

## Messages as tasks

In any channel composer, toggle the `Task` switch before sending to create a task from the
message.

### Nested sidebar tags

Tag names containing `/` render with one child level (for example, `Work/Urgent`).
Deeper paths remain in the child label: `Work/Customers/Acme` appears as
`Customers/Acme` under `Work`, alongside any actual `Customers` tag.
Use the caret to expand or collapse a branch. A folder-only parent expands without
filtering; clicking an actual tag selects only that tag, including when it has
children. Personal and team paths stay separate. Ancestors of restored selected
tags start expanded. Filter-menu options continue to show full tag names.
