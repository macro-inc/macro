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

Below the editor: `Discussion` section with a `Leave a comment...` contenteditable, buttons
`Attach images`, `Format`, and `Send comment` (disabled until text exists). Click the
composer, `type_text`, then click `Send comment` (Enter also submits). The comment renders
above the composer with author + timestamp. `@`-mentions in comments notify the mentioned
user.

## Side panel

Right side of a doc (toggle with `Hide/Show Side Panel`):

- `Actions` → `Ask Macro` (opens a doc-scoped AI chat, see ai-chat.md).
- `Details` → Owner, Created, Last updated.
- `Tags` → `Add tags` (dialog). `Properties` → `Add property`.
- Collapsed sections: `Stats`, `History` (version time-travel), `Activity`.
- Header: `Share`, `Copy Share Link`, overflow menu — use `Share` to inspect or change the
  doc's visibility/permissions.

## Share dialog

`Share` (header, or the top-bar `Share` button) opens the share dialog, which is the same for
documents, chats, and folders:

- **People with access** lists the owner, then a team row (labelled with the team's name, or
  `Team`, with the subtitle `Everyone on the team`) when the owner is on a team, then one row
  per channel the item is shared in. Each non-owner row has an access-level menu (`View`,
  `Comment`, `Edit`, `Remove Access`).
- The team row is the explicit team share: pick a level to share the item with everyone on
  the owner's team at that level (it then appears in teammates' feeds), or `Remove Access` to
  stop. Only the item's owner can change it; for everyone else the row shows the current level
  as plain text, and it is hidden when there is no team share and the viewer is not the owner
  on a team. Sharing a folder with the team also shares its contents.
- **Link sharing** (`None` / `Public` / `Team` segmented control + level) is separate: a
  `Team` link only grants access to teammates who open the link and does not add the item to
  their feeds.

## Known failure: "expected instance of LoroDoc"

Opening any doc can crash with a full-screen dialog `expected instance of LoroDoc` (console:
`[observability] expected instance of LoroDoc`). Seen after the Vite dev server reconnects
(HMR leaves two copies of the loro wasm module alive). `Try Again` and a normal reload do NOT
fix it; a **hard reload ignoring cache** (`navigate_page` with `ignoreCache: true`) does.
