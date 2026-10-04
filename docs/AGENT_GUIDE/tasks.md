# Tasks

## Surface

`Go to Tasks` → `/app/component/tasks`. Tabs: `My tasks`, `Created by me`, `Team tasks`, and `Projects`.
The desktop toolbar contains search (`Ctrl+F`), `Sort`, `Group`, and `Filter`;
the filter uses the legacy compact option rows and searchable Assignee, Created by,
and Tags submenus. Multi-select choices keep the menu open; Escape dismisses it.
The top of the `Filter` menu is a `Filter with AI…` textbox, focused when the menu opens: type a plain-English
description such as `urgent and high priority tasks that are not completed` and press
Enter. It replaces the current selection with the matching Status, Priority, Assignee,
Created by, and Tags options (exclusions on Status/Priority become the complementary
options; subject matter such as `about billing` lands in the search box), then closes
the menu. Requests that only partly map keep the menu open and show a muted note
under the box; requests that map to nothing (excluding a tag, an unknown person,
off-topic text) keep the typed text and show a red error there instead. The box keeps
focus while you type even if the pointer drifts over the rows; ArrowDown moves into
the rows and hovering a submenu hands focus to it as usual. The mobile drawer has no
AI box.
Task creation is available from the `New` button in the Tasks sidebar. Below the tabs the
sidebar has a collapsible `Tags` section listing every personal and team tag, with a
`New tag` button beside the heading. Clicking a tag narrows the current tab to tasks
carrying it (the same selection as the `Tags` group of the `Filter` menu); clicking it again
clears it, and switching tabs clears it like any other filter. On mobile, the tabs
are pills and the leading sliders button opens one drawer containing Sort, Group, and
Filters (including Tags). The mobile bottom dock has the Ask AI input, a separate **+ Task**
button, and Search.

**Keyboard:** Focus one task and press **H** to set or edit its reminder, even
inside an expanded group. **←** collapses the focused item or its parent group.
On a focused group header, **H** collapses only that group; pressing it again
does nothing. Typing H in a text field remains ordinary input.

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

Property edits should update the visible task before the save finishes. To verify,
delay the GraphQL mutation and change Status, an existing Priority, and an unset
Priority in the list and task detail. In a view grouped by that property, the task
should move groups and update both counts immediately. Reject a save to check that
the value, group membership, and counts all roll back without refreshing the page.

For tags, include a task with no prior tag assignment. Delay
`UpdateEntityPropertyOptions` and the following `EntityProperties` query: the tag
should appear immediately and stay visible through both responses in the list,
task header, side panel, and a reopened picker. A rejected save should remove only
the optimistic tag. Repeat with an existing assignment and with removal.

## Reviews view

With `enable-tasks-reviews` enabled (on by default in development), a
`Reviews` shortcut appears above `My Tasks` in the Tasks sidebar and mobile tabs.
It opens a separate `/app/reviews` shell whose sidebar lists `Pull requests`,
`Authored by me`, `Assigned to me`, `Involves me`, and `Review requests`;
`Involves me` is selected by default. The selected tab is stored in the URL and
survives opening a PR and returning through the breadcrumb.
The list contains accessible GitHub pull requests of any status. `Involves me`
uses the server's participant filter for your linked GitHub account: author,
requested reviewer, assignee, commenter, or reviewer. Participant IDs are retained
across partial GitHub refreshes, so this is not strictly a list of current
review requests.
`Authored by me`, `Assigned to me`, and `Review requests` match the linked
GitHub user ID. If the link-status endpoint has no identity, the list explains
why the tab is unavailable.
Search, filter, and sort controls appear above the list. Filters cover
repository, author, assignee, label, and, when a GitHub identity is linked,
reviews (Reviewed by you, Not reviewed by you, and Awaiting review from you).
Saved review selections stay inactive, including their filter badge and empty-state
copy, while the GitHub identity is unavailable; they resume when it returns.
Sort offers Recently updated, Least recently updated, Newest, and Oldest. When visible PRs
have GitHub labels, a Labels section below Favorites lists them with their
colors; choosing a label shows only PRs with it, and choosing it again clears
it. PR rows use the shared entity layout with selection checkboxes,
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
Opening a PR refreshes it from GitHub in the background for viewers with a
linked GitHub account, so labels, reviewers, and review state catch up without
waiting for GitHub's next webhook. A successful refresh also reloads the Changes
summary, so new commits replace the previous diff range.
Its breadcrumb returns to the Reviews list. Old `/app/pr/<id>` links redirect
to the Reviews detail. When the flag is off, the Reviews shortcut is hidden and
opening `/app/reviews` redirects to `/app/tasks` after flags load. Copied PR
detail links still work; check both URLs with the flag off.

