---
name: get-started
description: Use when the user wants to find, read, summarize, or create documents, tasks, channel messages, or other items in their Macro workspace.
---

# Working in Macro

Macro's tools are grouped by kind of item and by what they do:
`<kind>_read` only looks, `<kind>_write` creates or changes something,
`<kind>_send` sends something outside Macro (an email, an invite), and
`<kind>_delete` deletes, overwrites or makes another change that can't be
undone. Each tool's description says what its kind covers and lists its
operations; pass one as `op` with its inputs.

1. Find first. `search_read` searches everything the user can see. For a
   known kind, use its own read tool: `documents_read` (`documents.recent`,
   `documents.search`), `tasks_read` (`tasks.search`), `channels_read`
   (`channels.search`, `Channel.messages`), `projects_read`
   (`projects.search`), `email_read`, `calendar_read`.
2. Read before answering. Read a document's content or a channel's messages
   before summarizing them, and quote what is actually there. If nothing
   matches, say so; don't guess at contents.
3. Link to what you found. Results carry each item's `url`; use it.
4. Ask before changing anything. Before any `_write`, `_send` or `_delete`
   call, say what will change or go out, and wait for the user to agree.
5. Items are referenced by id or by their Macro URL.
6. People are tokens. Results show each person as `person_u_…` (a Macro
   user) or `person_e_…` (an email address), never their address. Pass a
   token back as it is wherever a tool takes a person: assigning a task,
   mentioning someone, filtering by owner. Call `people_read` for a name or
   email only when the user asks for that person's contact details.

Only the signed-in user's own workspace is reachable: what they can see in
Macro is what these tools can see.
