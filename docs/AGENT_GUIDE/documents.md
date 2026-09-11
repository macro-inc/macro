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

`Ctrl+F` / `Cmd+F` opens the in-document find bar. Matches include paragraph
text and inline mention chips (tasks, docs, channels, skills, …) by the title
shown on the chip.

On a touch device, swipe a list item right to indent one level (Apple Notes
style) or left to outdent. Nested children move with the parent. The first
item can indent too, even in a single-item list. Vertical scrolling and taps
are unchanged.
Items stay still during the swipe and change indentation only when a
successful swipe is released; short or blocked swipes leave them in place.
Swiping requires permission to edit the document; comment-only access does
not allow indentation changes. Losing edit permission during a swipe cancels it.
To verify nesting, give a list item a child and grandchild, then swipe the
parent right and left: all three should shift one level together, preserving
their relative depths and order.

## Reference hover previews

The `@` menu includes `Recent agent sessions`, searched by session or persona name
within the 500 most recently updated accessible sessions. Menu rows show the
session title followed by a muted persona name, including `@Cursor` and
`@macro(new)` for built-in personas. Names from the session API take precedence;
older responses use the shared built-in name resolver or cached custom bots.
Selecting one inserts an
inline reference showing the shared agent icon and an underlined session title.
Chips omit persona avatars and status. Click it (or select the node and press
Enter) to open `/app/agent/<id>`.
It references an existing session; it does not invoke the persona, attach its
transcript to AI context, or grant access. Private/deleted sessions show an
unavailable label. Mounted references refresh every 30 seconds while the tab is
active to update titles and check access.

Hover a document reference chip to open its preview without navigating. With
`ENABLE_GRAPHQL_SOUP` enabled, the popup reuses the reference's live `ItemPreviews`
batch, including task properties and viewer permission, without another fetch.
Explicit refreshes may revalidate that batch, but requests must settle while the
pointer stays over the same reference; cache updates must not cause a continuous
fetch cascade.

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
- `Activity` lists the same glyph-rail lines as `/app/component/activity` (plain glyphs on a
  thin connector, one line each with long names truncated, compact `17h` / `8d` / `1mo`
  times; consecutive edits fold into one `made 3 edits` line). Past four entries it shows the
  three newest, a `View all activities` toggle row (dotted connector, caret glyph), and the
  oldest fetched entry (usually `created this`) pinned last; the toggle flips to `Show less`
  once expanded.
- Header: `Share`, `Copy Share Link`, overflow menu — use `Share` to inspect or change the
  doc's visibility/permissions.

## Known failure: "expected instance of LoroDoc"

Opening any doc can crash with a full-screen dialog `expected instance of LoroDoc` (console:
`[observability] expected instance of LoroDoc`). Seen after the Vite dev server reconnects
(HMR leaves two copies of the loro wasm module alive). `Try Again` and a normal reload do NOT
fix it; a **hard reload ignoring cache** (`navigate_page` with `ignoreCache: true`) does.