The PR header has a **Changes** toggle (`aria-pressed`) with the diff's `+N −M`
at the PR's current base and head. It opens the same resizable Changes pane as
an agent session (see "Reviewing a linked GitHub pull request" in
[AI chat](ai-chat.md)) beside the PR, read-only: there is no review-note gutter,
notes chip, or hand-off card. The PR's split stores the pane in
`s<N>.changes.pane` and `s<N>.changes.style`, the same as a session, until you
leave the PR or close its split. The first view of a base and head reads GitHub; later
views, and agent sessions linked to the same PR, reuse the stored diff. An
unavailable or oversized PR is explained in the pane.

The Agent sessions side-panel section distinguishes loading PR details, loading
sessions, failed requests, and an empty result. Failed session requests offer Retry.
Hover a truncated session name to see its full name.

Check all five tab URLs, the Labels section, author avatars and display names, row selection and
context menu, favorites add/remove and collapse/empty visibility, filters, sort,
illustrated empty states, loading, errors, and pagination after filtering. Use
Open in new split from a PR row's context menu; verify the Reviews list stays in
the original split and the PR appears beside it. Open a favorite from the global
sidebar, return through the breadcrumb, and open a copied link in a second split.
Open a PR's Changes pane; check the file tree, a file's diff, **Unified / Split**,
refresh after new commits, and that reloading with `s<N>.changes.pane` in the URL
restores the pane. Check session loading/error/empty copy and full-name tooltips.
Use existing PRs and do not modify hosted data.

## Create a task

On touch devices, task creation opens in a bottom sheet with a drag handle and
scrollable, keyboard-aware content. Its glass pane has broad screen-scaled
corners, an 8px outer inset, and a blurred backdrop, matching the create and
filter sheets. Desktop uses the centered composer dialog.

1. Click the `Task` button (or `Create` → `Task T`, or keyboard `c` then `t`).
2. A dialog opens with the title contenteditable focused (placeholder `New task`), plus
   `Add description...`, and property buttons: `Not Started` (status), `Priority`, assignee
   chip (defaults to you), `Due Date`, `Project` (when Projects is enabled; the standard
   property dropdown, listing projects), `Change or select tags`, `Attach image or video`,
   a `Create More` switch, and `Create Task Ctrl ↵`. If the chosen project can't be
   set, the task is still created and a toast says it wasn't added to the project.
   The `Shared with Team` row defaults to on and remembers your choice in local
   storage across composer openings and page reloads. Its hint explains whether
   the task will be visible to your whole team or only to you and the people you
   share it with. The choice also applies to Create More, continuing in a split,
   and tasks created from a project.
   This row sits below the creation buttons, separated by an edge-to-edge divider.
   A second divider separates it from Similar Tasks when matches are shown.
3. `type_text` the title, then press **Ctrl+Enter** to create (the `Create Task` button
   enables once there is a title). Dialog also offers `Continue editing in split` to open the
   task as a full document.

Tasks are documents under the hood (creation hits `POST /dss/documents/create_task`), so they
also show up in Files/`All` and in AI-chat document listings.

## Projects

Projects are enabled by default in development. Production rollout is gated by
PostHog `enable-projects`; `VITE_ENABLE_PROJECTS` overrides either environment.
When off, Tasks hides
the Projects tab, project column, and assignment actions. A saved Projects tab
temporarily shows My Tasks without overwriting the saved selection.

Choose the `Projects` tab in Tasks, or open `/app/component/tasks-projects`.
Projects use the same list rows, property cells, selection, group headers, and
keyboard navigation as Tasks. Search (`Cmd/Ctrl+F`), `Sort projects`,
`Group projects`, and `Filter projects` sit above the list. Groups default to
Status; choose None, Priority, or Assignee to change them. Click a group header
or use the list's disclosure keys to collapse or expand it. Sort by Updated
or Created. Filters include Status, Priority, and Assigned to me;
`Filter due date` provides From and Through bounds and `Clear dates`.
Search and filters apply before pagination. Scrolling or navigating near the
end loads more projects; `Load more projects` also continues the list.
Keyboard movement changes focus; Enter opens the focused project and
Shift-selection opens it in a new split. Folders remain separate in Files.

