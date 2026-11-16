---
name: get-started
description: Use when the user wants to find, read, summarize, or create documents, tasks, channel messages, or other items in their Macro workspace.
---

# Working in Macro

Macro's tools are grouped by kind of item and by what they do:
`<kind>_read` only looks and `<kind>_write` creates or changes something.
Each tool lists its operations; pass one as `op` with its inputs.

1. Find first. `search_read` searches everything the user can see. For a
   known kind, use its own read tool: `documents_read` (`documents.recent`,
   `documents.search`), `tasks_read` (`tasks.search`), `channels_read`
   (`channels.search`, `Channel.messages`), `projects_read`
   (`projects.search`).
2. Read before answering. Read a document's content or a channel's messages
   before summarizing them, and quote what is actually there. If nothing
   matches, say so; don't guess at contents.
3. Link to what you found. Results carry each item's `url`; use it.
4. Ask before changing anything. Before a `documents_write` or
   `tasks_write` call, say what will change and wait for the user to agree.
5. Items are referenced by id or by their Macro URL.

Only the signed-in user's own workspace is reachable: what they can see in
Macro is what these tools can see. Results leave out people's user ids and
email addresses.
