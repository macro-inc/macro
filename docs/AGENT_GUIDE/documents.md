# Documents

The document header has separate Share, Copy Share Link, and Side Panel buttons.
They are borderless with a soft rounded background on hover. Share opens the
sharing dialog; copying a link is a separate action.

Snippet owners manage team sharing under **Share → Team access**. The details
panel has no separate Sharing section. Choose **Edit** to grant the access the
old snippet toggle provided, or **None** to remove team access.

Hover or focus a document title in the header to see its owner, created time,
and last-updated time. This details card is shared
by documents, tasks, snippets, canvas, and file blocks; unavailable metadata is
labeled rather than inferred.

Editable documents show matching **Add tags** and **Add property** pills below
the title. Once tags are applied, **Add tags** becomes the existing tag name or
count pill; clicking it reopens the picker. **Add property** opens the shared
property selector for that document.
Adding or reselecting a property from the title row pins it there. Adding from
the side panel leaves it unpinned. The side panel shows all assigned properties,
including unpinned ones.
Hover or focus an inline property pill to find **Unpin** (keeps its saved
value) and **Delete from item** (removes the document's assignment, without
deleting the shared property definition). Pins are saved with the document.

Markdown code blocks have a **Copy Code** button in both editable and read-only
views. Successful copies briefly animate the icon to a solid green check-circle;
they do not show a success toast.
## Markdown outline

On desktop, Markdown documents with at least three headings show a tick rail in
the left margin. Every section whose content overlaps the editor viewport is
highlighted, including a section whose heading has already scrolled above it.
Hover a tick (or Tab to its button) to expand it and nearby ticks and show a
rounded preview with the section heading and up to three lines of body text.
While a preview is open, only its tick is emphasized; visible-section highlights
return when the preview closes.
Click a tick or press Enter to jump immediately to its heading without closing its preview
or collapsing the expanded ticks. Scrolling, resizing, and
editor updates refresh the visible-section highlights.

On a local HTTPS stack, document and image downloads use `/local-storage/`
on the app's HTTPS origin. A request to HTTP localhost indicates a stale
storage URL or stack configuration; hard-refresh after updating the stack.
Markdown also needs a successful `/sync/document/.../connect` WebSocket upgrade.
A 403 there indicates the sync origin check, which the local proxy handles for
HTTPS machine hostnames; verify the proxy configuration before retrying.

## Live database answers

