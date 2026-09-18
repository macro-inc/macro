# Documents

## Spreadsheets

Spreadsheets are an internal pilot controlled by the `enable-spreadsheets` PostHog
flag in every environment. Team targeting is configured in PostHog; ordinary
document permissions continue to control access to each workbook.

Choose **Create → Spreadsheet**, or **New → Spreadsheet** in Files or a folder.
Native workbooks open at `/app/spreadsheet/<uuid>` and use the normal document
title bar with **Ask Macro** and **Share** at the top right. The **File actions**
ellipsis beside the title uses the same menu as documents, including rename,
favorite, move, copy, and permission-appropriate file actions. Native spreadsheets
use a green grid icon in file lists and search. The grid fills
the panel beneath the formatting and formula bars. They have the `.spreadsheet` file type; uploading an
Excel or CSV file in Files or a channel opens a read-only spreadsheet preview, including existing `/app/unknown/<uuid>` links and CSV code routes. Review **Import notes**, then choose **Edit in Macro** to create a collaborative native copy. The original file and its link remain intact. Conversion waits for a durable save before opening the copy; a failed save can be retried without creating another copy. The normal document download action retrieves the original; the spreadsheet footer exports the imported representation.

You can also open a native spreadsheet and use the bottom-right **Import and export → Import…** menu to import its sheets.

Select a cell to inspect its address and input in the formula bar. Double-click
a cell, start typing, or use the formula bar to edit its value. Formulas begin
with `=` and may refer to cells or ranges, for example `=SUM(B2:B5)`. Check both
the rendered result and formula bar: a formula's displayed result differs from
its stored input. Paste a rectangular selection copied from another spreadsheet
to populate multiple cells. The toolbar offers number formatting, bold, undo,
and redo; sharing uses the same document permissions as other Macro files.

On a phone, tap once to select and tap the same cell again promptly to edit.
Swiping the grid scrolls without extending selection. Drag **Move selection start**
or **Move selection end** to select a range. The formula bar exposes **Apply edit**
and **Cancel edit** while editing, so a software keyboard is sufficient. Swipe the
formatting ribbon horizontally to reach more controls. On narrow screens, **Add rows**
is in the active sheet's actions menu; **Import and export** stays at the bottom right.

Both editors offer formula autocomplete. Type `=` or a function prefix such as
`=SU`, use Up/Down to choose a suggestion, and Tab or Enter to insert it. Clicking
a suggestion also keeps focus in the editor. The popup shows a description,
signature, and example; after `(` it highlights the current argument, including
inside nested formulas. Escape dismisses help first, then cancels editing on a
second press. Suggestions do not appear inside quoted text or in view-only mode.

While editing a formula, click a cell or drag across cells to insert a reference
at the caret (for example, type `=SUM(`, then drag B4 through B7). The draft updates
to `=SUM(B4:B7` without committing or moving the active cell. A dashed outline shows
the referenced range. Release, type `)`, and press Enter to calculate. This works
in both the cell editor and formula bar, including reverse drags, replacement of
an existing reference, and subsequent arguments after a comma or operator. To reference another sheet,
click its tab while the formula is awaiting a reference, then click or drag the
source cells. The draft stays in the formula bar; Enter commits it to the original
sheet and cell. Names with spaces are quoted automatically. Escape cancels and
returns to the original sheet.
On touch screens, tap a cell while editing a formula, then drag **Move reference
start** or **Move reference end** to extend its reference. Tapping a suggestion or
adjusting a reference should keep the input focused and the software keyboard open.

Drag across cells, Shift-click, or use Shift + arrow keys to select a range.
Drag across row/column headers or Shift-click a second header to select multiple
whole rows/columns. Arrow keys then move from the selection's active cell. The
focused grid owns typing and navigation; app navigation shortcuts do not run while
it has focus.
The active cell keeps a complete border while editing; a range has a shaded
fill and an outer border. Verify selection in both drag directions and after
scrolling, including near the last row and column.
Only nearby rows are mounted. Use **Go to cell** or keyboard navigation to reach
off-screen cells; verify the target is visible below the sticky column header.

Copy within Macro and paste elsewhere to translate relative references: copying
`=B4-C4` down becomes `=B5-C5`, while `$B$4` stays fixed. Drag the small handle
at the selection's bottom-right corner to fill down/up or right/left. Select a
range and use **Format and data → Fill down / Fill right** or **Cmd/Ctrl+D** /
**Cmd/Ctrl+R**. Drag fill continues arithmetic number sequences and daily,
weekly, monthly, or quarterly date sequences (including month ends). Text and
irregular patterns repeat; relative formula references translate. Keyboard/menu
Fill down/right explicitly copies the starting row/column. Plain-text paste from
other apps keeps formulas as supplied.

