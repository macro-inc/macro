# HTML code mode demos

Each file is one stored HTML document built from server programs
(`<script type="text/macro">`) and a typed client script, following the
contract in
[the agent guide](../../../docs/agent-guide/documents.md#program-blocks-in-html-previews).
The first table recreates built-in Macro features; the
[cross-domain](#cross-domain) pages combine several areas into tools Macro
doesn't ship. Upload one to Drive and open it in Render to try it.

| Page | Recreates | Reads | Writes | Live events |
| --- | --- | --- | --- | --- |
| `tasks-board.html` | Tasks board grouped by Status | `workspace.page` (tasks), Status options | Change a task's Status; create a task | `document.*` |
| `projects.html` | Projects (initiatives) overview with task progress | `initiatives.list` | Create a project | `document.*` (task progress) |
| `drive.html` | Drive: recent documents and search | `workspace.page`, `search.page` | Create a note | `document.*` |
| `channel.html` | Channel reader | `workspace.page` (channels), `channel.messages` | Post a message | `message.*` |
| `notifications.html` | Notification inbox | `notifications.list` | Mark done, Undo | `message.posted`, `message.mentioned`, `document.created` |
| `routines.html` | Routines with their latest runs | `routines.list`, `routine.history` | Enable/disable; Run now | none |
| `agent-sessions.html` | Agent sessions list | `workspace.page` (agent sessions) | Archive, restore | `agent_session.*` |
| `email.html` | Mail list with Inbox, Important and Sent | `email.links`, `workspace.page` (email) | Archive a thread | none; refreshes on focus |
| `calendar.html` | Seven-day agenda | `calendar.calendars`, `calendar.occurrences` | Add a 30-minute event | none |
| `crm.html` | CRM contacts | `crm.searchContacts` | Add a contact | none |

Mail and the agenda need a connected account, and contacts need a team; without
one, each page says so.

## Cross-domain

These pages do what no built-in feature does: each joins several areas of
Macro into one tool a team or an agent might build for itself.

| Page | Combines | Reads | Writes | Live events |
| --- | --- | --- | --- | --- |
| `weekly-digest.html` | Tasks, documents, channels | Tasks updated and completed in the period, documents edited, each active channel's message count and most-reacted message | Post the editable digest to a channel | `document.*`, `message.posted` |
| `project-health.html` | Projects, tasks, channels | `initiatives.list` with progress; open tasks by their Project property for overdue, due-this-week, unassigned and idle days | Post an overdue nudge with task mentions to a channel | `document.*` |
| `triage-desk.html` | Notifications, tasks, email | `notifications.list`, unassigned open tasks, unread inbox threads | Mark a notification done; assign a task to yourself; archive a thread | `message.posted`, `message.mentioned`, `document.*`; refreshes on focus |
| `standup-composer.html` | Tasks, documents, channels | Your tasks done or under way since yesterday (or Friday), what's next and overdue, documents you own that changed | Post the editable standup to a channel | `document.*` |
| `channel-to-tasks.html` | Channels, tasks | A channel's recent messages, with the ✅ reactions you left | Create a task per picked message (quote and channel link, due date, assignee), reply in its thread with a task mention, react ✅ | `message.*` |
| `workload-board.html` | Teams, users, tasks | Team members and every open task's assignees and due date | Reassign a task, or leave it unassigned | `document.*` |
| `doc-freshness.html` | Documents, users, direct messages, tasks | Documents untouched for N days and their owners | Ask the owner in a direct message with a document mention; for your own, create a review task | `document.updated`, `document.deleted` |
| `automation-ops.html` | Routines, agent sessions | `routines.list` with `routine.history`, joined to the sessions their runs started (`resource_id`); open agent sessions and their turn state | Run a routine now, pause or resume it; archive a session | `agent_session.*` |
| `follow-up-radar.html` | CRM, email, tasks | `crm.searchContacts` with last interaction, the latest email thread per contact, open "Follow up with" tasks | Create a follow-up task and comment on the contact with a task mention | `document.*`; refreshes on focus |
| `release-notes.html` | Projects, tasks, documents, channels | A project's tasks completed in the period and those still in flight | Create the notes document, announce it in a channel, and comment on the project, each with a document mention | `document.*` |

They work around what programs can't do. Email and calendar events are only
read: a program is refused `email.send`, `EmailThread.reply` and
`calendar.createEvent`, so nothing here sends mail or invites. Mentions are
built from `toMention()` parts, since programs import no SDK helpers such as
`msg`, and a document or task must be loaded first so its mention carries a
name. CRM, routines, notifications and email emit no live events, so those
pages reload on related document or message events, or on focus. A listing
has no completion time, so "completed this week" means completed and updated
this week. `channel-to-tasks.html` remembers what it tracked by your ✅
reaction, read from each message's loaded detail (`toJSON().detail`), which
the `Message` handle exposes no accessor for.

The pages share a few patterns: every read and write is a program, the client
renders with `textContent` and `createElement`, and reloads are coalesced
because live events arrive in bursts and a page runs at most two programs at
once.

`every_demo_page_builds` in `src/domain/document_programs/page_build/test.rs`
builds every page here against the current SDK, so an SDK change that breaks
one fails the test. It needs the pinned Deno, like the other Deno tests:
`cargo test -p agent_code_mode --lib document_programs -- --include-ignored`.
