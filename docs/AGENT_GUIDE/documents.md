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

On touch devices, the text-selection menu (Copy, Cut, Comment, Share, and other
available actions) appears above the floating header, comment input, and bottom
dock. It stays anchored to the selection while the document scrolls.

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

The `@` menu includes `Recent agent sessions` after Channels and before
Companies. Search by session or persona name within the 500 most recently
updated accessible sessions. Menu rows show the
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
the preview open, the compact header shows a tinted icon, title, and author/time
byline. Click the title to open the document; the Reference actions ellipsis menu contains copy
link, split, embed/collapse, AI, and delete actions when applicable. The preview
stays open while this menu is active, and moving over other reference chips must
not open their previews. Click outside or press Escape to dismiss the menu;
other references can then be hovered again. Images use an inset frame and task chips
appear below the header. Long titles wrap in place without a full-name tooltip.

With `ENABLE_GRAPHQL_SOUP` enabled, the popup reuses the reference's live `ItemPreviews`
batch, including task properties and viewer permission, without another fetch.
Explicit refreshes may revalidate that batch, but requests must settle while the
pointer stays over the same reference; cache updates must not cause a continuous
fetch cascade.

## Embedded document cards

Document cards use a compact icon/title row and an actions menu. Full previews
sit inside an inset surface; the author's display name and update time appear
under the title as a byline. The plain 1rem icon sits in a column to the left
of the title, aligned with its first line. Wrapped title lines, the byline,
and task chips share the title's left edge. Full previews use the card's full
content width with equal left and right insets. Title and byline share a text
stack with a consistent 4px gap and 20px title leading, including when the title wraps.
Titles and bylines use text-sm, differentiated by semibold and regular weight;
smaller details use text-xs.
Item.Icon provides the plain first-line-aligned icon slot. The small ellipsis button
sits at the top right. Full embeds have a 320px minimum
card height and a smaller rounded inset frame.
The document-preview overlay uses the same plain icon, title/byline stack,
small actions button, and task status control; image previews keep equal side insets.
Metadata-only references omit the preview. Tasks replace the type icon with an
icon-only status control; click it to change status when you have edit access.
Priority and assignee chips remain below, without a duplicate status chip.
Status and detail slots share one TaskPropertiesPreviewProvider per card:
GraphQL preview data is reused, and REST fallback property/access queries are
owned once, not separately by each slot. Non-task cards do not load task properties.
Use the title to open the referenced document and the
actions menu to copy its link, convert it to an inline mention, or delete the card.
Title navigation preserves the reference's block parameters, including message,
thread, annotation, and document locations.
Click the card frame to select its editor node; controls and embedded content
handle their own clicks. Full embeds remain vertically resizable and scroll
inside the inset preview. When verifying, check a canvas embed, a metadata-only
reference, and an editable task, including resize, menu actions, and keyboard
access to the title and property controls.

## AI edit

1. Click `Edit with AI` (button directly under the editor body).
2. A focused prompt box appears (placeholder `Describe the edit…`). Type the instruction,
   press Enter (or click `Send`).
3. While running, the button row shows an author chip (e.g. `Wolf (AI)`) and a `Stop` button
   (a11y text `Stop AI edit`). Edits stream directly into the document — there is no
   accept/reject step. The editor can insert the same `@` mention chips a person can:
   dates/times, people, documents, channels, agent sessions (including the expanded
   Magic Chip card), and the other chip types.
4. Completion signal: the `Stop` button disappears. Poll for that with `evaluate_script`;
   do not rely on `wait_for` text.

## Comments (Discussion)

Below the editor: `Discussion` section with a `Leave a comment...` contenteditable.
Desktop uses the same compact 15px composer as channels and AI chat, with an
an `Attach images` paperclip that opens the image picker directly. Shift+Enter
expands the editor above the controls. Touch keeps separate `Attach images` and
`Format` buttons. `Send comment` is disabled until text exists. Click the
composer, `type_text`, then click `Send comment` (Enter also submits). The comment renders
above the composer with author + timestamp. `@`-mentions in comments notify the mentioned
user. On mobile, the new-comment composer is docked above the navigation bar,
replacing Ask AI and New when commenting is available in documents and tasks.
When the comment composer is unavailable, the default Ask AI row appears instead.
Tap `Leave a comment...`
to expand the channel-style input; use Send comment to submit (Enter inserts a
newline on mobile). Submitting clears and unfocuses the mobile input, returning
it to its compact state and dismissing the keyboard. The compact input's plus
opens the native photo library in the iOS app, with a file-picker fallback when
unavailable; browsers use the file picker. Cancelling adds no images.
While the main document editor is focused with the virtual keyboard
open, the floating comment input is hidden; dismissing the keyboard or leaving
the document editor restores it with any unsent draft intact. Comments remain in the
Discussion section, and collapsing that section does not hide the docked composer.
On touch devices, the Discussion section is hidden until it contains a comment;
the floating **Leave a comment...** input remains available. If the discussion
becomes empty again, the section disappears. Desktop keeps the empty section
and inline input.

Comments anchored to selected text open in a floating margin card on desktop and
a `Comments` drawer on touch devices. Hovering a desktop card reveals its actions
without changing the card size or header text wrapping. New comments, replies,
and edits use plain inputs on the card or drawer's background. The pinned reply
keeps at least 16px of
bottom clearance above the drawer's curve, including while the keyboard is open,
and accounts for the home-indicator safe area when the keyboard is closed.

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
  doc's visibility/permissions. Documents and AI chats also have a `Team access` dropdown
  (None / View / Comment / Edit) for sharing directly with the owner's team. That is
  independent of the team-scoped link control.

## Known failure: "expected instance of LoroDoc"

Opening any doc can crash with a full-screen dialog `expected instance of LoroDoc` (console:
`[observability] expected instance of LoroDoc`). Seen after the Vite dev server reconnects
(HMR leaves two copies of the loro wasm module alive). `Try Again` and a normal reload do NOT
fix it; a **hard reload ignoring cache** (`navigate_page` with `ignoreCache: true`) does.