Drag a column header's right boundary or row header's bottom boundary to resize;
double-click the boundary to auto-fit. Row separators support Up/Down arrows and
Enter to restore automatic height. Explicit row heights take precedence over wrap.
At 100% zoom, default columns are 100 pixels wide and rows are 21 pixels high;
larger text and wrapping expand the row. Saved custom column widths take precedence.
The resize separator also supports Left/Right arrows and Enter for auto-fit.
Use **Add rows** in the footer to append 100 rows (up to 1,000 total). Resizing
and row additions save collaboratively and can be undone.

The document title and Share button sit above a compact formatting ribbon:
undo/redo, paste, zoom and view options, currency/percent/decimals/number format,
font and size, text styles, text/fill color, borders, alignment, wrapping,
functions, format/data actions, and find. Icon controls expose accessible button
names and tooltips. **Paste special** offers **Paste** and **Paste values only**.
Select a range first; formatting applies to all selected cells. Toggling bold,
italic, underline, or strikethrough on a mixed selection first enables it for the
entire selection. Whole-column formatting preserves the viewport. In a cell that
is already percentage-formatted, typing `5` means `5%`; formulas and AI/API numeric
values still use fractional values (`0.05` for 5%). Font sizes are
points. Wrapped rows grow automatically up to 160 pixels at 100% zoom. Check
selection and formula-reference outlines after changing wrapping, font size, or zoom.
Excel black text and borders on unfilled cells follow the app's foreground color
so imported sheets remain readable in dark mode. Explicit text/fill color pairs
remain unchanged; theme changes never alter saved or exported workbook colors.

**View options** directly toggles gridlines, the formula bar, and formula display;
these settings and zoom are local to the editor. **Go to cell** accepts ranges such
as `A3:E7`.
Escape from the address or font-size field returns keyboard navigation to the grid.
**Functions** starts an editable formula: for a selected range it proposes
the result in the empty cell below; for one cell it opens `=FUNCTION(` for reference
picking. An occupied result cell is never overwritten.

The **Find and replace** ribbon button (Cmd/Ctrl+F in the grid) supports
case-sensitive and whole-cell matching. Find next selects each result. Formula results can be searched
but replacements preserve the formulas unless **Search within formulas** is checked.
**Format and data** sorts the selected rectangle by its active column, keeping each
row's values, styles, and relative formulas together, or trims whitespace in text
cells. The same menu offers fill down/right, clear formatting, and clear values.
Select data without its header when sorting. A concurrent edit cancels a pending
sort; references elsewhere in the sheet are not rewritten to follow sorted rows.

The footer's bottom-right **Import and export → Import…** accepts `.csv` and `.xlsx`.
Right-click a row number or column letter for Macro's contextual menu: clipboard actions,
clear, hide/unhide, resize and fit-to-data; columns also offer whole-sheet sorting.
The menu keeps an existing whole-row/column selection when opened within it.
Insert/delete shifts references and named ranges in local workbooks only; these
commands are disabled on shared workbooks (including offline sessions) until
collaborative rows and columns have stable identities. Adding blank rows at the
bottom remains available. Hidden cells are skipped by keyboard navigation.

Cells support Macro mentions without Markdown formatting. Type `@` in a cell or
the formula bar to search people, documents, channels and email, then choose an
item with the pointer or keyboard. Pasting a Macro app link renders a document
pill, preserving navigation parameters. Formulas still use the formula editor;
`@` inside a formula or email address does not start mention search. Other Markdown
is literal text. Mentions remain attached through copy/fill, undo and collaboration;
Excel/CSV export uses their display text. Plain URLs and email addresses are clickable;
web links use the same hover preview as channel messages. Click the surrounding cell
or use the formula bar to edit link text. AI `set_cells` accepts Macro URLs or the
same `<m-user-mention>` / `<m-document-mention>` encoding as docs. Formula references
to mention cells use literal labels, never execute a label as a formula.

CSV imports a file up to 1 MB into the selection, adding rows if needed within the
1,000 × 26 limit. Existing cells in that rectangle
are replaced, with undo available. Excel imports accept up to 5 MB, 10 sheets, and
1,000 rows × 26 columns per sheet. An import preview lists each sheet and warns about
unsupported content (for example charts, validation rules, and rich text). Choose
**Insert new sheets** to keep existing work, or **Replace workbook** to replace it
in one undoable operation. Names must be unique when inserting sheets. Canceling
leaves the workbook untouched; a replacement is blocked if the workbook changed
while the preview was open. Legacy `.xls`, macros, and encrypted files are rejected.

