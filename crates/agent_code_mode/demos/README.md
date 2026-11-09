# HTML code mode demos

Each file is one stored HTML document that recreates a built-in Macro feature
with server programs (`<script type="text/macro">`) and a typed client script,
following the contract in
[the agent guide](../../../docs/agent-guide/documents.md#program-blocks-in-html-previews).
Upload one to Drive and open it in Render to try it.

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

The pages share a few patterns: every read and write is a program, the client
renders with `textContent` and `createElement`, and reloads are coalesced
because live events arrive in bursts and a page runs at most two programs at
once.

`every_demo_page_builds` in `src/domain/document_programs/page_build/test.rs`
builds every page here against the current SDK, so an SDK change that breaks
one fails the test. It needs the pinned Deno, like the other Deno tests:
`cargo test -p agent_code_mode --lib document_programs -- --include-ignored`.
