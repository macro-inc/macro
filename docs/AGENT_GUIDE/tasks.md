# Tasks

## Surface

`Go to Tasks` → `/app/component/tasks`. Tabs: `My tasks`, `Created by me`, `Team tasks`, and `Projects`.
The desktop toolbar contains search (`Ctrl+F`), an icon-only `Task layout` dropdown, `Sort`, `Group`, and `Filter`;
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
Task creation is available from the `New` button in the Tasks sidebar. With Projects
enabled, `My projects` appears below the tabs and favorites, above Tags. It lists
accessible projects by most recently updated, with a capped height and its own scroll
area. Click a project to open its overview within the current Tasks view, keeping
the sidebar mounted, or Shift-click to open it in a new split.
The current project is highlighted. Collapse the heading to hide the list; this
preference persists. `Load more projects` fetches the next page when available.
The plus button beside `My projects` opens the project composer, even while the
section is collapsed or loading. Its rows use the shared project query/cache and
load inside a local Suspense boundary, leaving sidebar controls available.
Once a current-query project page is cached, an offline/background refresh failure
must not show **Could not load projects** beside those rows (or a cached empty
result). Retrying a refresh must not reintroduce that warning merely because the
refresh promise rejects; the cached project links remain available. Cache misses,
server/permission errors, and failed **Load more projects** requests still show
failure and retry controls. Verify both background refresh and manual retry.
Opening a project shows a content-shaped skeleton while its data loads: title,
wrapping property pills, description, and discussion for Overview; toolbar and
rows for Tasks. The mobile skeleton uses the same compact insets as the content.
The description has its own subtle three-line skeleton while its collaborative
editor initializes; the project title, properties, and discussion stay visible.
Project task lists automatically fetch all matching pages in every group, without
per-group `Load More` rows. A failed continuation stops automatic requests and shows
`Try again` above the list; already fetched group rows remain available.
The sidebar also has a collapsible `Tags` section listing every personal and team tag, with a
`New tag` button beside the heading. Clicking a tag narrows the current tab to tasks
carrying it (the same selection as the `Tags` group of the `Filter` menu); clicking it again
clears it, and switching tabs clears it like any other filter. On mobile, the tabs
are pills and the leading sliders button opens one drawer containing Sort, Group, and
Filters (including Tags). The mobile bottom dock has the Ask AI input, a separate **+ Task**
button, and Search.
Mobile does not show the separate layout, sort, group, and filter toolbar.
Use the compact sliders drawer for task-list controls; project task lists use the
same drawer. Mobile supports List only. Opening a Board or Gantt link, or
restoring either layout, automatically selects List and replaces that host's
layout URL parameter without adding history or clearing search, sorting,
grouping, or filters. Desktop supports List, Board, and Gantt.

**Keyboard:** **H** and **←** collapse the focused item or its parent group.
On a focused group header, **H** collapses only that group; pressing it again
does nothing. Typing H in a text field remains ordinary input.

New accounts are seeded with three sample tasks (`Intro to tasks`, `Advanced task features`,
`How we use tasks at Macro`).

The Project column shows the linked project's name when one project is assigned,
and `Project` when empty. Multiple linked projects show an item count.
Long assignee and project names truncate within their columns; hover the cell
to read the full value.
The project pill beneath a task title shows the project icon and name without
a `Project:` prefix.

Click a task row or favorite to replace the list with the editable task document. Its top
bar shows the originating task tab as a text-only return breadcrumb,
followed by the task name and actions, Share, and the Details/Properties side-panel
toggle. The return label matches the task title's font weight in both wide and narrow
layouts. Narrow splits also show a close button when multiple splits are open. Choose
the originating tab breadcrumb, a task tab, or a tag to return to the list.
Shift-click a row or favorite to open it in a new split
instead. Keyboard list navigation only moves focus; press Enter to open the focused task.

## Gantt layout