**Import and export → Download as Excel (.xlsx)** exports every sheet with formulas,
current formula result caches, precise numeric values, custom Excel number formats, fonts, borders, and column widths. Named ranges and named constants are retained; unsupported named expressions show explicit calculation errors. Imported merged ranges, hidden sheets/rows/columns, row heights, filters, and frozen panes are retained for export. Macro hides imported rows and columns, shows hidden sheets and individual cells of merged ranges; editing a covered merged cell omits that merge during export with a warning so the edit is preserved. Complex Excel features such as pivots, structured table formulas, charts, conditional formatting, validation, and rich text are not fully supported; review import notes before conversion.
CSV imports preserve long identifiers and leading zeros as text and never execute formula-like strings.
**Download as CSV** in the same menu exports only the active sheet's current
calculated values. Clipboard menu actions use the browser clipboard; if access is
unavailable, use Cmd/Ctrl+V or Cmd/Ctrl+Shift+V in the grid.

Use **+** in the footer to add a sheet, select its tab to switch, and open the
adjacent sheet menu to rename, duplicate, or delete. Double-click a tab to rename it,
or right-click any tab for its Rename, Duplicate, and Delete actions. Sheet operations can be undone;
the last sheet cannot be deleted. Each sheet remembers its selection. Tab navigation
supports Left/Right and Home/End; a view-only user can switch tabs and copy cells.
Adding or duplicating a sheet focuses its grid so typing immediately edits the new sheet.
Formulas can refer across sheets, such as `=Sheet1!B9` or `='Launch budget'!B9`.
Rename and delete are currently blocked when live formulas directly reference that
sheet, to avoid breaking those references; `INDIRECT` text cannot be checked this way.
The 10-sheet limit applies to local additions/imports; concurrent offline additions
can merge above it without hiding another user's work.

Ribbon dropdowns, the import/export menu, and sheet actions use the shared Macro
menu styling. Verify keyboard navigation, checkbox toggles, Escape, and restoring
editor focus after menu actions or Escape and after Find/rename dialogs close.
Clicking outside a ribbon menu onto the address or formula input should keep
focus in that input. In narrow windows, sheet
tabs should scroll while **Add rows** and the compact **Import and export** button
remain visible. Imported-file warnings and dialogs should remain accessible in
short or narrow windows.

Calculation runs in a worker. If it times out, source editing and undo remain
available; simplify the formula or undo and use **Retry**. Check that a pending
calculation does not freeze selection, and that export waits for current results.
Appearance-only changes such as strikethrough do not recalculate. During value or
formula changes, the last calculated results stay visible until the next results
arrive. The footer shows **Calculating…** only for work taking longer than 250 ms;
quick edits should neither flash raw formulas nor shift the footer.

Edits save through the collaborative document connection. Verify collaboration
with the same document open for two users: edit different cells, then the same
cell, and confirm both views converge. Also edit A1 on different sheets and confirm
they remain independent. Remote selections have a tinted range outline, an active-cell border, and a name label in the same collaborator color. The footer repeats their names/colors. Idle connected selections stay visible; disconnected peers expire. Cursors should only appear for peers on the active sheet;
switching a local tab must not move another user's tab. Switching back should
immediately restore the remembered cursor for collaborators, without another cell click. A remote sheet deletion
must cancel any draft on that sheet instead of committing it into the fallback sheet. Undo should reverse only the local
user's edit. Close and immediately reopen after editing (including while offline)
to check local recovery; reload to check server persistence. Viewers must be able to select and
copy cells without editing them.
If another user subsequently changes the same cell property or layout value,
undo/redo keeps that newer work and reports a conflict without consuming the
history step. Structural history also refuses to remove a sheet name still used
by a surviving direct formula reference.

For local UI verification without creating hosted documents, development builds
provide `/app/component/spreadsheet-demo`. It runs the real spreadsheet UI with
local collaboration state. Clicking **Share** saves its current cells, formulas,
formatting, all sheets, column widths, and added rows as a native document, then opens the
normal sharing dialog. It waits for the save acknowledgement before leaving the
sample; a failed save keeps the sheet editable and supports retry. Native creation,
sharing, and network persistence require the spreadsheet-enabled document and sync
services.

Phone verification should cover portrait and landscape, native grid/ribbon swipes,
range handles, formula suggestions, sheet rename, view-only controls, and the
software keyboard. The isolated browser fixture has separate Android Chrome and
iPhone WebKit projects. Chromium uses trusted touch drags; WebKit uses native taps
and mouse-pointer handle drags. A reduced test viewport only checks layout; verify
actual keyboard resizing and iOS gesture behavior in the simulator or on a device.

