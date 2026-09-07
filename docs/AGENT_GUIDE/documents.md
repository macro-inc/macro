# Documents

## Create and type

1. `Create` → `Document D`. The app navigates to `/app/md/<uuid>` with the **title field
   focused**.
2. `type_text` the title, then `submitKey: "Enter"` to drop into the body.
3. Type paragraphs with plain `type_text`; use Enter between paragraphs. Do NOT use `fill` —
   the editor is contenteditable and `fill` does not work on it.
4. The document auto-saves continuously (collaborative CRDT; no save button). The tab title
   and header update to the typed title.

The a11y snapshot exposes the entire body as the contenteditable's `value` and as paragraph
nodes — use the snapshot itself to verify content. For formatting checks, run
`evaluate_script` over `[contenteditable] strong` etc.

Body placeholder advertises: `/` for block commands, `@` to reference files, `;` for snippets.
Markdown auto-format works while typing (`#` heading, `[]` checklist, `>` quote).

## AI edit

1. Click `Edit with AI` (button directly under the editor body).
2. A focused prompt box appears (placeholder `Describe the edit…`). Type the instruction,
   press Enter (or click `Send`).
3. While running, the button row shows an author chip (e.g. `Wolf (AI)`) and a `Stop` button
   (a11y text `Stop AI edit`). Edits stream directly into the document — there is no
   accept/reject step.
4. Completion signal: the `Stop` button disappears. Poll for that with `evaluate_script`;
   do not rely on `wait_for` text.

## Comments (Discussion)

Below the editor, expand `Discussion`. Its `Leave a comment...` composer supports
`Attach files`, formatting, mentions, and `Send comment` (Enter also submits).
Attachment-only comments are allowed after uploads finish. Confirm completion by
the new message appearing above the composer; a failed send retains the draft.
Live updates preserve unsent replies and edits while updating the surrounding thread.

Select text and choose the comment action to create an anchored discussion. Existing
highlights locate threads by their stable mark IDs. Replies, attachments, reactions,
and editing use the same message controls as channels. On phones, the active Markdown
thread opens in a drawer with a pinned reply composer.

`Resolve` / `Reopen` changes the discussion state. Deleting the root message leaves a
tombstone and retains its replies. `Delete discussion` explicitly removes the whole
thread and requests confirmation. `Copy link` targets the specific comment. Previously
copied numeric links still resolve under current document permissions.

PDFs expose a `Comments` section in the side panel as well as anchored margin threads.
Deleting a comment placeable removes its discussion; deleting a discussion attached
to a regular highlight leaves the independent highlight in place.

### Agents and channel context

The comment composer supports the same agent mentions as channels. `@Macro` answers
in the discussion; available `@macro-new`, `@coder`, `@cursor`, and owned/team agents
open a linked session. Follow-up mentions in that thread can continue the session.
The session's conversation drawer opens the document discussion and receives live
replies, edits, and reactions while the source document is closed. Closing the drawer
keeps any open document view subscribed. Access follows the
current document permissions, so revoking a collaborator prevents further prompts
and inherited session access.

For isolated drawer checks, `/app/component/linked-conversation` accepts a parent
type (`Document` or `Channel`), parent ID, and root message ID. Click `Load conversation`
then `Open in drawer`. `Show inline preview` adds a second subscription owner, so you
can verify that closing either view preserves updates in the other.

Enable `Include channel mentions` to add accessible channel threads that reference
the document. Each has a `From …` link to its source. Replying there sends to that
channel; resolving/deleting whole document discussions is unavailable on these
source threads. Their reply composer supports channel `@here`; document discussions
do not offer group mentions. The bottom composer still creates a document discussion. The option
starts off and never grants access to a private channel.

## Side panel

Right side of a doc (toggle with `Hide/Show Side Panel`):

- `Actions` → `Ask Macro` (opens a doc-scoped AI chat, see ai-chat.md).
- `Details` → Owner, Created, Last updated.
- `Tags` → `Add tags` (dialog). `Properties` → `Add property`.
- Collapsed sections: `Stats`, `History` (version time-travel), `Activity`.
- Header: `Share`, `Copy Share Link`, overflow menu — use `Share` to inspect or change the
  doc's visibility/permissions.

## Known failure: "expected instance of LoroDoc"

Opening any doc can crash with a full-screen dialog `expected instance of LoroDoc` (console:
`[observability] expected instance of LoroDoc`). Seen after the Vite dev server reconnects
(HMR leaves two copies of the loro wasm module alive). `Try Again` and a normal reload do NOT
fix it; a **hard reload ignoring cache** (`navigate_page` with `ignoreCache: true`) does.