Right-click a project row for its context menu; the row takes focus, as in
Tasks. Every project offers `Open in new split` (disabled when no split fits),
`Copy Link` (the Overview link), `Copy ID`, and `Share`, which opens the same
Share menu as the project's top bar. Edit access adds `Rename`, which opens a
name dialog, and the `Set status` and `Set priority` submenus; owners also get
`Delete`, which confirms first and leaves the project's tasks in place.
Right-clicking one of several checked rows acts on the whole selection and
offers only `Set status`, `Set priority`, and, when you own every project,
`Delete`. A partially failed delete keeps only the failed projects in the
dialog for retry. On phones, long-press a row for the same actions in the
bottom action drawer, without `Open in new split` and with each Status and
Priority choice as its own row. Use disposable projects: these actions change
hosted data.

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
Leaving a property unset keeps its normal server default.
Submitting closes the composer at once; a full composer returns its split to
Projects, and Back skips the submitted composer. One request creates the project
together with its selected properties: a value the server rejects fails the whole
create, so no half-configured project is left behind. When the server answers, a
`Project created` toast offers `Open` and `Open (New Split)` (on touch devices
both open in place); nothing navigates on its own. The Projects list then
refreshes in the background to include the new row. If creation fails, the
composer reopens as a popover with the draft and the error.
Closing the popover without submitting keeps the underlying view open.

Opening a project keeps the Tasks workspace and its navigation. The top bar
shows the Projects return breadcrumb and the project name, with the same Share
and side-panel controls as task detail. Choose Overview or Tasks in
that top bar. Opening an associated task extends the breadcrumb trail; choose
the project breadcrumb to return, or Projects to restore the collection and its
filters, groups, and scroll position. Project URLs retain identity and section:
`/app/component/initiative-view~<project-id>~overview` (or `tasks`).
Project properties live in the shared floating information panel and honor
project access. Editors can rename the project; its owner can delete it.
Deleting a project leaves its tasks in the workspace.

Project information panels start closed and float over the content at every
width, both in the Tasks project view and standalone initiative blocks. Opening
the panel does not resize the content; use its toggle or click outside to close.

Share (or Cmd+S) opens the same Share menu as tasks and documents: the
`To: Email or group` field, optional message, access choice, and `Share`
action. Only the owner can share; other members get Copy Link. Owners can open
`Manage collaborators` from People. The usual team and link-access controls and
Copy link action use the same menu as other entities; copied links open the
project's Overview. Access changes also apply to the description. Sharing to a
channel posts a native project chip, which opens the project in Tasks; channel
attachments list it in their Projects section.

Assigning a person to a project also adds them as a collaborator with edit access.
Clearing the assignee leaves that access in place; the owner can remove it through
Manage collaborators in Share. Removing a collaborator does not clear assignees.

Project Assignees also offers the same agents as task Assignees. Choose an agent
in the project composer, Overview property pills, project list, or Properties
side panel; dismiss the picker to save. The picker explains that assigned agents
automatically take on tasks created in or moved into the project. People and
agents can remain assigned together. Existing agent permissions still apply:
private agents run for their owner, and shared team agents run for team members.
Assigning an agent to the project does not start work on tasks already in it.
Removing the project agent stops assignment to future tasks; it does not cancel
sessions already started for its tasks.
For verification, create a task from the project's Tasks tab, then move another
task into the project through `Add to project…`; both should start the assigned
agent's normal task session and show its message in the task's Discussion.

Overview's Description uses the shared collaborative Markdown editor on the
project's collab surface and saves automatically; its access follows project
access. Edit/owner access allows typing; view/comment access is read-only. Two
tabs on the same project see each other's edits live. The description is part
of the native project view and does not open a separate document block.
It edits like a markdown document body: `/` opens the commands menu (headings,
lists, checklists, quotes, code blocks, tables, equations, links, images,
video, dividers, and creating a task), `@` mentions, `:` emoji, `;` snippets,
and markdown shortcuts work. Tables have the document's insert, resize, move,
and delete controls; blocks have drag handles; files and images can be pasted
or dropped in, and items dragged from lists insert mentions. Mentions in a
description are not tracked as document references, so mentioned users are not
notified. Document-only tools (comments, tags, AI writing, find and replace) are
not available in descriptions.
Discussion appears below the description, using the same discussion component
as tasks. The surface has the project's id and is created on first open, or at
creation when one is given (agents can pass a description). Projects no longer
have description documents; older ones are ignored and stay hidden from document
search, history, and Soup lists.
An unavailable connection shows `Retry description` without clearing saved content.

A task's project is its `Project` system property: one reference to the project,
set only on tasks. Setting it needs edit access to the task and the project;
removing it needs edit access to the task. The project's Tasks tab lists the
tasks whose Project property names the project.