Right-click a cell for the Macro cell menu: Cut, Copy, Paste, Paste values only,
Clear values, Clear formatting, Fill down/right, and Comment on saved workbooks.
Right-click inside a selected range to act on that range; outside it targets the
clicked cell. **Shift + F10** or the keyboard context-menu key opens the same menu
for the selection; Escape returns focus to the grid. Fill requires a multi-cell
range along that direction. Commenters can copy and comment without editing cells.
Right-click inside the cell text editor retains the native text-editing menu.

Opening a saved spreadsheet from Files/Drive (including a favorite) keeps the
Drive navigation sidebar in place. Collapse it with the sidebar control; the
spreadsheet header then shows the navigation toggle to reopen it. Opening a
spreadsheet does not change the saved sidebar preference. The header keeps the
Files location breadcrumbs before the sheet title; click a location breadcrumb
to return to that file listing.

## Spreadsheet comments

On a saved spreadsheet, select a cell or range and choose **Comment** in the
formatting ribbon (or **⌘/Ctrl + Alt + M**) to compose beside the cell. A comment
captures the sheet ID and selected range; later selection changes do not move
the draft's attachment. The top-right triangle marks the first cell of a
commented range. Hover any cell in that range to read its threads; choose
**Reply** in the card to respond without opening the sidebar. Clicking the
triangle also opens the card on touch devices. Interacting with a card keeps it
open until dismissed so a reply is not lost when moving the pointer.

**Comments** in the document header opens all workbook threads. Range labels
navigate to the corresponding sheet and cells; deleted-sheet threads remain
readable. These are the same document annotation comments used by docs/tasks:
mentions and replies use the existing inbox notifications and comment links.
Opening an inbox notification opens the sidebar and targets its comment/range.
Comment-only access can post/reply; view-only access can read. Edit/delete applies
to the author's own comments, and failures retain the input draft. Draft demos
must be saved before persistent comments are available.

## Ask Macro about a spreadsheet

**Ask Macro** sits immediately left of **Share**. Select the relevant cells, then
click it to open a new chat in a split beside the workbook. The composer starts
with the workbook mention followed by one space; nothing sends automatically.
The mention captures the active sheet ID/name and normalized selected range at
click time. Changing the selection later does not change that draft attachment.
A viewer can ask questions; editing still requires edit permission.

In the local spreadsheet demo, Ask Macro first saves the entire workbook and
waits for acknowledgement. A failed save leaves the draft editable and supports
retry, without opening an empty chat. This path needs the updated native-document
backend, just like Share.

The AI can use **ReadSpreadsheet** to inspect sheet names, used ranges, raw inputs,
formulas, typed results, errors, and formatting. **CalculateSpreadsheet** evaluates
scratch formulas and what-if inputs without changing the workbook.
**EditSpreadsheet** applies a validated batch of cell/formula/format edits, fill,
row additions, column resizing, and sheet creation/rename/duplication/deletion.
Edits require a revision from a fresh read; a concurrent change rejects the entire
batch so the AI can reread. Tool rows expand to show the actual results and warnings.

Verify with a saved workbook: select B4:E9, click Ask Macro, check the adjacent
chat's mention and trailing space, and ask for a total or a what-if calculation.
The workbook should stay unchanged for scratch calculations. Ask for an edit and
check both source/formula and displayed result in the sheet and another connected
client. A viewer's edit must fail; a concurrent manual edit must force a fresh
read. These tool calls require the updated AI backend, AI editing worker, and sync
service; the frontend alone cannot test their hosted path.

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
`Attach images` paperclip that opens the image picker directly. Wrapping text or
Shift+Enter expands the editor above the controls. Lists, blockquotes, and other
non-paragraph blocks always expand while editing. A single paragraph returns to
the compact layout once it fits on one line.
Touch keeps separate `Attach images` and
`Format` buttons. `Send comment` is disabled until text exists. Click the
composer, `type_text`, then click `Send comment` (Enter also submits). The comment renders
above the composer with author + timestamp. `@`-mentions in comments notify the mentioned
user. Editing a discussion comment keeps the attachment and send controls, with no
trash button. On mobile, the new-comment composer is docked above the navigation bar,
replacing Ask AI and New when commenting is available in documents and tasks.
When the comment composer is unavailable, the default Ask AI row appears instead.
Tap `Leave a comment...`
to expand the channel-style input; use Send comment to submit (Enter inserts a
newline on mobile). Submitting clears and unfocuses the mobile input, returning
it to its compact state and dismissing the keyboard. The compact input's paperclip
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