With Databases on, type `/database` and choose **Database** to insert a live answer
to a question about a database. Answers run with each reader's database access and
refresh when referenced tables change. See
[Databases](databases.md#ai-questions-and-live-answers) for the question box, source
picker, displays, and editing.

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
the formula bar to search people, documents, channels, email and dates, then choose an
item with the pointer or keyboard. Pasting a Macro app link renders a document
pill. Legacy links retain navigation parameters. Routed links retain compatible
block targets, but not workspace paths or pane-local search. Formulas still use
`@` inside a formula or email address does not start mention search. Other Markdown
is literal text. Mentions remain attached through copy/fill, undo and collaboration;
Excel/CSV export uses their display text. Plain URLs and email addresses are clickable;
web links use the same hover preview as channel messages. Click the surrounding cell
or use the formula bar to edit link text. AI `set_cells` accepts Macro URLs or the
same `<m-user-mention>` / `<m-document-mention>` / `<m-date-mention>` encoding as docs.
Formula references to mention cells use literal labels, never execute a label as a formula.

Dates: `@tomorrow`, `@next friday` or `@sep 28` offer a **Dates** bucket and insert
the same clock chip as docs; hover it for the full date, and edit the cell to change
it. A cell holding only a date chip is a date value: `=A1+7` produces a date, and
Excel export writes a dated number rather than the label. Typed dates such as
`9/28/2026` or `2026-09-28`, `=DATE(...)`, and arithmetic on date cells display as
dates without choosing the Date number format. A difference of two dates stays a
plain day count, and an explicit number format from the toolbar always wins.

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

**Comments** in the document header opens the workbook commenting sidebar. Range labels
navigate to the corresponding sheet and cells; deleted-sheet threads remain
readable. Range threads are filtered by **Open**, **Resolved**, or **All**;
Open is the default. **Discussion** contains comments about the whole workbook
and is the sidebar's new-comment composer. To start a cell comment,
select the range and use the ribbon, keyboard shortcut, or cell context menu.
Both surfaces use the shared message controls for replies, edits, deletion,
reactions, and attachments. Range threads also offer **Resolve** and **Reopen**.
Mentions and replies use inbox notifications and message links. Older spreadsheet
annotation comments are not displayed.
Opening an inbox notification opens the sidebar and targets its comment/range.
Range links leave Discussion on its normal timeline; workbook links
open that discussion at the linked message and clear the previous range highlight
or navigation error. A resolved range link switches the filter to **Resolved** so
the targeted thread remains visible.
Comment-only access can post/reply; view-only access can read. Edit/delete applies
to the author's own comments, and failures retain the input draft. Draft demos
must be saved before persistent comments are available.

## Ask Macro about a spreadsheet

**Ask Macro** sits immediately left of **Share**. Select the relevant cells, then
click it to open a new agent session in a split beside the workbook. The composer starts
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

## Presentations (PowerPoint)

Uploaded `.pptx` files open in the `pptx` block (`/app/pptx/<documentId>`).
With the `enable-pptx-editor` PostHog flag (on by default in development
builds; `ENABLE_PPTX_EDITOR` overrides it) the block is a full editor; with the
flag off it offers the file for download, as before. The deck is parsed,
rendered, and edited by the Rust `pptx_engine` compiled to WebAssembly in a
lazily created module worker, so the first open of a session pays a
one-time ~6 MB module download.

Layout and test hooks:

- **Slide rail** (`nav` "Slides", `data-testid="pptx-slide-rail"`): one
  `pptx-thumbnail` button per slide, labelled `Slide N: <title>`, with
  `aria-current="true"` on the current one. Hovering a thumbnail shows
  **Duplicate slide**, **Hide slide**/**Show slide**, and **Delete slide**;
  thumbnails reorder by dragging. **New slide** is at the bottom.
- **Stage** (`pptx-stage`, focusable): click selects a shape
  (`pptx-selection`, handles `pptx-handle-<nw|n|ne|e|se|s|sw|w>` and
  `pptx-rotate-handle`); drag moves it; handles resize and rotate. The stage
  covers exactly the slide, so slide point `(x, y)` is at
  `stage.left + x × stage.width / slideWidth`.
- **Text**: double-click (or Enter/F2 on a selected text shape) starts
  editing; keystrokes go to a hidden textarea (`pptx-text-input`, "Slide
  text"). The caret is `pptx-caret`, an SVG line of zero width, so assert it
  with `toBeAttached()`, not `toBeVisible()`. Escape stops editing.
- **Tables**: double-click a cell to edit it in `pptx-cell-input`; Enter
  commits, Escape cancels.
- **Toolbar** (`pptx-toolbar`): Undo, Redo, Text box (`pptx-insert-textbox`),
  Insert shape (`pptx-insert-shape`, then `pptx-shape-<preset>`), Picture,
  Table (`pptx-insert-table`), Bold (`pptx-bold`), Italic, Underline,
  Smaller/Larger text (`pptx-font-size` shows the size), Text color, alignment,
  Bullets, Shape fill, the save state, Save, and Download.
- **Keyboard** on the stage: Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z (or Ctrl+Y),
  Cmd/Ctrl+S saves now, Cmd/Ctrl+D duplicates, arrows nudge (Shift for 10 pt),
  Delete removes, PageUp/PageDown change slides.
- **Speaker notes** (`pptx-notes`) sit below the slide.

Changes save automatically 1.5 s after the last edit, when the tab is hidden,
and when the editor closes; `pptx-save-state` reads **Saved**, **Unsaved
changes**, **Saving…**, or **Save failed**. Each save stores the whole file as a
new document version through `PUT /documents/{id}/simple_save` (limit
100 MB). Viewers without edit access get the same view with editing disabled.

Everyone with the deck open edits it live. The deck is shared through the sync
service as Loro maps (one entry per shape, slide position, relationship, and
part; see `pptx_engine::collab`), seeded from the stored file the first time
someone who can edit opens it. Others' edits appear within a second; edits to
different shapes merge, and edits to the same shape resolve to the latest.
Undo takes back only your own changes. Presence shows in the stage's top-right
corner (`pptx-collaborators`, one `pptx-collaborator` avatar per person), as
outlines with name tags around the shapes others selected
(`pptx-peer-selection`, `data-peer="<name>"`, "… is typing" while they type),
and as colored dots on the thumbnails of slides they are on. A viewer who opens
a deck nobody has shared yet, or anyone when the sync service is unreachable,
gets the stored file read-only.

Macro AI reads decks with `ReadPresentation` (slides, layouts, theme colors,
and every shape with its id, kind, placeholder role, position in points, text,
and table cells; `ReadContent` returns the same description) and changes them
with `EditPresentation`, an atomic batch of the editor's own operations saved
as a new version. When an `EditPresentation` result arrives in chat, an open
editor of that deck reloads in place and says **Updated with changes made
elsewhere.** If it holds unsaved edits it keeps them and says the deck also
changed elsewhere; saving those edits replaces the other version.

To exercise the editor without a backend, run the browser fixture from
`apps/web`:

```sh
bunx vite --config src/features/block-pptx/browser-test/vite.config.ts
# http://127.0.0.1:3018/?deck=generated/kitchen-sink-financial.pptx
```

It mounts the real editor and worker over corpus decks (`?readonly` for a
viewer, `?autosave=0` to save only on demand). `window.pptxFixture` exposes
`saved()`, `saves()`, `engine()`, `errors()`, `notices()`, and
`externalEdit(ops)`, which applies operations to the stored copy with a second
engine instance and announces the change the way an AI edit does. With `document`, `user`, `worker`, `socket`, and `token` parameters the
fixture is one collaborator on the real sync service
(`browser-test/sync-server.ts` boots the compiled sync Worker in Miniflare;
build it once with `\cd services/sync-service && just worker-build`), and
`window.pptxFixture.collab` exposes the connection status, peers, and shared
entries. Its Playwright suites run with
`bunx playwright test --config src/features/block-pptx/browser-test/playwright.config.ts`
(set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when the bundled browser is not
installed); `collaboration.browser.e2e.ts` opens several people on one deck. The editor sections above were verified on this fixture; the
`/app/pptx` route itself needs a backend with an uploaded deck.

## Create and type

Pasting a Macro `/app/agents/<uuid>` session URL into a Markdown editor converts
it to an agent mention, just like the legacy `/app/agent/<uuid>` URL. Link query
parameters are retained, except for referral codes.

Pasting a routed entity link such as `/app/drive/md/<uuid>` in an app editor
creates the same document mention as a legacy link. Routed links retain the
entity identity and compatible block targets (for example `comment_id`), but
not the workspace path or pane-local search state. A copied multi-pane URL
(`/app/.../~/...`) references its rightmost pane. If that pane has no supported
entity, the URL remains an ordinary link. Project task comment targets, Home PRs,
and agent chat links also convert to their respective entity mentions.

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
On Android, use the software keyboard to check `:` emoji, `/` commands, `;`
snippets, and `#` tags where enabled. Each should open once and filter as you
type. Tapping an emoji or command applies it; a second `#` closes the tags menu
and leaves literal `##` for Markdown headings.

AI text-writing operations require a paragraph/list-item or text-run ID. A
table, row, cell, or list-container ID is rejected with guidance to choose a
content block or use `setCell`. Existing stray inline content directly inside
table cells is preserved in paragraphs when the editor opens the document.

`@` opens the mention menu wherever the caret starts a word, including directly
in front of existing text — the menu opens empty there instead of searching for
the word ahead of the caret. Typed inside a word (`he@llo`) it stays literal text.
On Android, verify this with the software keyboard: tap `@`, type a name to
filter, and tap a result to insert a single mention. The menu should remain
visible above the keyboard while typing.

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

## CRM company mentions

With CRM enabled, type `@` followed by a company name or domain in an editor or
composer. Companies appear in their own mention bucket. With
`ENABLE_GRAPHQL_SOUP` enabled, results include cached companies even if they are
absent from the first 500 companies in the REST Quick Access feed; the REST feed
remains a fallback. Cache search covers synchronized companies, not the entire CRM.

To verify, search for a cached company absent from that REST page, select it, and
check that the inserted company mention points to the correct company. Also check
searching by domain and that an open picker updates when companies finish hydrating.
Discard unsent test drafts rather than sending them.

## Project mentions

With Projects enabled, type `@` followed by a project name in an editor,
composer or spreadsheet cell. Projects (not folders) come from Quick Access, so
they appear alongside documents and tasks in the **Documents, Agents, & Tasks**
section and in entity property pickers that accept projects. The command menu
keeps its own project search. Selecting one inserts a document mention with the
project's icon and current name, like a channel mention. Clicking it or
pressing Enter on it opens the project the way a task mention opens a task:
in Tasks, under **Projects** › the project (on touch devices, as the project
view on its own). A project you cannot read shows **No Access**. Pasting
`/app/initiative/<id>` or a Tasks project link inserts the same mention.

The mention is stored as
`<m-document-mention>{"documentId":"<initiative id>","blockName":"initiative",…}</m-document-mention>`
(`project` is a folder). In a document it is tracked as a reference like other
entity mentions. It is deliberately not a channel-message reference, so
mentioning a project in a channel never shares the project with the channel's
members.

To verify, mention a project in a document and in a channel draft, check the
mention opens the right project, rename the project and reload to see the name
update, and delete the mention. Discard unsent test drafts rather than sending
them.

## CRM associations

With CRM enabled, any task, document or call can point at CRM records through the
`Companies` and `Contacts` system properties: side panel `Properties` →
`Add property`. Both pickers list Quick Access records: the team's companies and
its most recently interacted contacts, filtered by name, domain or email. CRM
contacts have their own Quick Access bucket, apart from people, and are not
offered in `@` mentions or the command menu. Values show the
record's name and open the company or contact. An entity can carry the property
without listing it (set at creation or through the API); adding that property
pins the existing value rather than clearing it. Calls are linked automatically
when they end, from their participants and the invitees of the calendar event
carrying the meeting link; verify on a finished call's `Properties`.

## Native offline reopening

On native mobile, previously opened Markdown documents/tasks can reopen after an
app restart using their cached body and last-known permissions. Warm the document
online first, then restart with API traffic blocked: verify the existing body,
make a disposable edit, and restart offline again to check local recovery.
Restoring connectivity must reauthorize synchronization before queued edits reach
the server; verify the server copy, not just the still-cached editor text.
Also reconnect after the initial sync's 10-second timeout: a reconnect snapshot
must release queued edits without requiring the document to reopen. A document
content-readiness timeout is retryable and must not revoke its cached open
context; explicit access denial still does.
The body should not wait for unrelated CRM metadata, references, duplicate-task
suggestions, closed sharing/tag menus, or disabled mention queries. With those
requests pending, the cached editor remains visible; optional information can
appear when its own request finishes.

For a cold deep link or restored split, document loading waits for persisted
user identity before capturing its offline session; a stalled auth request must
not delay an identity already restored from IndexedDB. If no identity is cached,
the normal auth query must succeed first. A previous logout marker is not a
cached identity: after signing in again, it must trigger fresh authentication,
not clear the new login cookie. Verify this restart/deep-link flow with a
disposable account. Logout during the identity wait prevents the old load from
opening under a subsequent login.

Cached open context is scoped to the signed-in user and invalidated at logout;
permission tokens are never persisted. A missing body snapshot still requires an
online open—metadata alone must not produce an editable empty document. This path
does not imply offline coverage for PDFs, attachments, or other binary files.

## Reference hover previews

The `@` menu includes `Recent agent sessions` after Channels and before
Companies. Search by session or persona name within the 500 most recently
updated accessible sessions. Menu rows show the
session title followed by a muted persona name, including `@Cursor` and
`@Macro` for built-in personas. Names from the session API take precedence;
older responses use the shared built-in name resolver or cached custom bots.
Selecting one inserts an
inline reference showing the shared agent icon and an underlined session title.
Chips omit persona avatars and status. Click it (or select the node and press
Enter) to open `/app/agent/<id>`.
It references an existing session; it does not invoke the persona, attach its
transcript to AI context, or grant access. Private/deleted sessions show an
unavailable label. Mounted references refresh every 30 seconds while the tab is
active to update titles and check access. Expanded session references are block-level
Magic Chips with the same filled background as document cards. Click the card body
to select its editor node (border and selection ring); use **Open session** to navigate.
The collapse action returns the card to an inline session mention. Text before and
after an expanded reference remains in separate paragraphs.

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
3. While running, the button row shows a `Stop` button (a11y text `Stop AI edit`), and the
   live cursor walking the text is labelled with the editor's name: `Macro (AI)` for an
   inline edit, or the name of the agent or persona whose session asked for the edit
   (e.g. `Grunk (AI)`). Edits stream directly into the document — there is no
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
trash button. Deleting a comment's first message deletes the whole discussion —
the confirmation reads `Delete comment`, the replies under it go too, and an
anchored comment's highlight clears from the document. Deleting a reply removes
only that reply. On mobile, the new-comment composer is docked above the navigation bar,
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

An inline-comment notification or `/app/md/<id>?comment_id=<comment-id>` link
should scroll to the anchor and open its thread on the first click, including
when the document has not loaded yet. Verify both comments arriving before the
editor and comments arriving after it. Once loaded, click elsewhere in the
document, then click the same notification again: it should revisit the comment,
while background comment refreshes should leave the user's position alone.

When checking desktop margin placement, scroll a long document while an embed
or image above the highlighted text changes height. Scroll anchoring may keep
the text at the same screen position; its comment card should stay aligned
through the resize, without briefly jumping upward or downward. Repeat with
several rapid height changes, including while scrolling has paused.

Also verify anchored comments in Drive's detail pane: open a document with
existing text anchors, then click a numbered comment badge to expand it. The
document should stay visible and the thread should open; loading the document
with its badges still collapsed does not exercise thread rendering. Comment
copy links should retain the document/task route and the selected comment.

### Document discussions

Document comments are messages read and written through
`/dss/messages/document/<id>`, and both comment surfaces reuse the channel
message components, as channels do.

Below the editor, expand `Discussion` to see comments without a text anchor.
Its `Leave a comment...` composer is the channel composer: `Attach files`,
formatting, mentions, and `Send message` (Enter also submits). Confirm
completion by the new message appearing above the composer; a failed send
retains the draft. The timeline initially loads a bounded page with up to three
preview replies per thread. Expand a thread to load its replies;
`Load earlier comments` pages backward. Live updates preserve unsent replies
and edits while updating the surrounding thread.

Discussion and comment headers include the date for older messages (for example,
`Yesterday at 4:37 PM` or `09/24/26 at 4:37 PM`). Regular channel timelines retain
their date dividers and time-only message headers.

When verifying `@` mentions, compare the same person query in the document body
and the Discussion composer: shared contacts use the same recent-interaction
ranking. The desktop menu keeps up to three People results visible while other
result categories load; use **View all** for the remaining matches. Check that a
person stays clickable after document and email results arrive. Type and
backspace through a query that keeps the same matches: existing rows should
stay mounted and the menu should not collapse while cached results refresh.
Check document titles and their order as well as People: type and backspace
between a name's prefixes and verify the top document does not disappear and
return while the result count briefly drops.
Changing the total number of matches should not change a category's preview
slots when it still has enough rows to fill them; use **View all** for the full list.
Clear the unsent draft after testing.

Select text and choose the comment action to create an anchored comment. These
threads appear beside their text in the margin (or in the active thread drawer
on phones) and never in the bottom Discussion, including after live updates or
reloads. Links to these threads open the margin without changing the bottom
Discussion's timeline or expanding it. Existing highlights locate threads by
their stable mark IDs. Replies, attachments, reactions, and editing use the same
message controls as channels.
Removing the last marked text moves its retained conversation to Discussion,
where it remains after reload. Removing only part of a marked range keeps the
conversation anchored to the remaining text. On phones, the active Markdown
thread opens in a drawer with a pinned reply composer; long-press any message
for edit, delete, copy-link, and reaction actions.

A document thread carries no thread-level controls above it. Deleting the root
message deletes the whole discussion, replies included, and answers with the
root's tombstone. `Copy link` targets the
specific comment with `comment_id=<message id>`. Previously copied numeric links
still resolve under current document permissions. Deleting an anchored Markdown
discussion removes its mark while preserving the document text and any
overlapping comments. If deletion happens while the document is closed, its next
editable view removes the retained mark when the document loads. Read-only
viewers see plain text without a dead comment highlight; the stored document
and overlapping live comments stay intact.

PDF comment threads in the right margin use the channel composer (`Leave a comment...`, Enter sends) and the message
thread controls. Highlight comments come from selecting text and choosing the
comment button in the selection menu; placeable comments come from the toolbar
`Comment` tool and a click on the page. Discussions read and post through
`/dss/messages/document/<id>`; anchor geometry still loads from
`/dss/annotations/anchors/document/<id>`. Deleting a highlight's discussion keeps the highlight as a plain
highlight; deleting a placeable's discussion removes the placeable. An anchor bound only
to a legacy annotation thread that was never imported stays hidden rather than
shown as a bare highlight.

## Word (DOCX) editor

When `enable-docx-editor` is on, uploaded `.docx` files open at
`/app/write/<id>` in an editor instead of the PDF preview. The flag is a
PostHog flag that is on by default in dev mode; set `VITE_ENABLE_DOCX_EDITOR`
to override it locally. The header label has a **Beta** badge. Pages are laid
out and drawn by Macro's own DOCX engine (Rust compiled to wasm, in a worker)
as `<canvas>` sheets with Word's pagination, so the document's text is not
in the DOM. Edits sync through the sync service as you type: every open copy
updates live and shows each collaborator's caret with their name
(`[data-docx-peer]`).

- Pages are `[data-docx-page="<index>"]` elements. Click a page to place the
  caret, drag to select, double-click for a word and triple-click for a
  paragraph. On a touch screen a swipe scrolls, a tap places the caret, and
  a double tap or a held press selects a word. Keystrokes go to a hidden textarea, `[data-docx-input]`
  (labelled `Document text`); it must have focus, which a click on a page
  gives it. Read text back from another tab or after a download, not from
  the page.
- Editors get a toolbar labelled `Document formatting`: `Undo`, `Redo`, the
  `Paragraph style`, `Font` and `Font size` selects, `Bold`, `Italic`,
  `Underline`, `Strikethrough`, `Superscript`, `Subscript`, the `Text color`
  and `Highlight` menus (`[data-docx-menu="color"]`,
  `[data-docx-menu="highlight"]`), `Clear formatting`, `Bulleted list`,
  `Numbered list`, the alignment buttons, `Decrease indent`, `Increase
  indent`, the `Line spacing` menu, `Insert table` (inside a table also the
  `Table rows and columns` menu, `[data-docx-menu="table"]`, to insert or
  delete rows and columns or the table), `Track changes`, `Hide tracked
  changes` / `Show tracked changes`, `Comment on selection`, `Find and
  replace` and `Download .docx` (viewers get `Find and replace` and
  `Download .docx`).
  While tracking is on (or the caret is on a tracked change) it also shows
  `Accept change`, `Reject change`, `Accept all changes` and `Reject all
  changes`.
- The browser's own find cannot see canvas text, so Mod+F in the document
  (or `Find and replace`) opens the editor's find bar (`[data-docx-find]`) in
  the top right; Ctrl+H (Cmd+Shift+H on a Mac) opens it with the replace
  field. The `Find in document` field (`[data-docx-find-query]`) searches as
  you type and shows `<n> of <total>` (`[data-docx-find-status]`); matches
  are highlighted on the pages (`[data-docx-find-match]`). Enter and
  Shift+Enter (or the arrow buttons, or Mod+G) move between matches and
  select them; `Match case` and `Whole words only` narrow the search. Straight
  and curly quotes match each other. The `Replace` toggle shows `Replace
  with` (`[data-docx-find-replacement]`) with `Replace`
  (`[data-docx-replace]`) and `Replace all` (`[data-docx-replace-all]`);
  replacements follow tracked changes and one undo takes back a replace all.
  Escape closes the bar with the current match selected.
- Arabic and Hebrew paragraphs lay out right to left as in Word (joined
  Arabic letters, mixed-direction lines in visual order); the left and
  right arrow keys move left and right on the page.
- Mod+Z, Mod+Shift+Z and Ctrl+Y (or the toolbar buttons) undo and redo your
  own edits only, never a collaborator's. Mod+B/I/U format, Tab and
  Shift+Tab indent list items, Enter splits paragraphs and Shift+Enter
  inserts a line break.
- `Track changes` turns tracking on for the whole document (it is saved in
  the file, as in Word): every editor's typing then shows as an underlined
  insertion and deletions stay visible struck through, each under its
  author's name. Formatting changes (bold, alignment, lists, indents) are
  recorded too: the text looks formatted, and Accept and Reject appear when
  the caret is in it. A thin bar in the left margin marks every line that
  holds a change. Accept and reject act on the selection, the change at
  the caret, or every change.
- Double-click a page's header or footer area to edit it. The body dims, the
  area gets a dashed edge and a `Header` (or `Footer`) label with a `Close`
  button; Escape or a click on the body returns to the body. Header and
  footer edits reach collaborators and the download like body edits.
- Click a footnote or endnote at the bottom of the page (or after the body)
  to type in it, as in Word; nothing dims. Escape or a click on the body
  returns to the body. Comments stay with the body text.
- Clicking a DOCX in the Home list opens the editor in the Home preview pane.
  Viewers and commenters see the same paginated pages, read-only.
- To comment on any text, including table cells: select it, then click the
  floating `Comment` button beside the selection
  (`[data-docx-comment-button]`). You can also use the toolbar `Comment on
  selection` button or Mod+Alt+M. The draft opens a thread card in the right
  margin. Posting creates a normal document discussion (`markdown` anchor
  with `mark_id`), so it also appears in channels and notifications.
  Commented text is highlighted by overlay elements
  (`[data-docx-comment-highlight]`) above the canvas. Comments anchor in the
  body only, not in headers or footers.
- Threads whose text was deleted are listed under `Comments on text that has
  changed`, above the `Discussion` composer.
- AI `CommentOnDocument` works on DOCX by quote. The editor pins each quote to
  the first matching text the next time someone opens the file.
- `Download .docx` exports the current collaborative state with every edit,
  including headers, footers and tracked changes. Comments stay in Macro
  threads and are not written into the file.
- The stored upload is not rewritten yet. Search, the PDF export and AI
  `ReadContent` still see the original file.
- AI `EditDocument` edits Markdown documents only and rejects DOCX files.

## Document history

On desktop, open the title's file menu (**…**) and choose **History**. This
opens an overlay filling the current document block, with a read-only version
preview on the left and a timeline graph plus sessions on the right. History is
no longer a side-panel section and its file-menu item is hidden on mobile.
Scrub the graph to preview a point in time, or select a session to see its changes.
**Current version** returns the preview to the live version; **Fork** copies the
selected version into a separate document. **Close history** or Escape returns
to the mounted editor without losing its scroll position. The two columns scroll
independently, and other app splits remain available.

## Side panel

Right side of a doc (toggle with `Hide/Show Side Panel`):

- `Actions` → `Ask Macro` (opens a doc-scoped AI chat, see ai-chat.md), and on
  desktop a `Copy as prompt` pill for documents and tasks. Its primary button
  runs the last-used agent action; the `Agent options` caret lists `Copy as
  prompt`, `MCP setup instructions`, and an `Open in` group (Claude Code Web,
  Codex Desktop, Cursor, Zed). Tasks add `Copy branch name`. A document prompt
  wraps the title and markdown in `<document>` / `<document-content>` tags with
  no branch instructions; the toast reads `Prompt copied to clipboard`. The
  Files-view title menu (three dots beside the breadcrumb) also lists `Copy as
  prompt` directly above `Download` for plain documents.
- `Details` → Owner, Created, Last updated.
- `Tags` → `Add tags` (dialog). Click a tag's label to toggle and save; Shift-click
  keeps the picker open for multiple selections. Reopen it to remove a tag.
  With GraphQL Soup enabled, applying the first tag refetches only that entity's
  properties; later edits update the existing assignment optimistically. Verify
  both the side panel and list-row chip, then reload to confirm persistence.
  This must also work after background backfills populate more than 128 cached
  Soup variants—tag saves must not scan all cached pages.
  `Properties` → `Add property`.
- `Activity` is collapsible; document statistics and ownership timestamps appear in the footer.
- `Activity` lists the same glyph-rail lines as `/app/component/activity` (plain glyphs on a
  thin connector, one line each with long names truncated, compact `17h` / `8d` / `1mo`
  times; consecutive edits fold into one `made 3 edits` line). Past four entries it shows the
  three newest, a `View all activities` toggle row (dotted connector, caret glyph), and the
  oldest fetched entry (usually `created this`) pinned last; the toggle flips to `Show less`
  once expanded.
  Human content edits appear after the next sync flush. Continued editing creates
  one Activity event until that editor has been inactive for five minutes; their
  next edit then starts another event. Opening a document alone creates no edit.
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