The project's Tasks tab starts with the task search, controls, and unified list;
the project title and property pills appear only on Overview. Use
`New task` to create a task in the project: the composer opens with its Project
set to this project (change or clear it like any property), and the create
request carries it, so there is no separate assignment step. The new row appears
once the task is created. Verify this with GraphQL Soup both enabled and
disabled. The section tabs
use the same control as Channels. Editors can choose `Add existing tasks` beside
`New task`, search for tasks, select several, and confirm `Add N tasks`. Tasks
already in this project are excluded. Adding a task moves it from its previous
project; the dialog explains this before saving. A partial failure keeps only
failed tasks selected for retry, and a request failure preserves the selection.

The regular Tasks list includes a Project column. Its cell is a regular property
cell: clicking it opens the same entity dropdown as the other property columns,
listing projects. Narrow lists show Project as a compact pill after the row's
Status, Priority and Assignees pills. Right-click a task and choose `Add to project…` to choose or clear
its project. On mobile the same action is in the long-press menu. For a selection,
choose `Actions → Add to project…`; there is no separate assignment button in the
selection toolbar. A context action on a selected row applies to the selection.
Inside an open task, Project is a regular property: a pill beside Status,
Priority and Assignees below the title, and a row in the Properties side panel.
Both open the standard property dropdown, which searches projects; clear the
value there to remove the task from its project. `Add to project…` in the
title's actions menu does the same. Tasks show Project even before it's set,
and the `Add property` picker doesn't list it.

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

The Assignees picker offers people and available agents together. Agent rows show
their name and an `Agent` label; saved agents also show their `@handle`. Search by
name or handle to find one. Built-in session agents follow the same availability
as message mentions, alongside your own and team agents.
Select an agent in the task composer, then create the task to start its session.
For an existing task, add an agent to Assignees and dismiss the picker to save and
start the session. Discussion gains one message linking to the assigned agent's
session; progress and final answers stay in that session. The agent retains the
original task reference in its session instructions and updates the task's
description or status as appropriate. It must not post or edit discussion messages
unless explicitly asked. This also applies to task assignments inherited from a
project. When the task belongs to a project the assigning user can view, the
startup prompt links that project and tells the agent to read its current
description before starting work. The assignment instructions and task details
are private startup context; no message is posted as you. People and agents
can remain assigned together. Removing an agent and saving, then assigning it
again starts a new session; saving an unchanged assignment does not restart it.

Selecting Status or Priority dismisses the picker immediately, without waiting
for the save request. With the GraphQL cache active, the pill updates
optimistically while the request is pending. To verify, delay `SetEntityProperty`
on a disposable task: the picker should close before the response, and reopening
it during that delay should not let the earlier save close the new picker.
A failed save uses the mutation's rollback/error handling; it must not reopen
the picker or trigger a success refresh.

In the task list, setting an **unset Priority to Urgent** also updates before the
response, including when no priority assignment exists yet. Verify another task's
unset priority stays unchanged. First assignments target the normalized entity
through a fragment-rooted relation recipe: no flat/grouped Soup page discovery
or pre-save network fetch is needed, even with more than 128 cached pages.
Check a grouped-only row and an offline/reloaded queued edit as well.
Property-group moves read only mounted, enabled grouped queries and their loaded
continuations, never all historical cache variants. Verify that a move still works
with more than 128 cached grouped pages, that duplicate split views do not multiply
membership reads, and that closing/disabling a view stops its revalidation. Bulk
moves share membership reads for distinct entities; repeat edits to one entity
reread its installed optimism. Each durable mutation retains its own recovery
queries so partial failures and offline replay still reconcile correctly.
On success the temporary assignment is replaced
by the server assignment without a blank cell or duplicate property; failure
restores the unset cell. Bulk property edits install every optimistic layer before
the first HTTP response, while network requests retain durable queue ordering.
The bulk save remains pending until every queued item settles, including while
offline; queue acceptance alone is not success. Delay the second response after
the first succeeds: no success callback or refresh should run yet. Then reject
the second request: the bulk save reports failure, the first task keeps its
committed value, and only the second task rolls back. Repeat with both requests
succeeding and with the first failing before the second succeeds.

A self-contained browser regression uses the production list cell, mutation hooks,
and worker/WASM cache with delayed fixture HTTP (no hosted task edits). From
`apps/web`, run `just build-cache-wasm`, then
`bunx playwright test -c src/features/tasks-view/browser-test/playwright.config.ts`.
The harness defaults to port 3004; `TASK_PROPERTY_TEST_PORT` can select a verified
same-worktree dev server.

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