### Unified document discussions (`enable-unified-document-discussions`)

With the PostHog flag `enable-unified-document-discussions` on (locally
`VITE_ENABLE_UNIFIED_DOCUMENT_DISCUSSIONS=true`), document comments are messages
read and written through `/dss/messages/document/<id>`, and both comment
surfaces reuse the channel message components. The legacy annotation comment
endpoints are not called for that document. Channels are not gated and always
use the message API.

Below the editor, expand `Discussion` to see comments without a text anchor.
Its `Leave a comment...` composer is the channel composer: `Attach files`,
formatting, mentions, and `Send message` (Enter also submits). Confirm
completion by the new message appearing above the composer; a failed send
retains the draft. The timeline initially loads a bounded page with up to three
preview replies per thread. Expand a thread to load its replies;
`Load earlier comments` pages backward. Live updates preserve unsent replies
and edits while updating the surrounding thread.

The `Include channel mentions` checkbox under the `Discussion` header is off by
default. Checking it adds channel threads whose messages mention this document,
each under a `From <channel name>` link to the source channel, after the
document's own comments. These threads stay channel-owned: replies, edits, and
reactions post to the channel, `Copy link` yields the channel link, and
`Resolve` / `Delete discussion` do not appear on them. Only channels the viewer
can read are listed, and a thread from a channel the viewer cannot post in has
no reply, edit, or delete controls. The list refreshes on live channel message
changes, on reconnect, and every 30 seconds while the checkbox is on, so a new
mention in another channel or a lost channel membership shows up or disappears
within that interval. A reply draft in a listed thread survives those
refreshes. Unchecking hides the channel threads again without touching the
document's comments.

Select text and choose the comment action to create an anchored comment. These
threads appear beside their text in the margin (or in the active thread drawer
on phones) and never in the bottom Discussion, including after live updates or
reloads. Existing highlights locate threads by their stable mark IDs. Replies,
attachments, reactions, and editing use the same message controls as channels.
Removing the last marked text moves its retained conversation to Discussion,
where it remains after reload. Removing only part of a marked range keeps the
conversation anchored to the remaining text. On phones, the active Markdown
thread opens in a drawer with a pinned reply composer; long-press any message
for edit, delete, copy-link, and reaction actions.

`Resolve` / `Reopen` changes the discussion state. Deleting the root message
leaves a tombstone and retains its replies. `Delete discussion` explicitly
removes the whole thread and requests confirmation. `Copy link` targets the
specific comment with `comment_id=<message id>`. Previously copied numeric links
still resolve under current document permissions. Deleting an anchored Markdown
discussion removes its mark while preserving the document text and any
overlapping comments. If deletion happens while the document is closed, its next
editable view removes the retained mark when the document loads. Read-only
viewers see plain text without a dead comment highlight; the stored document
and overlapping live comments stay intact.

Unified PDF discussions are deferred: PDFs keep the legacy comment subsystem
regardless of the flag, so PDF comments (the side-panel `Comments` section,
anchored margin threads, highlight comments, and placeable comments) behave as
they do with the flag off. The message-backed PDF path is a follow-up.

With the flag off, documents behave exactly as described above this section.

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
  doc's visibility/permissions. Documents, AI chats, and folders have a `Team access`
  control (None / View / Comment / Edit) for sharing directly with the owner's team.
  That is independent of the team-scoped link control. Folders hide link sharing, so
  Team access is its own card on desktop and a Team tab on mobile, not nested in the
  Link card.

## Known failure: "expected instance of LoroDoc"

Opening any doc can crash with a full-screen dialog `expected instance of LoroDoc` (console:
`[observability] expected instance of LoroDoc`). Seen after the Vite dev server reconnects
(HMR leaves two copies of the loro wasm module alive). `Try Again` and a normal reload do NOT
fix it; a **hard reload ignoring cache** (`navigate_page` with `ignoreCache: true`) does.

AI can create a native workbook without an open editor using `CreateDocument`
with `fileExtension: "spreadsheet"`, empty `fileContent`, and `isTask: false`.
Read the returned document with `ReadSpreadsheet`, then populate it with
`EditSpreadsheet`; do not create a CSV as a substitute for a native workbook.
Spreadsheet reads and edits run against server state even when no tab is open.
An edit uses the revision from a fresh read and atomically applies a CRDT delta
that is broadcast to connected collaborators. A stale revision is rejected:
reread and reconsider the change instead of blindly retrying. Unsynced edits
still follow normal CRDT collaboration semantics when they reconnect.
