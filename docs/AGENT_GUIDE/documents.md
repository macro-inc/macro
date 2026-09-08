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

## Sharing indicators and link access

Open `Share` to inspect recipients and link settings (on mobile, use the `People`
and `Link` tabs). The Share button tooltip and link-settings badge summarize known
access paths:

- `Public`: anyone with the link can access the item. The tooltip also notes any
  explicit team or people/channel sharing.
- `Team`: explicit team sharing, team-link access, or both. Read the tooltip to
  distinguish “Shared directly with the owner's team” from access “with the link”.
  Explicit team sharing still shows `Team` when link sharing is `None`.
- `Shared`: known people/channel grants with no public link or known team access.
- `Link off`: link sharing is off, not a claim that the item is private or “Just me”.
  An explicit team level of NULL (or a missing field in an older response) does not
  rule out inherited access, historical team grants, or other access paths. The
  recipient list is not a complete effective-access audit.

The existing `None` / `Public` / `Team` selector controls **link access only**;
its access-level picker applies to that link. Selecting `None` clears the link
scope and link level, not explicit team sharing. Success says “Disabled link
sharing for this document” and explains that other access is unchanged. Teammates
with explicit or inherited grants retain access.

There is no explicit-team sharing control or team-level picker in this dialog.
Removing explicit team sharing is a separate owner-authorized API operation:
set `sharePermission.teamShareAccessLevel` to `null`. Omitting that field preserves
it. Even clearing it does not prove that other access paths are absent.

## Known failure: "expected instance of LoroDoc"

Opening any doc can crash with a full-screen dialog `expected instance of LoroDoc` (console:
`[observability] expected instance of LoroDoc`). Seen after the Vite dev server reconnects
(HMR leaves two copies of the loro wasm module alive). `Try Again` and a normal reload do NOT
fix it; a **hard reload ignoring cache** (`navigate_page` with `ignoreCache: true`) does.