Choose **Gantt** from the **Task layout** dropdown to see task timelines.
The same option is available in a project's Tasks section. The timeline uses
Created at as the start and Due date as the end; no separate Start date is
created or saved. Dashed, open-ended bars mean no due date is set. Invalid or
missing start dates and due dates before creation are identified rather than
silently displayed as valid intervals.
The calendar fills the available pane width and height, including empty space
below loaded rows. Zooming, resizing, and loading earlier items preserve the
visible calendar position. On first load, the chart centers on today after its
viewport is measurable. Refetches and later resizes do not reset the scroll.
Bars use the task color. Calendar content stays outside the sidebar during fast
horizontal scrolling. The pointer's date label stays in the sticky calendar header
during vertical scrolling, and the vertical scrollbar begins below that header.
Hold **Ctrl** and scroll to zoom between 4 and 80 pixels per day, keeping the date
under the pointer in place. Ordinary scrolling is unchanged. Period presets in
the settings menu also set zoom; calendar labels adapt to the zoom level.

**Today** centers the current day; its line extends into the calendar header,
stays above row hover backgrounds but behind bars, and remains outside sticky labels. The settings menu
changes the displayed period (Day, Week, Month), toggles calendar lines, and
changes their spacing (Daily, Weekly, Monthly) and
style (Solid, Dashed). Grid settings do not change item dates. Larger bold month
headings use abbreviated months and an apostrophe before the two-digit year
(for example, **Oct '26**), anchored to their calendar cells rather than sliding
across them. Labels remain visible during horizontal scrolling, and the date
header remains visible during vertical scrolling. The calendar extends as you
approach either horizontal edge. Click a task label or bar to open the task;
right-click either for the same actions as its list item.

When editing is permitted, drag a bar's right edge to change Due date. The edge
tracks the pointer smoothly and shows a date tooltip below the edge. There is no
resize snapping indicator or settling animation. Release saves the calendar date.
Escape cancels the preview; failed saves restore the previous date.
Arrow keys on the resize handle change one day; Shift changes one week.
Created at stays fixed: whole-bar dragging and start-date resizing are unavailable.

A subtle diagonal-line scrim marks calendar space where creation is unavailable:
before today, or throughout the calendar when creation is not permitted. It stays
outside the sidebar and header; available space remains clear. Drag horizontally
across clear space to open the task composer with Due date prefilled and visible.
This works with no loaded rows too. Release opens the composer rather than
immediately creating a task; Escape cancels the selection.
In a project's Tasks section, creation preserves that project and its edit gate.
The Projects collection offers the same interaction with the project composer.
There is no Start date property, so the selection sets only Due date; Created at
remains automatic. New selections begin today or later, so creation never produces
an end before Created at. Existing overdue items remain unchanged.

The timeline reuses the list's filtered, sorted, grouped rows and collapsed
state. Use **Load more tasks** to continue a group or the task feed; the chart
contains loaded results, not an implied complete schedule. Selecting Gantt
persists in `tasks.layout` or `projectTasks.layout`, just like List and Board.

## Board layout

Open the icon-only **Task layout** dropdown in the toolbar and choose **Board**
(or **List** to switch back). Its icon reflects the current layout. **Group by**
offers Status, Priority, Assignee, and (when Projects is enabled) Project.
Both layouts share one grouping, which restores with the Tasks navigation entry.
List-only None and Date groupings display Status columns in Board; switching
back to List retains those selections and collapsed groups until grouping changes.

Click a card's body or title to open the task. Move at least 10 pixels with the
mouse button held to start dragging to another column; holding still does not
start a drag. Property pills remain interactive and do not start a drag.
A new destination column highlights once movement slows
or pauses for about 100 ms. Fast travel suppresses activation of new columns.
A valid hover shows **Board sorted by Updated**, **Created**, or **Viewed**
using the active sort label. The drop does not choose a pointer insertion slot:
its card takes its place in the current sort (or search relevance order).
Same-column moves and column reordering remain disabled.
Layout, primary sort, sort direction, and grouping are reflected in `tasks.layout`,
`tasks.sort`, `tasks.sortReversed`, and `tasks.groupBy` search parameters.
Explicit URL values override saved preferences; back/forward navigation
restores the corresponding controls, including the layout.
Columns are 336px wide. Each column pages independently with **Load more tasks**.
Use the horizontal scrollbar to reach more columns. Vertical wheel input over
empty board background or gaps also scrolls horizontally. A wheel gesture stays
with its original scroll area until momentum stops, even if another column moves
under the pointer. A new gesture inside an overflowing column scrolls vertically.
Each column has its own vertical scrollbar when its cards overflow, while keeping
its heading visible. Lane scrollbars appear while hovering the lane or scroll track
and hide 200 ms after leaving. Off-hover momentum does not reveal them; focus and
active scrollbar dragging retain visibility.
Normal columns fit their content up to the viewport height; only the hidden-column
summary fills the height. Both columns and cards are virtualized, so offscreen
content is not all present in the DOM. A column's vertical position restores when
scrolling away and back. The active drag source
stays mounted while scrolling to a destination.
While dragging, hold the card near a column's top or bottom edge to scroll its
cards vertically. Hold near the board's left or right edge to scroll horizontally;
moving beyond that edge keeps scrolling until release or cancellation. Valid drops
still require the pointer to be inside a visible destination column.

Column titles use status/priority icons, assignee avatars, or the project icon.
Active filters also restrict columns: excluded values do not remain as empty
boards. Allowed Status and Priority values retain empty destinations. Assignee
and Project columns come from matching task groups; there is no extra-column
selector. When filters hide known columns, a full-height dashed summary appears
at the end. A filter illustration, count, and outline **Reveal hidden columns**
button stay near the top of that column.
Status and Priority show **N hidden**. Assignee and Project show **N+ hidden**:
these lower bounds count known groups, not every group excluded by server filters.
**Reveal hidden columns** clears only the current grouping's filter;
other filters, the current tab, and search stay active. The dashed column is not
a drop target.

An icon-only status pill appears before the task title, and an icon-only assignee
pill appears to its right in every grouping. The lower row omits status, assignee,
and the grouping property. The remaining properties use standard pill controls
and icons. Priority uses a compact icon-only pill; due date and project appear
when set. Read-only tasks keep passive property pills.
A task assigned to multiple people appears in each person's column. Moving it
from Alice to Bob replaces Alice while keeping the other assignees. Moving to
**Unassigned** clears all assignees. Project moves change the task's Project
property (an initiative), never its legacy folder.

Only editable tasks can move. Access checks and property definitions can keep
moves unavailable while loading. A destination project also requires edit
access. A pending move disables further moves of the same task in every column;
failed writes use the shared property mutation's rollback and show an error.
A valid destination highlights and shows the sort overlay only while dragging
inside that column, not in gaps or outside the board. Drops move the card
immediately while the save is pending; failures restore its prior membership.
After a successful save, the board scrolls only as needed to reveal the destination
card, including virtualized columns and rows; already visible cards stay in place.
It does not scroll after a cancelled or failed drop, or when the current board
scope changes during the save. Successful moves show no notification.
A cross-column drop settles one opaque visual copy from the card's release position
into its sorted destination; the real card appears when the copy lands. The release
snapshot survives source unmounting after edge scrolling. Sorting updates retarget
an in-flight copy without restarting from the source column.
Visible placements animate during moves and rollback without animating ordinary
scrolling or paging. In Assignee grouping, moving to an already assigned person
reveals the existing card rather than creating a duplicate.
Reduced-motion preferences disable these transitions.
Filters remain active: completing a task or removing yourself as assignee can
hide the card from the current view. Click its title to open the task; modified
clicks can open a separate split.

Due-date columns and priority/due-date sorting are not in this version.
The shared board primitives remain independent of Tasks queries and mutations.

## Cached grouped lists

With GraphQL caching enabled, previously loaded grouped task lists remain usable
when their background refresh fails without an HTTP response. Load a Priority-grouped
view online, navigate away, then reopen it offline. Repeat by holding its GroupSoup
request: cached rows should appear before the response, and rejecting that request
must not replace them with **Tasks couldn’t be loaded**. A cached empty result is
also usable. An initial cache miss still shows failure; HTTP and GraphQL errors
remain visible even with cached rows. Change filters while retaining prior rows:
those older results must not hide a failure for the new, uncached query.

## Reviews view

With `enable-tasks-reviews` enabled (on by default in development),
`Reviews` is available in desktop navigation and the mobile bottom dock's
`More views` drawer, not the mobile Tasks tabs.
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
Search, filter, and sort controls appear above the list. Below them, the same
sliding tabs used by Chat offer Open and Closed. Open is the default; Closed
includes both closed and merged PRs. The filter dropdown and mobile drawer also
offer independent Open, Closed, and Merged selections. Custom multi-status
selections hide the tabs, except the combined Closed preset keeps them visible.
A partial Closed-only or Merged-only selection leaves both tabs unhighlighted.
Status combines with other filters, counts toward filter badges, and applies
before pagination. Clearing filters resets to Open. Other filters cover
priority, linked work, started from, repository, author, assignee, label, and,
when a GitHub identity is linked, reviews (Reviewed by you, Not reviewed by you,
and Awaiting review from you). The list topbar says
Reviews when narrow or when the sidebar is collapsed; the selected scope stays
visible as a heading above search.
Saved review selections stay inactive, including their filter badge and empty-state
copy, while the GitHub identity is unavailable; they resume when it returns.
Sort offers Priority, Recently updated, Least recently updated, Newest, and Oldest;
Priority orders the loaded rows most urgent first and keeps recency within a
priority. When visible PRs
have GitHub labels, a Labels section below Favorites lists them with their
colors; choosing a label shows only PRs with it, and choosing it again clears
it. PR rows use the shared entity layout with selection checkboxes,
author avatars and names, and a context menu. The current user's Macro display
name appears when their linked GitHub identity matches the PR author; other
authors fall back to GitHub names. The virtualized list fetches more pages as
you scroll, including when local filtering removes most fetched rows.
Linked agent sessions appear alongside the row's other metadata pills and beneath
the PR detail title. Narrow PR rows put wrapping metadata below the title, keeping
session chips visible without squeezing the title. One session shows its name with the agent sparkle icon;
multiple sessions show a count chip that opens a list of names. Selecting a name
opens that session; Shift-click on the single-session chip opens another split.
Chip clicks do not open or select the containing PR row. Empty results have no
chip, and loading, private, deleted, or unavailable sessions never offer navigation.
The PR's status pill stays passive; status filtering lives in the Reviews list tabs.

Each PR row shows what it links to. A priority icon before the title comes from
the most urgent open linked task (a closed task counts only when none is open),
otherwise from a GitHub priority label (`P0`–`P3`, `priority: high`, `urgent`,
`critical`); the tooltip names its source. Pills before the author show the
linked **Agent session**s (sessions an agent opened the PR from, or a person
linked), **Customer**s (CRM companies in linked tasks' Companies property, or a
company whose thread started a session), **Ticket**s (tasks the PR text, branch,
or comments mention as `MACRO-<id>`, and tasks whose thread started a session),
and **Channel**s (channels whose thread started a session). A pill with one item
opens it (Shift-click for another split); with more it shows `+N` and opens a
list. Items the viewer cannot access are omitted. Rows show a pulsing
placeholder while links load. The first pill names where the PR was started
(Claude, Codex, Cursor, Devin, Copilot, Jules, or Macro), including PRs opened
outside Macro: a Macro agent session that opened the PR wins and shows the tool
its harness ran; otherwise a session link in the description (`claude.ai/code/…`,
`chatgpt.com/codex/tasks/…`, `cursor.com/agents…`, `app.devin.ai/sessions/…`,
`jules.google.com/…`, `macro.com/app/agent/…`), then footers such as
"Generated with Claude Code" or a `Co-Authored-By: Claude` trailer, then the
bot author (for example `Copilot` or `devin-ai-integration[bot]`), then the
branch prefix (`claude/`, `codex/`, `cursor/`, `devin/`, `copilot/`, `jules-`).
Its tooltip names the signal; clicking it opens the Macro session in a split or
the external session in a new tab. Filters add **Priority** (including No
priority), **Linked to** (an agent session, a ticket, a customer, a channel),
and **Started from** (each tool, or Unknown); these run on the loaded rows,
which wait for their links before matching. The PR side panel's **Linked work**
section shows the same origin under **Started from**, plus the priority,
tickets, customers, and channels.

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
Check both status tabs and the menu's individual statuses. Confirm Closed includes
merged PRs, custom multi-status choices hide the tabs, and Clear filters returns
to Open. Combine status with a repository filter while loading another page.
Repeat on touch. Check the tabs follow search and filters, and that the topbar
shows Reviews after narrowing or collapsing navigation.
Check zero, one, and multiple linked sessions in PR rows and beneath the detail
title, including keyboard activation and a long name. Open the count menu, choose
a session, and confirm the PR row was not activated. Check permission-denied and
loading session previews remain disabled.
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

On desktop, **Project layout** offers **List** and **Gantt**. Gantt shows one
bar per visible project from Created at to Due date, using the same search,
filters, sort, grouping, and pagination as the project list. Click a project
label or bar to open its overview. Right-click either for its project list menu.
The same timeline settings and permission-gated Due date resize controls apply
as in task Gantt. **Load more projects** continues the chart.
The selection persists in `projects.layout` and restores with the navigation
entry. Projects without a due date have explicitly open-ended bars. Mobile
continues to render the project list.

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
with a project name, a Markdown description (`Add description...`), and the
shared property pills for Status, Priority, Assignees, and Due date. Team
sharing is enabled by default. As in the task composer, Enter or ArrowDown in
the name moves to the description instead of creating the project; Escape, or
ArrowUp/Shift+Tab at the start of the description, returns to the name. The
description seeds the project's Overview description.
Project Status offers `Not Started`, `In Progress`, and `Completed` in the
composer, list, and detail/side-panel pickers. The Status filter uses the same
three choices. Task statuses are unchanged. Existing project values from the
previous status catalog remain visible until an editor changes them.

Submit with
`Create Project` or Cmd/Ctrl+Enter from the name or description. `Continue
editing in split` preserves the name, description, properties, and sharing choice; `Clear Draft` resets an uncreated draft.
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
and side-panel controls as task detail. `Project actions` (the dots button
after the name) opens the row context menu's entries for this project,
including `Delete` for its owner. Choose Overview or Tasks using the inset
tabs in that top bar. In Tasks, an outlined circular search button expands into
a focused `Search in <project name>` field. Close or Escape clears the query and
restores focus to the button. The task toolbar stays the same height and scrolls
horizontally in narrow splits, keeping list controls, Add existing tasks, and New
task accessible. Opening an associated task extends the breadcrumb trail; choose
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

The project's Tasks tab starts with task search, controls, and the selected List or
Board layout; the project title and property pills appear only on Overview.
Use the same icon-only **Task layout** dropdown to choose a layout. Both layouts
show only tasks linked to the current project and use the same filters and editors.
Layout, sort direction, and grouping use `projectTasks.layout`, `projectTasks.sort`,
`projectTasks.sortReversed`, and `projectTasks.groupBy` URL parameters, independent
of the main Tasks view's controls. Saved project entry state remains the fallback
when URL parameters are absent. Use
`New task` to create a task in the project: the composer opens with its Project
set to this project (change or clear it like any property), and the create
request carries it, so there is no separate assignment step. The new row appears
once the task is created. Verify this with GraphQL Soup both enabled and
disabled. The section tabs
use the same control as Channels. Editors can choose `Add existing tasks` beside
`New task`; both actions use bordered buttons with a background. `Add existing
tasks` opens an anchored task-selector dropdown: search, select several, and
confirm `Add N tasks`. Escape or Cancel dismisses without assigning tasks. Tasks
already in this project are excluded. Adding a task moves it from its previous
project. A partial failure keeps only
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
