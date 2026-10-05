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
the panel beneath the formatting and formula bars. While a workbook opens, a
shimmering placeholder grid (status "Opening spreadsheet…") stands in for it, and
formula cells show a short shimmer bar until their first results arrive; wait for
real cell text before reading values. They have the `.spreadsheet` file type; uploading an
Excel or CSV file in Files or a channel opens a read-only spreadsheet preview, including existing `/app/unknown/<uuid>` links and CSV code routes. Review **Import notes**, then choose **Edit in Macro** to create a collaborative native copy. The original file and its link remain intact. Conversion waits for a durable save before opening the copy; a failed save can be retried without creating another copy. The normal document download action retrieves the original; the spreadsheet footer exports the imported representation.

You can also open a native spreadsheet and use the bottom-right **Import and export → Import…** menu to import its sheets. A large workbook shows a progress bar on **Import workbook** while it is written; the page stays responsive, and one undo removes the whole import.

Imported Excel workbooks keep conditional formatting, data validation and notes.
Conditional formats recolor cells and draw data bars and icons, and they update as
values change. A selected cell with a list rule shows an arrow at its right edge:
click it or press Alt+Down to choose a value. Typing a value the rule does not allow
shows the rule's message in the footer, and a "stop" rule keeps the previous value.
A red corner marks a cell with a note; selecting the cell shows the note, and any
input message, beside it.

Images and charts (column, bar, line, area, pie, doughnut, scatter, radar,
bubble, stock and surface, drawn as a contour) are drawn over their cells and
move with them; charts redraw as the cells they read change. Each is a `figure`
named after the chart title ("Chart: Revenue") or the image description. The
toolbar's **Insert chart or image** menu (chart icon) adds a chart of the
selected cells — or, from one cell, of the table around it, placed beside it —
or an image file (PNG, JPEG, GIF, WebP or BMP up to 2 MB) at the active cell.
Its **More charts** submenu holds Radar, Filled radar, Bubble, Stock and
Contour; a stock chart needs three or four series (high, low, close, with open
first for up-down bars), and a bubble chart reads x values from the first
column, then values and sizes in pairs. Imported shapes, text boxes, lines,
groups and SmartArt are drawn too, as `figure`s named after their text (or
their name, such as "Straight Connector 2"); a shape linked to a cell shows the
cell's value. They move, size and delete like images, and download as Excel
wrote them (SmartArt as a group of its shapes). EMF and WMF pictures show a
picture drawn of them and download as the original metafile. Click a drawing to select it: drag it to move it, drag a handle to
size it, press Delete to remove it (undo restores it) or Escape to return to the
cells. Double-click a chart, press Enter, or use its pencil button to open **Edit
chart** (type, title, legend, the cells it charts, series in rows or columns).
From the keyboard, Ctrl+Alt+5 (also in the Insert menu) selects the first
drawing, Tab and Shift+Tab move between drawings, arrow keys move the selected
one (Shift sizes it, Alt by one pixel). Pivot tables show their last values as ordinary cells; the Excel
download keeps them, and Excel rebuilds them from their data when the file opens; pivot tables over other
workbooks or data connections download with the data Excel saved with them (connections without saved
passwords), for Excel to refresh from their source. GETPIVOTDATA formulas
that read a kept pivot table calculate from its cells, so editing a value in the table updates them.
Deleting a sheet whose data a chart on another sheet reads keeps the chart: it
shows the values it had, which no longer change.

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

CSV imports a file up to 20 MB into the selection, adding rows if needed within the
100,000 × 16,384 limit. Existing cells in that rectangle
are replaced, with undo available. Excel imports accept up to 50 MB, 300 sheets,
2,000,000 filled cells, and 100,000 rows × 16,384 columns (A–XFD) per sheet. The footer
shows the sheet's size, and **+ Add columns** appends 26 more. An import preview lists
each sheet and warns about unsupported content (for example rich text, ink and sheet
protection). Choose
**Insert new sheets** to keep existing work, or **Replace workbook** to replace it
in one undoable operation. Names must be unique when inserting sheets. Canceling
leaves the workbook untouched; a replacement is blocked if the workbook changed
while the preview was open. Legacy `.xls`, macros, and encrypted files are rejected.

**Import and export → Download as Excel (.xlsx)** exports every sheet with formulas,
current formula result caches, precise numeric values, custom Excel number formats, fonts, borders, and column widths. Named ranges, named constants, and names defined by formulas are retained and calculate. Imported legacy formulas keep Excel's implicit intersection, shown with `@` as current Excel shows it; 3-D references such as `SUM('Jan:Dec'!B2)` are listed sheet by sheet. Imported merged ranges, hidden sheets/rows/columns, row heights, filters, and frozen panes are retained for export. Macro hides imported rows and columns, shows hidden sheets and individual cells of merged ranges; editing a covered merged cell omits that merge during export with a warning so the edit is preserved. Imported charts, images, shapes, text boxes, pivot tables, conditional formatting, validation and notes are written back. Structured table formulas and rich text are not fully supported; review import notes before conversion.
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

- **Ribbon** (`pptx-toolbar`): tabs `pptx-tab-<id>` for Home, Insert,
  Design, Transitions, Slide Show, Review, and View, plus contextual Shape Format,
  Picture Format, Table Design, Layout (tables), Chart Design, and SmartArt
  Design tabs that appear for the selection (`pptx-tab-shape-format`,
  `pptx-tab-picture-format`, `pptx-tab-table-design`,
  `pptx-tab-table-layout`, `pptx-tab-chart-design`,
  `pptx-tab-smartart-design`). Undo/Redo sit left of the
  tabs; the save state (`pptx-save-state`), Download, and **Present**
  (`pptx-present`) sit right. Home: clipboard and **Format Painter**
  (`pptx-format-painter`: click, then click a shape or select text to paint
  the selection's look and text formatting; double-click keeps it armed until
  Escape; the stage carries `data-format-painter` while armed), **New slide**
  (`pptx-new-slide`), layouts, font (`pptx-font-family`) and size
  (`pptx-font-size`) boxes, Bold (`pptx-bold`) and the other run toggles,
  text and highlight colors (`pptx-text-color`), Character Spacing
  (`pptx-char-spacing`: Very Tight to Very Loose as
  `pptx-char-spacing-<points>`, or More spacing `pptx-char-spacing-custom`),
  bullets and numbering, list
  levels, line spacing, alignment, Text Direction (`pptx-text-direction`:
  Horizontal, Rotate all text 90°, Rotate all text 270°, and Stacked as
  `pptx-text-direction-<horz|vert|vert270|wordArtVert>`, More Options…
  `pptx-text-direction-more`), the shape gallery (`pptx-insert-shape`,
  then `pptx-shape-<preset>`), Arrange (`pptx-arrange`), Shape fill
  (`pptx-fill`) and outline (`pptx-outline`), Find, and Replace. Insert: table
  grid (`pptx-insert-table`, then a cell of `pptx-table-grid`), Pictures
  (`pptx-image-input`), Shapes, Chart (`pptx-insert-chart`, then
  `pptx-chart-<kind>-<grouping>`), SmartArt (`pptx-insert-smartart`; see
  **SmartArt** below), Video and Audio (`pptx-insert-video`,
  `pptx-insert-audio`; file inputs `pptx-video-input`, `pptx-audio-input`;
  clips up to 50 MB, or 2 MB in a shared presentation because the sync
  service keeps presentations under 4 MB, are embedded with a poster frame
  or speaker icon), Comment (`pptx-insert-comment`), Text
  box (`pptx-insert-textbox`), and Link (`pptx-insert-link`). A selected
  video or audio shape shows Play (`pptx-media-play`), which plays it over
  the shape (`pptx-media-player`, with `pptx-media-video` or
  `pptx-media-audio`) until the slide is clicked; in a slide show a click on
  the clip plays it in place (`pptx-slideshow-media`) instead of advancing.
  Design: slide background, and Variants that restyle every slide through the
  theme: Colors (`pptx-theme-colors`, then `pptx-theme-colors-<set name>`,
  such as `Red Violet`) and Fonts (`pptx-theme-fonts`, then
  `pptx-theme-fonts-<pair name>`, such as `Georgia`). Transitions: `pptx-transition-<kind>`, Effect options, duration
  (`pptx-transition-duration`), automatic advance, and Apply to all
  (`pptx-transition-all`). Color menus are PowerPoint's theme grid with tints,
  standard colors, Recent colors (`pptx-recent-colors`, custom colors picked
  lately), More colors… (`pptx-more-colors`), and Eyedropper
  (`pptx-eyedropper`, in browsers with a screen color picker).
- **Header & Footer** (Insert ▸ Header & Footer `pptx-insert-header-footer`,
  Date & Time `pptx-insert-date-time`, or Slide Number
  `pptx-insert-slide-number`) opens `pptx-header-footer`, starting from what
  the current slide shows: Date and time (`pptx-hf-date`) updating
  automatically (`pptx-hf-date-auto`, format select `pptx-hf-date-format`
  listing today's date in `datetime1`–`datetime13`) or Fixed
  (`pptx-hf-date-fixed`, text `pptx-hf-date-fixed-text`), Slide number
  (`pptx-hf-slide-number`), Footer (`pptx-hf-footer`, text
  `pptx-hf-footer-text`), and Don't show on title slide
  (`pptx-hf-not-on-title`). **Apply** (`pptx-hf-apply`) changes the selected
  slides; **Apply to All** (`pptx-hf-apply-all`) every slide. A layout without
  the placeholder cannot show the element.
- **Slide Size** (Design ▸ Customize ▸ `pptx-slide-size`): Standard (4:3)
  `pptx-slide-size-standard`, Widescreen (16:9) `pptx-slide-size-widescreen`,
  or Custom Slide Size… `pptx-slide-size-custom`, which opens
  `pptx-slide-size-dialog` (preset `pptx-slide-size-preset`, width and height
  `pptx-slide-size-width|height` in inches, or cm in metric locales,
  orientation `pptx-slide-size-portrait|landscape`, OK `pptx-slide-size-ok`).
  When content must change shape, `pptx-slide-size-scale` asks **Maximize**
  (`pptx-slide-size-maximize`) or **Ensure Fit** (`pptx-slide-size-fit`); a
  proportional change scales without asking. Stage, thumbnails, sorter, show,
  and print follow the new size.
- **Slide rail** (`nav` "Slides", `data-testid="pptx-slide-rail"`): one
  `pptx-thumbnail` button per slide, labelled `Slide N: <title>`, with
  `aria-current="true"` on the current one. Hovering a thumbnail shows
  **Duplicate slide**, **Hide slide**/**Show slide**, and **Delete slide**;
  thumbnails reorder by dragging; right-click opens cut/copy/paste, new,
  duplicate, delete, layout, background, and hide. **New slide** is at the
  bottom. Shift-click selects a range and Cmd/Ctrl-click adds or removes a
  slide (`aria-selected`; the status bar shows `pptx-status-selected`);
  duplicate, delete, hide, layout, transitions, background, copy, cut, and
  dragging then act on every selected slide. Cmd/Ctrl+A selects all slides
  and Cmd/Ctrl+D duplicates them while the rail has focus.
- **Sections** (rail and sorter): a deck with sections shows a
  `pptx-section-header` row (`data-section-id`, `aria-expanded`) before each
  section's slides with its name and slide count. Its caret
  (`pptx-section-toggle`, or double-click) collapses the section's
  thumbnails (view only); clicking the header selects its slides; dragging it
  onto another header moves the section there. Right-click a header for
  Rename Section (in place: `pptx-section-rename`, Enter keeps, Escape
  cancels), Remove Section, Remove Section & Slides, Remove All Sections,
  Move Section Up/Down, Collapse All, and Expand All. The slide menu's **Add
  Section** starts "Untitled Section" at that slide and opens its name for
  typing. Home ▸ Section (`pptx-section-menu`): Add (`pptx-section-add`),
  Rename (`pptx-section-rename-current`), Remove (`pptx-section-remove`),
  Remove All (`pptx-section-remove-all`), Collapse All
  (`pptx-section-collapse-all`), Expand All (`pptx-section-expand-all`).
- **Slide Sorter** (View ▸ Slide Sorter, or `pptx-view-sorter` in the status
  bar; `pptx-view-normal` returns): every slide in a grid
  (`pptx-slide-sorter`, same `pptx-thumbnail` buttons and menu as the rail),
  with the same selection and drag-to-reorder; ★ marks a transition;
  double-click or Enter opens a slide in Normal view.
- **Slide Master view** (View ▸ Master views ▸ **Slide Master**,
  `pptx-view-slide-master`) edits the slide masters and their layouts with
  the same stage, text editing, and Home/Insert tools as slides; every slide
  on a layout (or, for a master, on any of its layouts) follows. It opens on
  the current slide's layout. The rail becomes `pptx-master-rail`: one
  `pptx-master-thumbnail` per page (`data-kind="master|layout"`,
  `data-page-id` the engine id, `aria-current` on the one edited, and a
  PowerPoint tooltip such as "Title Only Layout: used by slide(s) 3-8"),
  masters numbered with their layouts indented beneath. Placeholders show
  dotted outlines (`pptx-placeholder-outlines`). The contextual **Slide
  Master** tab (`pptx-tab-slide-master`, first) has Insert Layout
  (`pptx-master-insert-layout`: a "Custom Layout" with a title and the
  master's footers after the selected layout), Delete
  (`pptx-master-delete`, disabled with a reason in its tooltip while slides
  use the layout, or for a master's last layout or the last master), Rename
  (`pptx-master-rename`, dialog `pptx-rename-layout-dialog` with
  `pptx-rename-layout-name` and `pptx-rename-layout-ok`), Insert Placeholder
  (`pptx-master-insert-placeholder`, then
  `pptx-master-placeholder-<content|text|picture|chart|table|smartArt|media>`,
  `-vertical` for the vertical content and text ones; it lands in the middle
  of the layout, selected), the layout's Title and Footers checkboxes
  (`pptx-master-title`, `pptx-master-footers`), theme Colors and Fonts
  (`pptx-master-theme-colors`, `pptx-master-theme-fonts`), Background
  Styles (`pptx-master-background-styles`: the theme's twelve styles,
  `pptx-master-background-style-<1-12>`, and Reset Background,
  `pptx-master-background-reset`), Format
  Background (`pptx-master-format-background`, the background pane for the
  master or layout), Hide Background Graphics
  (`pptx-master-hide-background`), Slide Size, and **Close Master View**
  (`pptx-master-close`; the status bar's Normal button does the same).
  Right-click a page for Insert Layout, Duplicate Layout, Delete
  Layout/Master, Rename Layout/Master, and Format background…; Delete in the
  rail deletes the page, and Cmd/Ctrl+M inserts a layout. Formatting a whole
  placeholder (or whole paragraphs) of a layout or master also sets the text
  style its slides inherit, so bolding a layout's title bolds the titles of
  its slides. The status bar reads "Slide Master" (`pptx-status-master`);
  Design, Transitions, Animations, Slide Show, the Slides groups, notes, and
  find are not shown there. Engine and AI spelling: the outline's `masters`
  (ids, names, layouts with `slideIds` and placeholder types), any slide-id
  operation on shapes, text, tables, pictures, and backgrounds with a
  master's or layout's id, and `addLayout`, `renameLayout`, `deleteLayout`,
  `insertPlaceholder`, `setLayoutOptions`, and `setBackgroundStyle`.
- **Stage** (`pptx-stage`, focusable): click selects a shape
  (`pptx-selection`, handles `pptx-handle-<nw|n|ne|e|se|s|sw|w>` and
  `pptx-rotate-handle`); Shift/Cmd/Ctrl-click adds to the selection, dragging
  on empty slide draws a marquee (`pptx-marquee`), and several selected shapes
  show `pptx-selection-outline` boxes inside one handle box; drag moves,
  handles resize (several shapes scale together) and rotate. Right-click opens
  a menu for what is under the pointer (shapes, text being edited, a table, a
  chart, or the empty slide). The stage covers exactly the slide, so slide
  point `(x, y)` is at `stage.left + x × stage.width / slideWidth`.
- **Text**: double-click (or Enter/F2 on a selected text shape, or just start
  typing) starts editing; keystrokes go to a hidden textarea
  (`pptx-text-input`, "Slide text"). The caret is `pptx-caret`, an SVG line of
  zero width, so assert it with `toBeAttached()`, not `toBeVisible()`. Escape
  stops editing. Vertical text (Text Direction) is edited in place too: the
  caret lies across the rotated line, and arrow keys follow the screen (in
  text rotated 90°, Down is the next character and Left the next line).
  Turning a text box that resizes to fit its text swaps its width and height.
- **Tables**: press a table that isn't selected and drag to move it, or
  release without dragging to type in the clicked cell in place (same
  caret); Tab and
  Shift+Tab move between cells (Tab in the last cell adds a row); drag across
  cells to select a range (`pptx-cell-range`), which the Table Design/Layout
  tabs and the table menu act on (merge/split, shading `pptx-cell-shading`,
  borders `pptx-cell-borders`, styles `pptx-table-styles`, insert/delete rows
  and columns, distribute, alignment, and Text Direction
  `pptx-cell-text-direction`, items `pptx-cell-text-direction-<value>`; a
  vertical cell's row grows to its text). Drag a column or row border of a
  selected table to resize it. To move a table that is already selected,
  drag near the frame's edge, or click outside it first.
- **Charts**: double-click a chart, or **Edit data** (`pptx-chart-edit-data`)
  on Chart Design, opens the data grid (`pptx-chart-data`, cells
  `pptx-chart-cell-<row>-<col>`, **Apply** `pptx-chart-apply`); Chart Design
  also changes the type (`pptx-chart-type`), title, legend, data labels, and
  colors.
- **Equations** (Office Math, typeset by the engine): Insert ▸ **Equation**
  (`pptx-insert-equation`, or Alt+=) starts a new equation at the caret of
  the text being edited (selected text on one line becomes its text), or in a
  new text box centered on the slide when no text is edited. Its arrow
  (`pptx-insert-equation-menu`) inserts a built-in equation at once
  (`pptx-equation-prebuilt-<id>`: `area-of-circle`, `binomial-theorem`,
  `expansion-of-a-sum`, `fourier-series`, `pythagorean-theorem`,
  `quadratic-formula`, `taylor-expansion`, `trig-identity-1`,
  `trig-identity-2`). The equation is written in a floating editor
  (`pptx-equation-editor`): LaTeX-style linear text (`pptx-equation-input`;
  `\frac{a}{b}`, `x^2`, `\sqrt[n]{x}`, `\sum_{i=1}^n`, `\int_a^b`,
  `\left( \right)`, `\begin{pmatrix}…\end{pmatrix}`, `\begin{cases}`, Greek,
  `\mathbb{R}`, `\text{…}`), a live preview (`pptx-equation-preview`), errors
  (`pptx-equation-error`), a Display toggle (`pptx-equation-display`: own
  line, centered, versus inline), **Insert**/**Done** (`pptx-equation-insert`,
  or Enter; Shift+Enter is a new line of text), and close
  (`pptx-equation-close`, or Escape). An equation counts as one character
  (U+FFFC) of its paragraph: clicking it while editing the text selects it
  whole and shows its text in the editor, where every valid change lands on
  the slide as it is typed (one undo step per equation); double-click focuses
  the editor; Delete or Backspace removes a selected equation, and typing
  replaces it. The contextual **Equation** tab (`pptx-tab-equation`, shown
  while an equation is written or selected) has the built-ins
  (`pptx-equation-prebuilt`, which replace the equation's text), Linear
  (`pptx-equation-linear`, reopens the editor), Display
  (`pptx-equation-display-toggle`), **Symbols** (`pptx-equation-symbols`,
  then `pptx-equation-symbol-<command>` such as `pm`, `alpha`, `infty`, or
  `pptx-equation-symbol-u<hex>` for a character without a command), and the
  Structures galleries `pptx-equation-structure-<fraction|script|radical|integral|large-operator|bracket|function|accent|limit-and-log|operator|matrix>`
  (item `n` is `pptx-equation-structure-<gallery>-<n>`). Symbols and
  structures go into the linear text at its caret; a structure wraps the
  selected linear text and puts the caret in its first empty slot.
- **SmartArt**: Insert ▸ SmartArt opens Choose a SmartArt Graphic
  (`pptx-smartart-dialog`): categories `pptx-smartart-category-<all|list|process|cycle|hierarchy|relationship|pyramid>`,
  layouts `pptx-smartart-layout-<id>` (`default` Basic Block List, `vList2`,
  `hList1`, `process1`, `chevron1`, `cycle2`, `radial1`, `hierarchy1`,
  `orgChart1`, `venn1`, `pyramid1`), the picked name `pptx-smartart-picked`,
  and **OK** `pptx-smartart-ok`. The graphic is inserted selected with its
  Text Pane open (`pptx-smartart-pane`, one `pptx-smartart-pane-line` input
  per node, its `li` carrying `data-level`; close `pptx-smartart-pane-close`;
  the tab on the graphic's left edge `pptx-smartart-pane-toggle` shows and
  hides it). Typing in a bullet edits the node live; Enter adds a node after
  it (splitting at the caret), Tab/Shift+Tab demote/promote, Backspace on an
  empty bullet deletes the node, and the arrow keys move between bullets.
  Empty nodes show "[Text]" (`pptx-smartart-prompt`, editor only). With the
  graphic selected, click a node to pick it (`pptx-smartart-active-node`,
  `data-node`), then type (replaces its text), press Enter/F2, or
  double-click to edit it in place (`pptx-smartart-node-input`; Escape ends);
  Delete removes the picked node. SmartArt Design: Add Shape
  (`pptx-smartart-add-shape`, then `pptx-smartart-add-<after|before|above|below|assistant>`),
  Text Pane (`pptx-smartart-text-pane`), Promote/Demote
  (`pptx-smartart-promote`, `pptx-smartart-demote`), Move Up/Down
  (`pptx-smartart-move-up`, `pptx-smartart-move-down`), Layouts
  (`pptx-smartart-layouts`, then `pptx-smartart-layout-option-<id>`), Change
  Colors (`pptx-smartart-colors`, then `pptx-smartart-colors-<id>`:
  `accent0_1`…, `colorful1`…`colorful5`, `accentN_1`…`accentN_5`), SmartArt
  Styles (`pptx-smartart-styles`, then `pptx-smartart-style-simple1`…`5`),
  Reset Graphic (`pptx-smartart-reset`), and Convert
  (`pptx-smartart-convert`, then `pptx-smartart-convert-shapes` or
  `-text`). The right-click menu offers Add Shape, Change Layout, Change
  Colors, Reset Graphic, and Convert to Shapes/Text. SmartArt in other
  layouts (from PowerPoint) keeps its drawing: text edits apply in place and
  structural edits say "this layout's structure can't be changed here".
- **Effects**: Shape Format's **Shape effects** (`pptx-shape-effects`) and
  Picture Format's **Picture effects** (`pptx-picture-effects`) open
  PowerPoint's Shadow, Reflection, Glow, and Soft Edges flyouts (hover
  `pptx-effects-<shadow|reflection|glow|soft-edges>`). Tiles preview each
  effect: `pptx-effect-shadow-<preset>` (`outerBottomRight`, `innerTop`,
  `perspectiveBelow`...), `pptx-effect-reflection-<preset>` (`tightTouching`
  ... `full8pt`), `pptx-effect-glow-<accent1-6>-<5|8|11|18>` (More Glow Colors
  is `pptx-effect-glow-more`), `pptx-effect-soft-edge-<1|2.5|5|10|25|50>`, and
  `-none` for each. A choice applies to every selected shape as one undo step.
  **Text effects** (`pptx-text-effects`, Shape Format's WordArt styles) give
  the selected text, or whole selected shapes, a shadow or glow
  (`pptx-text-effects-<shadow|glow>`, tiles `pptx-text-effect-shadow-<preset>`
  and `pptx-text-effect-glow-<accentN>-<size>`).
- **Pictures** (Picture Format): **Corrections** (`pptx-picture-corrections`,
  a 5 × 5 brightness × contrast grid of live previews, tiles
  `pptx-picture-correction-b<±n>_c<±n>` such as `b+20_c-40`), **Color**
  (`pptx-picture-color`, Recolor plus dark and light accent variations,
  `pptx-picture-recolor-<value>` with `:` written `-`, such as
  `duotone-accent1`), **Transparency** (`pptx-picture-transparency`, tiles
  `pptx-picture-transparency-<0|15|30|50|65|80|95>`), Change picture
  (`pptx-picture-change`), Reset (`pptx-picture-reset`, then
  `pptx-picture-reset-picture` or `pptx-picture-reset-size`), Picture border
  (`pptx-picture-border`), Arrange, and Size. **Crop** (`pptx-picture-crop`)
  toggles crop mode; its arrow (`pptx-picture-crop-menu`) offers Crop to
  Shape (`pptx-crop-to-shape`, then `pptx-shape-<preset>`), Aspect Ratio
  (`pptx-crop-aspect`, then `pptx-crop-aspect-<w>x<h>`, which crops the
  centered part and enters crop mode), Fill (`pptx-crop-fill`), and Fit
  (`pptx-crop-fit`). The picture's right-click menu has Crop and Format
  picture….
- **Crop mode** (`pptx-crop-overlay`): the slide without the picture, the
  whole image ghosted outside the frame, and black crop handles
  `pptx-crop-handle-<nw|n|ne|e|se|s|sw|w>` (Shift keeps the aspect ratio,
  Ctrl/Alt crops both sides; dragging past the image pads it). Dragging the
  picture (`pptx-crop-frame`) or arrow keys move the image under the frame,
  and the round `pptx-crop-image-handle-<nw|ne|se|sw>` scale it. Enter, Esc,
  a click outside, or Crop again apply the crop as one undo step; rotated
  and flipped pictures crop in place too.
- **Edit Shape** (Shape Format ▸ `pptx-edit-shape`): Change Shape
  (`pptx-change-shape`, then `pptx-shape-<preset>`) and **Edit Points**
  (`pptx-edit-points`; also right-click a shape ▸ Edit Points). Edit Points
  (`pptx-edit-points-overlay`) draws the outline as a red path
  (`pptx-edit-points-path`) with black square vertices (`pptx-edit-point`,
  `data-selected` on the clicked one, whose Bézier handles show as white
  squares `pptx-edit-points-handle-in|out`; on a straight side they sit a
  third of the way along it). Drag a vertex or handle to reshape, drag a
  segment to bend it; Ctrl/Cmd+click a segment adds a point and
  Ctrl/Cmd+click a vertex (or Delete) removes it. The path follows the
  pointer live and the shape updates on release, one undo step per gesture
  (Cmd/Ctrl+Z works in the mode). Right-click a vertex for Delete Point,
  Open/Close Path, Smooth/Straight/Corner Point; a segment for Add Point,
  Delete Segment, Open/Close Path, Straight/Curved Segment; anywhere for
  Exit Edit Points. Esc or a click away from the outline leaves the mode.
  Rotated, flipped, and grouped shapes edit in place; a preset becomes
  custom geometry (`setCustomGeometry`) keeping its fill, outline, effects,
  text and text area, and the box follows the outline.
- **Merge Shapes** (Shape Format ▸ `pptx-merge-shapes`, enabled with two or
  more shapes, text boxes, or pictures selected):
  `pptx-merge-<union|combine|fragment|intersect|subtract>`. The result takes
  the first selected shape's formatting, text, rotation, and id (a picture
  stays a picture with its image in place), replaces the shapes, and is
  selected (Fragment selects every piece); curves stay curves. Engine and
  AI spelling: `mergeShapes` with `shapes` in selection order.
- **Format pane** (`pptx-format-pane`): Format shape… in menus opens fill and
  line, size and position (with alt text `pptx-alt-text`), and text box and
  paragraph settings (Text box's Text direction select is
  `pptx-pane-text-direction`); Format background… opens the slide background. Its
  tabs (`pptx-pane-tab-<shape|effects|size|picture|text>`) include
  **Effects** (shadow, reflection, glow, and soft edge presets and values,
  such as `pptx-pane-shadow-blur` and `pptx-pane-glow-size`) and, for
  pictures, **Picture** (`pptx-pane-brightness`, `pptx-pane-contrast`,
  `pptx-pane-recolor`, `pptx-pane-transparency`, crop edges in percent
  `pptx-pane-crop-<left|top|right|bottom>`, and `pptx-pane-picture-reset`).
  Sliders apply while dragged, one undo step per drag.
- **Find and replace** (`pptx-find`, Cmd/Ctrl+F and Cmd/Ctrl+H): find input
  `pptx-find-input`, `pptx-replace-input`, count `pptx-find-count`, and
  `pptx-replace-all`; Enter steps through matches, selecting each in its shape
  or cell.
- **Animations** tab (`pptx-tab-animations`): with shapes selected, the
  gallery (`pptx-animation-gallery`, tiles
  `pptx-animation-<entrance|emphasis|exit|path>-<effect>`, `pptx-animation-none`)
  replaces their effect; Add Animation (`pptx-animation-add`) adds another;
  Effect Options (`pptx-animation-options`) holds directions
  (`pptx-animation-option-<value>`) and, for text, Sequence As One Object /
  By Paragraph (`pptx-animation-sequence-object|paragraph`). Timing: Start
  (`pptx-animation-start` select: onClick, withPrevious, afterPrevious),
  Duration and Delay in seconds (`pptx-animation-duration`,
  `pptx-animation-delay`), Move Earlier/Later (`pptx-animation-earlier|later`).
  Preview (`pptx-animation-preview`) plays the slide in place. The Animation
  Pane (`pptx-animation-pane-toggle`, `pptx-animation-pane`) lists
  `pptx-animation-row`s (click picks one and selects its shape; Delete or
  `pptx-animation-remove` removes it), and numbered `pptx-animation-tag`s
  mark animated shapes while the tab or pane is open.
- **Export as pictures** (header `pptx-export-open`) opens `pptx-export`: PNG
  or JPEG (`pptx-export-png`, `pptx-export-jpeg`), this slide, the selected
  slides, or all (`pptx-export-current`, `pptx-export-selected`,
  `pptx-export-all`), and a width (`pptx-export-width`); Export
  (`pptx-export-run`) downloads one picture (`<deck> - SlideN.png`) or a zip
  of `SlideN` pictures. Right-click a shape ▸ **Save as picture…** downloads
  it alone as a PNG cropped to its bounds.
- **View ▸ Show**: Ruler (`pptx-view-ruler`: inch rulers along the slide's
  top and left edges, `pptx-ruler-horizontal`/`pptx-ruler-vertical`, measured
  from the center, with the selection shaded as `pptx-ruler-span`), Gridlines
  (`pptx-view-gridlines`, drawn as `pptx-gridlines`), and Grid settings
  (`pptx-view-grid-settings`: Snap objects to grid `pptx-view-snap-grid`,
  spacing `pptx-view-grid-spacing` in points, and smart guides
  `pptx-view-smart-guides`, and Display drawing guides
  `pptx-view-drawing-guides`). Snapping moves the dragged box's top-left corner
  to the grid where no smart guide is within reach; Alt-drag snaps to
  nothing. These choices are remembered in the browser.
- **Guides** (View ▸ Show ▸ Guides `pptx-view-guides`, or Alt+F9) draw the
  deck's drawing guides as dashed lines over every slide (`pptx-guides`, one
  `pptx-guide` line per guide with `data-orient` and `data-position` in
  points; layout and master guides are `pptx-layout-guide` and do not move).
  Dragging a guide moves it in 1/24" steps (Alt: freely) with a tooltip of its
  distance from the slide's center in inches (`pptx-guide-tooltip`, such as
  `← 2.50`); Ctrl+drag copies it; dragging it off the slide deletes it. A
  selected shape or the text being edited keeps clicks over a guide.
  Right-click a guide for Add Vertical Guide, Add Horizontal Guide, Color, and
  Delete; the empty slide's menu has Grid and Guides ▸ Guides, Gridlines,
  Smart Guides, Add Vertical Guide, and Add Horizontal Guide (new guides go
  to the center, or half an inch beside guides already there). While guides
  show, dragged shapes snap their edges and center to them. Guide changes
  are `setGuides` edits: saved in the file (PowerPoint's
  `p15:sldGuideLst`) and undoable.
- **Selection Pane** (Arrange ▸ Selection Pane… `pptx-selection-pane-toggle`,
  or Alt+F10) opens `pptx-selection-pane`: one `pptx-selection-row` per
  object (`data-shape-id`), topmost first with groups nested. Click selects
  (Cmd/Ctrl adds), the eye (`pptx-selection-eye`) hides or shows, Show All /
  Hide All (`pptx-selection-show-all`, `pptx-selection-hide-all`) do every
  object, double-click or F2 renames (`pptx-selection-rename`), and dragging a
  row or Bring Forward / Send Backward (`pptx-selection-forward`,
  `pptx-selection-backward`) reorders it among its siblings.
- **Comments** (Review tab `pptx-tab-review`): New Comment
  (`pptx-review-new-comment`, Insert ▸ Comment, right-click ▸ **New
  Comment**, or Ctrl+Alt+M) opens the Comments pane (`pptx-comments-pane`)
  with a draft attached to the selected shape, else to the slide
  (`pptx-comment-draft`, its marker `pptx-comment-marker-draft`; Post
  `pptx-comment-post` or Ctrl+Enter, Cancel `pptx-comment-cancel`). Each `pptx-comment-thread` (`data-comment-id`,
  `data-resolved`, `aria-current` when picked) shows the author
  (`pptx-comment-author`), a relative time (`pptx-comment-time`, "A few
  seconds ago"), the text (`pptx-comment-text`), replies
  (`pptx-comment-reply-item`), and a reply box (`pptx-comment-reply`, send
  `pptx-comment-reply-post`). Each comment's "…" (`pptx-comment-menu`) has
  Edit comment (`pptx-comment-edit`, then `pptx-comment-edit-input` and
  `pptx-comment-save`), Delete thread or comment (`pptx-comment-delete`), and
  Resolve or Reopen thread (`pptx-comment-resolve`, `pptx-comment-reopen`);
  resolved threads collapse and grey out. Speech-bubble markers
  (`pptx-comment-marker`, `data-comment-id`, `aria-pressed` on the picked
  one) sit at each thread's anchor: beside its shape's top-right corner, at
  its position, or at the slide's top-left corner; clicking one opens its
  thread. Review ▸ Delete (`pptx-review-delete`) offers this comment, all on
  the slide, or all in the presentation (`pptx-review-delete-comment|slide|all`);
  Previous and Next (`pptx-review-previous|next`) walk threads across slides;
  Show Comments (`pptx-review-show-comments`) toggles the pane, and its menu
  (`pptx-review-show-menu`) toggles Show Markup (`pptx-review-show-markup`,
  the markers). Thumbnails of slides with comments show
  `pptx-thumbnail-comments`. Comments are saved as PowerPoint for Microsoft
  365 writes them (threaded comments with `ppt/authors.xml`); comments in the
  pre-2021 format show too and can be edited or deleted, but not replied to
  or resolved. They are signed with the host's user name (the fixture's
  `?author=`, default "Alex Morgan"). Engine and AI: `addComment`,
  `replyComment`, `editComment`, `resolveComment`, `deleteComment`, and
  `deleteAllComments`; slide outlines list `comments`.
- **Spelling**: misspelled words on the slide being edited get red wavy
  underlines (`pptx-spell-squiggles`, a `pptx-squiggle` per line piece with
  `data-word`), checked against an en-US dictionary that loads a moment
  after the editor opens. Words with digits, ALL-CAPS words, and web and
  e-mail addresses are skipped; the word being typed waits until the caret
  leaves it. Right-clicking an underlined word puts the caret in it, and the
  menu starts with suggestions (`pptx-spelling-menu-suggestion`), Ignore All
  (`pptx-spelling-menu-ignore-all`), and Add to Dictionary
  (`pptx-spelling-menu-add`); added and ignored words are remembered in this
  browser. Review ▸ Spelling (`pptx-review-spelling`, or F7) opens
  `pptx-spelling-pane`, which walks the deck from the current slide, selecting
  each word on its slide: the word (`pptx-spelling-word`), Ignore Once,
  Ignore All, and Add (`pptx-spelling-ignore-once|ignore-all|add`),
  suggestions (`pptx-spelling-suggestion`, `aria-selected`), and Change and
  Change All (`pptx-spelling-change|change-all`), ending with
  `pptx-spelling-complete` ("Spell check complete. You're good to go!", OK
  `pptx-spelling-ok`).
- **Links** (Insert ▸ Link, Cmd/Ctrl+K, or **Link…** in the right-click menu)
  open `pptx-link-dialog`. While editing text it links the selection, or the
  whole link around the caret; at a bare caret it inserts the "Text to
  display" (`pptx-link-text`) as linked text. With shapes selected (not their
  text) it links the shapes themselves. Link to: Web Page or File
  (`pptx-link-kind-web`, address `pptx-link-address`; `macro.com` becomes
  `https://macro.com`), Place in This Document (`pptx-link-kind-place`:
  `pptx-link-place-nextslide` and the other jumps, or
  `pptx-link-place-slide-<n>`, with a preview `pptx-link-preview`), or E-mail
  Address (`pptx-link-kind-email`, `pptx-link-email`, `pptx-link-subject`).
  ScreenTip is `pptx-link-tip`; OK is `pptx-link-ok`; editing an existing link
  adds **Remove Link** (`pptx-link-remove`). Right-clicking linked text or a
  linked shape offers Edit link…, Open link (a web page in a new tab, or the
  linked slide), Copy link, and Remove link; Cmd/Ctrl+click follows a link
  while editing text. Engine and AI spelling: `formatText` `link` /
  `linkTip` and `setShapeLink`, with `#slide=<id>` or `#nextslide`-style jumps
  for places in the deck.
- **Slide show** (`pptx-slideshow`, F5 from the start, Shift+F5 from the
  current slide): full screen with the slides' transitions; →/Space/click
  play the next animation step, then advance (`pptx-slideshow-canvas` carries
  `data-slide-index` and `data-step`; animated shapes are `[data-piece]`
  layers), ← goes back, a number then Enter jumps, B/W blank the screen, S
  shows notes, Esc ends. Over a link the pointer becomes a hand and its
  ScreenTip shows (`pptx-slideshow-link-tip`); clicking follows the link
  instead of advancing. **Morph** (`pptx-transition-morph`) plays as a scene
  (`pptx-morph`, `data-pairs` = objects matched): objects on both slides
  glide, resize, and turn to their new place (matched by a `!!` name, then
  the same name and kind, as a duplicated slide keeps them, then the same
  text, then the same placeholder); text-only boxes move without stretching;
  the rest fade out or in. With Effect options ▸ Words or Characters,
  text-only boxes morph word by word or letter by letter: each one travels
  to where the same word sits on the next slide (`data-units` = words
  matched; sprites carry `data-shape`, `data-unit`, and `data-morph` =
  `from`/`to`). A click finishes it.
- **Presenter View** (Slide Show ▸ Presenter view `pptx-present-presenter`,
  Alt+F5): opens the audience show in a pop-up window (`pptx-audience-canvas`;
  double-click it for full screen) and turns the tab into the speaker
  console (`pptx-presenter`): current slide (`pptx-presenter-current`), next
  slide (`pptx-presenter-next`), notes (`pptx-presenter-notes`), timer
  (`pptx-presenter-timer`), counter (`pptx-presenter-counter`), All slides
  (`pptx-presenter-grid-toggle`, or G), and End slide show
  (`pptx-presenter-end`). Show keys work in either window. A blocked pop-up
  shows **Open audience window** (`pptx-presenter-audience-closed`). A video
  or audio clip on the current slide has a Play button on the console
  (`pptx-presenter-media-play`), and clicking the clip in the audience window
  also plays or pauses it instead of advancing: it plays on the audience
  screen (`pptx-audience-media`) while the console mirrors a video silently
  (`pptx-presenter-media-video`) with controls (`pptx-presenter-media-controls`:
  `pptx-presenter-media-toggle`, `pptx-presenter-media-stop`, seek
  `pptx-presenter-media-seek`, time `pptx-presenter-media-time`). With the
  audience window closed, the console's copy plays the sound.
- **Keyboard** on the stage: Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z (or Ctrl+Y),
  Cmd/Ctrl+S saves now, Cmd/Ctrl+A selects all, Shift+Cmd/Ctrl+C and V copy
  and paste formatting, Cmd/Ctrl+C/X/V copy, cut, and
  paste shapes (and slides from the rail; also across decks), Cmd/Ctrl+D
  duplicates, Cmd/Ctrl+G and Shift+Cmd/Ctrl+G group and ungroup, Cmd/Ctrl+] and
  [ (with Shift: to front/back) reorder, Cmd/Ctrl+M adds a slide, arrows nudge
  (Shift for 10 pt), Delete removes, Tab walks through shapes, PageUp/PageDown
  change slides, F7 checks spelling, Ctrl+Alt+M adds a comment,
  Cmd/Ctrl+±/0 and Cmd/Ctrl+wheel zoom. The status bar shows the
  slide number and a zoom slider (`pptx-zoom` fits the slide).
- **Print** (`pptx-print-open` beside Download, or Cmd/Ctrl+P) opens
  `pptx-print`: layout (`pptx-print-layout-slides|notes|handouts3|handouts6`),
  all/current/range slides (`pptx-print-range`, e.g. `1-3, 5`), hidden slides,
  frames, and paper. **Print** (`pptx-print-go`) uses the browser's print
  dialog; **Save as PDF** (`pptx-print-pdf`) downloads a PDF directly.
  `pptx-print-summary` shows the page count or progress.
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

**Ask Macro**, in the header beside **Share**, opens a new agent session in a
split with the deck mentioned in the composer (nothing sends automatically).
Macro AI reads decks with `ReadPresentation` (slides, layouts, theme colors,
sections, transitions, header and footer, and every shape with its id, kind,
placeholder role, position in points, text, table cells with merges and style,
chart type and data, picture crop and adjustments, and shadow, glow, soft edge,
and reflection effects; an equation stands in text as U+FFFC, the engine
outline lists each paragraph's `equations` (index, LaTeX-style text, display
flag), and the `insertEquation` and `setEquation` operations write them;
`ReadContent` returns the same description) and changes them with
`EditPresentation`, an atomic batch of the editor's own operations saved as a
new version (`saveAs` creates an edited copy instead). When an `EditPresentation` result arrives in chat, an open
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

## Images (Photoshop)

Uploaded `.psd` and `.psb` files open in the `psd` block
(`/app/psd/<documentId>`), and **Photoshop file** in the create menu (key
**H**, also in project create menus) makes a new 1920 × 1080 document with a
white Background. Both are behind the `enable-psd-editor` PostHog flag (on
by default in development builds; `ENABLE_PSD_EDITOR` overrides it); with
the flag off the block offers the file for download. The file is read,
composited, and edited by the Rust `psd_engine` compiled to WebAssembly, in
one worker. The canvas draws 512 px tiles from a pyramid of scales (the
nearest one shows while zooming, then it sharpens) and redraws only what an
edit changed.

People with edit access get the editor; others get the same view read-only
(no painting or editing tools, no editing shortcuts). Documents the editor
cannot edit as they are (CMYK, Lab, Indexed, Bitmap, Duotone, Multichannel,
32-bit) open read-only with a bar (`psd-notice`, reason in
`psd-notice-readonly`) whose **Convert to RGB** (`psd-notice-convert`, also
Image > Mode > RGB Color) converts them to 8-bit RGB; the same bar lists
parts of the file that could not be read (`psd-notice-warnings`), and
`psd-notice-dismiss` hides it. Edits save automatically 1.5 s after the last
change and when the tab is hidden, as a new document version through
`PUT /documents/{id}/simple_save`; `psd-save-state` (`data-state` is `saved`,
`unsaved`, `saving`, or `error`) shows where that stands.

Everyone with the document open edits it live, as in the Figma editor:
changes go through the sync service as Loro maps of each changed layer's
state and pixel tiles (see `psd_engine::collab`); the stored file stays the
base everyone opens, and the first editor seeds the shared copy. Undo takes
back only your own steps. Of the people editing, one (the lowest peer id)
stores the merged file. Presence: other people's pointers with name tags
(`psd-peer-cursor`, `data-peer="<name>"`), their selections' outlines in
their colors, and their avatars at the top right of the canvas
(`psd-collaborators`, one `psd-collaborator` per person); clicking an avatar
follows their view (`psd-following`) until **Stop**. Without the sync
service the document opens read-only, and for editors a bar
(`psd-session-notice`) explains why, with **Retry** (`psd-session-action`);
a file stored outside the session (an upload, an AI edit) turns open copies
read-only with **Reload**.

The editor (`psd-editor`) is laid out as Photoshop is:

- **Menu bar** (`psd-menu-bar`): File, Edit, Image, Layer, Select, Filter,
  and View (`psd-menu-file` … `psd-menu-view`); items carry ids such as
  `psd-menu-new-layer`, `psd-menu-image-size`, `psd-menu-filter-gaussianBlur`,
  `psd-menu-adjust-levels`, `psd-menu-flatten`, `psd-menu-export-png`, and
  `psd-menu-download`. Filters (Gaussian Blur, Unsharp Mask, Add Noise,
  Mosaic, Motion Blur) and Image > Adjustments open a dialog
  (`psd-filter-dialog`, `psd-adjust-dialog`) at the top right that previews
  on the canvas; OK keeps it as one step, Cancel or Escape drops it. Image
  Size (`psd-image-size`), Canvas Size (`psd-canvas-size`), Resolution,
  Feather (⇧F6), Expand, and Contract open small dialogs (`*-ok`,
  `*-cancel`).
- **Options bar** (`psd-options-bar`, tool name in `psd-options-tool`): the
  tool's settings (brush size, hardness, opacity, flow, spacing, pressure;
  marquee feather; wand and bucket tolerance; gradient style and method;
  type size), and **Fit Screen** / **100%** (`psd-zoom-fit`,
  `psd-zoom-100`). During Free Transform (⌘/Ctrl+T) and Crop it shows the
  box's size with commit and cancel (`psd-options-commit`,
  `psd-options-cancel`; Enter and Escape do the same).
- **Toolbar** (`psd-toolbar`, `psd-tool-<tool>` with `aria-pressed`;
  clicking the tool in use again, or right-clicking, lists its group's
  other tools, `psd-tool-option-<tool>`):
  Move **V** (auto-selects the layer under the pointer; arrows nudge, ⇧ by
  10), Marquee **M** (rectangle, ellipse; ⇧ adds, ⌥ subtracts, ⇧⌥
  intersects), Lasso **L** (freehand, polygonal), Magic Wand **W**, Crop
  **C**, Eyedropper **I**, Brush and Pencil **B** (`[` and `]` size, digits
  opacity), Eraser **E**, Gradient and Paint Bucket **G**, Type **T**,
  Rectangle and Ellipse **U** (shape layers in the foreground color), Hand
  **H** (or hold Space), and Zoom **Z** (⌥ zooms out). ⇧ with a tool's key
  cycles its group. Below, the foreground and background swatches
  (`psd-foreground-color`, `psd-background-color`; clicking one opens the
  Color tab), **X** swaps them (`psd-swap-colors`) and **D** resets them
  (`psd-default-colors`).
- **Canvas** (`psd-canvas`, with the zoom and size in `psd-status`, zoom in
  `psd-zoom`): wheel scrolls; pinch, ⌥-wheel, or ⌘/Ctrl-wheel zooms; ⌘0 fits,
  ⌘1 is 100%, ⌘+ and ⌘− step. Selections show marching ants; guides from
  the file are drawn. Pasting an image (⌘V) or dropping image files places
  them as new layers; ⌘C copies the selected pixels as PNG, ⇧⌘C copies
  merged.
- **Panels** (`psd-panels`): tabs **Properties** and **Color**
  (`psd-tab-properties`, `psd-tab-color`) over the Layers panel.
  Properties (`psd-properties-panel`) shows the active layer's kind and
  bounds (`psd-layer-bounds`) and its settings: text (font, style, size,
  leading, tracking, color, alignment `psd-text-align-<left|center|right>`,
  faux styles, and **Edit text…** `psd-text-edit`), fill and shape layers
  (solid color or gradient with its style and method, the shape's stroke,
  `psd-stroke-add`), adjustment layers, masks (density, feather, enabled),
  and the layer style's effects on or off. Color (`psd-color-panel`) edits
  the foreground or background (`psd-color-target-foreground`,
  `psd-color-target-background`) with a saturation and brightness area,
  hue strip, hex, RGB, and HSB (`psd-color-hex`, `psd-color-r`, …).
- **Layers panel** (`psd-layers-panel`): the active layer's blend mode
  (`psd-blend-mode`), Opacity and Fill (`psd-layer-opacity`,
  `psd-layer-fill`; drag their labels to scrub), and locks
  (`psd-lock-transparency`, `psd-lock-pixels`, `psd-lock-position`,
  `psd-lock-all`); then the layers top first (`psd-layer-row`,
  `data-layer-id`, `data-layer-name`), each with visibility
  (`psd-layer-visibility`), group disclosure (`psd-layer-disclosure`), the
  thumbnail, the mask (`psd-layer-mask`; clicking it makes painting edit the
  mask), and the layer style marker (`psd-layer-effects`, click toggles).
  Click chooses, ⌘/Ctrl-click adds, ⇧-click picks a range, double-click
  renames (`psd-layer-rename`), dragging reorders or moves into groups, and
  right-click (or `psd-layer-menu`) opens the layer's menu (duplicate,
  delete, group, clipping mask, masks, rasterize, merge down, export). The
  bottom buttons add a fill or adjustment layer (`psd-new-adjustment`), a
  mask (`psd-add-mask`), a group (`psd-new-group`), and a layer
  (`psd-new-layer`, ⇧⌘N), and delete (`psd-delete-layer`).

Typing: with Type, click the canvas for new text, or a text layer to edit
it. A box under the text (`psd-text-editing`, field `psd-text-input`)
takes the typing; each keystroke lays the layer out again on the canvas.
New text becomes a layer at the first character, named after its first
line (the name follows the text until someone renames the layer); Escape
or ⌘/Ctrl+Enter finishes, and the whole typing is one undo step. Text left
empty is removed. Other shortcuts: ⌘Z / ⇧⌘Z (Ctrl+Y), ⌘A, ⌘D, ⇧⌘I, ⌘J,
⇧⌘J, ⌘E, ⌘G, ⇧⌘G, ⌥⌘G (clipping mask), ⌥⌫ and ⌘⌫ fill with the
foreground and background, ⌫ clears the selection or deletes the layer,
and ⌘/ (or the keyboard button) lists them all (`psd-shortcuts`).

To exercise the editor without a backend, run the browser fixture from
`apps/web` (build the engine first with `just ensure-psd-engine-wasm`):

```sh
bunx vite --config src/features/block-psd/browser-test/vite.config.ts
# http://127.0.0.1:3020/?new
```

`?new` opens a new document (`&size=800x600` for another size), `?file=`
a file from the directory `PSD_CORPUS_DIR` names, `?readonly` a viewer,
and `?reload` reopens each save to check it round-trips. `?collab`
(`&people=alice,bob`) puts several people side by side on one document
through an in-page sync server; `window.psdFixture` exposes `engine()`,
`saves()`, `downloads()`, `errors()`, `notices()`, and `collab`. Its
Playwright suites run with
`bunx playwright test --config src/features/block-psd/browser-test/playwright.config.ts`
(`PSD_BROWSER_PORT` picks another port than 3020; set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when the bundled browser is not
installed).

## Designs (Figma)

Uploaded `.fig` files open in the `fig` block (`/app/fig/<documentId>`), and
**Design** in the create menu (key **I**, also in project create menus) makes
a new, empty one. Both are behind the `enable-fig-viewer` PostHog flag (on by
default in development builds; `ENABLE_FIG_VIEWER` overrides it); with the
flag off the block offers the file for download. The file is decoded,
rendered, and edited by the Rust `fig_engine` compiled to WebAssembly, in a
primary worker plus up to three tile-raster helpers. The canvas composites
512 px tiles; while zooming it shows the nearest cached scale, then sharpens.

People with edit access get an editor; others get the same view read-only
(no shape tools, no editing shortcuts). Edits save automatically 1.5 s after
the last change, when the tab is hidden, and on close, as a new document
version through `PUT /documents/{id}/simple_save`. Saving rewrites only the
edited parts of the original file, so everything else in it survives.

Everyone with the design open edits it live, as in Figma. Changes go through
the sync service as Loro maps holding the state of each layer edited since
sharing began (see `fig_engine::collab`); the stored `.fig` stays the base
everyone opens, and the first person who can edit seeds the shared copy.
Others' edits appear within a fraction of a second; edits to different
layers merge, and edits to the same layer resolve to the latest. Undo takes
back only your own changes. Of the people editing, one (the lowest peer id)
stores the merged file; the others' toolbars read saved while the sync
service holds their changes. Presence: other people's pointers with name
tags (`fig-peer-cursor`, `data-peer="<name>"`, "(typing)" while they type),
outlines of what they selected in their colors, and their avatars at the top
right of the canvas (`fig-collaborators`, one `fig-collaborator` button per
person, `data-peer="<name>"`). Clicking an avatar follows that person: their
page and view, inside a colored frame (`fig-following`) until you click,
scroll, or press **Stop**. A viewer who opens a design nobody has shared yet,
or anyone when the sync service is unreachable, gets the stored file
read-only; for editors a bar above the design (`fig-session-notice`) says
why, with **Retry** (`fig-session-action`). Editing offline is not offered:
without the sync service's changes, storing would overwrite other people's.
The shared changes apply only to files the session produced (each stored
file is listed in the shared metadata before it is stored, and only once
the sync service has that record; offline, storing waits). Whoever opens a
file stored outside the session (a new upload, an AI edit, a restored
version from before such a replacement) starts the shared design over on
it, dropping the changes made on the file it replaced; people still in the
design get a **Reload** bar and their copy turns read-only.

Macro AI reads designs with `ReadDesign` (`ReadContent` returns the same
description; attaching a design points the agent at it): the pages, numbered
from 1, each page's top-level frames and sections with ids, sizes and
positions, the text in each frame in reading order (instances' text
included), the components the frame's instances use, and the file's
components with their properties and variants, styles, and variable
collections (`fig_engine::describe`). Hidden layers are left out; `pages`
reads only some pages. The tool reads the stored file, so edits still held
by a live session appear once one of the editors has saved. Tools cannot
edit designs. Search indexes each page's name, frame names, and text as one
chunk, so content search finds a design by the words on its canvas.

Layout and test hooks:

- **Left panel tabs**: `fig-tab-layers` and `fig-tab-assets`. Assets
  (`fig-assets`) lists the file's components (`fig-asset`, searchable with
  `fig-assets-search`); editors click one to place an instance in the middle
  of the view, and the arrow beside it (or a click, read-only) goes to the
  main component. ⌥⌘K makes the selection a component (a frame becomes one;
  other layers are wrapped), duplicating or pasting a main component places
  an instance, and ⌥⌘B detaches an instance into ordinary layers (nested
  instances too). Components of one set are listed under the set's name;
  right-clicking selected components offers `fig-menu-combine-as-variants`.
- **Team libraries** (Assets tab): the book button (`fig-assets-libraries`)
  opens the Libraries dialog (`fig-libraries-dialog`). "This file" shows the
  publishing state (`fig-library-status`) and **Publish…**
  (`fig-library-publish`), which opens `fig-publish-dialog`: the changes
  since the last publish (`fig-publish-change`: New, Changed, or Removed
  components, component sets, styles, and variables, with descriptions), a
  note (`fig-publish-note`), and `fig-publish-confirm`. Names starting with
  `_` or `.` stay private. Below, the other `.fig` designs the person can
  open (`fig-library-row`, `data-library` is the document id, searchable
  with `fig-libraries-search`) each have a switch that turns the library on
  for this file (stored in the file, so collaborators share it); a row
  notes its published asset count, "Not published", or "Unavailable". Each
  enabled library gets a section in Assets (`fig-library-assets`): its
  components as thumbnails (`fig-library-asset`, `data-key`; click to place
  an instance in the middle of the view, or drag one onto the canvas),
  grouped by component set or name folder, then its color, text, and effect
  styles and its variables (click applies to the selection: a style, or a
  color variable bound to the first fill). Inserting copies the component
  with what it uses (nested components, styles, variables, images) onto the
  internal canvas as Figma does, so it is not listed with the file's own
  components. When a library publishes newer versions of what the file
  uses, **Library updates available** (`fig-library-updates`, bottom left;
  `fig-assets-updates` in the Assets header) opens the review
  (`fig-library-review`): each changed asset (`fig-library-update`) with
  this file's copy beside the published version, the library's note,
  `fig-library-update-one`, and `fig-library-update-all`. Updating keeps
  instances' overrides; it is one undo step. Libraries are read when the
  design opens and again when the Libraries dialog opens.
- **Layers panel** (`fig-layers-panel`, toggled with ⌥1): layer search
  (`fig-layer-search`, ⌘/Ctrl+F; results are `fig-search-hit`), the pages list
  (`fig-page` buttons; pages named only with dashes are dividers; editors
  get `fig-page-add`, double-click to rename in `fig-page-rename`, and a hover
  `fig-page-delete`), and the layer tree (`fig-layer-row`, `data-layer-id` is
  the Figma node id such as `12:34`, or `I12:34;56:78` inside instances).
  Rows list top-most first, as Figma does; instance and component rows are
  purple. A click selects a row, Shift-click the rows between it and the
  selection, ⌘/Ctrl-click toggles a row. After a click, editors' arrow keys
  nudge the selection as in Figma (Tab, Enter, and ⇧Enter move through the
  layers); read-only, they move through the tree (`fig-layer-tree`; Left
  and Right collapse and expand). ⌥L collapses everything, and the list scrolls to the selection. Editors
  can double-click a row (or ⌘R) to rename it (`fig-layer-rename`), toggle
  visibility and lock on hover (`fig-layer-visibility`), and drag rows to
  reorder or move them into frames and groups. Right-click a row for the
  layer menu (below).
- **Canvas** (`fig-canvas`): click selects with Figma's rules (inside a
  top-level frame the click selects the frame's child; sections are
  transparent; ⌘/Ctrl-click selects the deepest layer; double-click goes one
  level deeper; Shift-click adds). Dragging empty canvas draws a selection
  marquee. Hover outlines what a click would select; holding ⌥ measures from
  the selection to the hovered layer. Scroll pans, ⌘/Ctrl+scroll or pinch
  zooms, Space-drag or middle-drag pans. When editing: drag a layer to move it
  (⌥ drags a copy, ⇧ constrains, edges and centers snap to siblings and the
  parent frame with red guides; in an auto layout frame the dragged layer
  takes the slot it is dropped over), drag the selection's corners or edges to
  resize (⇧ keeps proportions; several selected layers scale together), drag
  just beyond a corner of one layer to rotate it (⇧ snaps to 15°), draw with the frame, rectangle, ellipse, and
  text tools (a click places a default size; new layers go into the frame
  under the pointer), double-click or Enter on a text layer to type into it
  (see **Text editing** below), and drop or
  paste image files to place image-filled layers. The pen (P) draws a path:
  click places a corner, drag pulls out a curve's handles, clicking the first
  point closes the path, and Enter or Escape ends an open one; the result is
  a Vector layer with a 1 px black stroke. The pencil (⇧P) draws freehand:
  a drag becomes a smoothed open Vector layer, and the pencil stays chosen
  until Escape or another tool. Double-clicking a selected shape
  or vector (or Enter) edits its points: drag points and handles (⌥ breaks
  a handle's mirroring), Delete removes the selected point, and Escape or a
  click elsewhere ends editing; rectangles, ellipses, and the like become
  vectors when their points change. ⌘C also puts the selection on the system
  clipboard as Figma does (HTML whose comments carry `(figmeta)` and the
  layers as a `(figma)` `.fig` document, plus Macro's `(macroimages)`), so
  layers paste into other designs and tabs, and layers copied in Figma paste
  here (their images arrive as gray placeholders, since Figma's clipboard
  does not carry them). Pasted instances whose component is not in the file
  are detached. In a live design, the others receive pasted layers as the
  properties Macro models, so fields it does not model (prototype links,
  plugin data, and the like) survive only while the person who pasted is
  the one storing the file. Paste places layers by Figma's rules: into a selected frame
  (where they were if that is inside it, else centered), beside a selected
  layer, or on the page where they were when that is in view and in the
  middle of the view otherwise. Layers inside instances
  cannot be moved, resized, or deleted, but their name, fills, strokes,
  opacity, visibility, and text (typing included) are overridden on the
  instance, as in Figma; text bound to a component text property sets the
  property.
- **Main menu, layout grids, and guides**: the menu at the top of the
  layers panel (`fig-main-menu`) has `fig-menu-export-frames-pdf` ("Export frames
  to PDF": the page's top-level frames as a multi-page vector PDF),
  `fig-menu-export-selection`, and the Layout grids and Rulers toggles (also
  in the zoom menu, `fig-layout-grids-toggle`). Frames' layout grids draw
  over the canvas (never in exports) until toggled off. With rulers shown
  (⇧R), editors drag from the top ruler for a horizontal guide or the left
  one for a vertical guide; a guide dropped on a top-level frame belongs to
  it, otherwise to the page. Dragging a guide moves it, dropping it on its
  ruler deletes it, and guides hide with the rulers. Moving and resizing
  layers snap to guides and to the edges of visible columns and rows of the
  frames they are over, as well as to other layers.
- **Context menu** (`fig-context-menu`): right-clicking a layer on the
  canvas selects it (a selection it belongs to is kept) and lists Figma's
  layer actions with their shortcuts, as `fig-menu-<action>` items: `copy`,
  `paste-here`, `paste-replace`, `copy-png`, `bring-to-front`,
  `bring-forward`, `send-backward`, `send-to-back`, `group`, `ungroup`,
  `frame-selection`, `add-auto-layout` / `remove-auto-layout`,
  `create-component`, `detach-instance`, `toggle-visible`, `toggle-locked`,
  `flip-horizontal` (⇧H), `flip-vertical` (⇧V), `rename`, and `delete`
  (read-only viewers get copy, copy as PNG, and zoom to selection). On
  empty canvas: `paste-here` (pastes copied layers with their top left at
  the click, into the frame there), `toggle-ui`, `toggle-rulers`, `toggle-pixel-grid`,
  `toggle-outline`, the zoom actions, and `select-all`. `paste-replace`
  puts the pasted layers in place of the selection, centered on it, in one
  undo step. Both paste what is on the system clipboard (layers from any
  file or tab, as ⌘V does) when the browser lets the page read it, and
  otherwise the layers copied in this design.
- **Design panel** (`fig-design-panel`, toggled with ⌥8): alignment buttons
  (`fig-align-<left|center|right|top|middle|bottom>`), name (`fig-name`),
  position, size, rotation, radius, opacity (`fig-field-<x|y|w|h|rotation|
  radius|opacity|font-size|stroke-weight>`; type a value or arithmetic, or
  drag the label to scrub; a flip is kept apart from rotation: after ⇧H
  the angle and X/Y read as before, a vertical flip reads as 180°, and
  typing a rotation or position keeps the flip), fills and strokes
  (`fig-fills`, `fig-strokes`,
  rows `fig-fill-<n>` / `fig-stroke-<n>`, top paint first, with a hex
  input `fig-fill-<n>-hex`, opacity `-opacity`, `-visibility`, and
  `-remove`; "+" adds; drag a row's grip to reorder), stroke weight,
  position, and dashes (`fig-field-dash`: `4, 2`, or `None`), clip
  content (`fig-clip-content`), the Text section for text layers (`fig-type`:
  family `fig-font-family` (opens the font picker `fig-font-picker`: search
  `fig-font-search`, options `fig-font-option` with `data-family`, the
  file's fonts first, then Google Fonts, each previewed in its face; a
  missing font shows `fig-font-missing`), weight `fig-font-weight`,
  `fig-italic`, size,
  line height `fig-field-line-height` as `Auto`, a percentage, or pixels,
  letter spacing `fig-field-letter-spacing`, paragraph spacing, horizontal
  and vertical alignment, auto width / auto height / fixed size
  `fig-text-resize`, `fig-underline`, strikethrough, and case
  `fig-text-case`), auto layout (`fig-auto-layout-section`: "+" or ⇧A adds
  it, wrapping other layers in a new frame; "−" or ⌥⇧A removes it;
  direction `fig-layout-direction`, gap `fig-field-gap` as a number or
  `Auto`, padding `fig-field-padding-h|v`, and the alignment grid
  `fig-layout-align`), width and height sizing (`fig-sizing-w|h`: Fixed,
  Hug, Fill) and `fig-absolute` for layers in auto layout, constraints
  (`fig-constraint-h|v`; children follow them when their frame is resized,
  and groups scale theirs), effects (`fig-effects`: "+" adds a drop shadow;
  rows `fig-effect-<n>` pick the kind in `fig-effect-<n>-type` and take
  offset, blur `fig-effect-<n>-blur`, spread, and color), boolean
  operations (`fig-boolean-row`, shown for two or more layers or a boolean
  layer: `fig-boolean-<union|subtract|intersect|exclude>`, pressed for the
  boolean's current operation, which a click changes, and `fig-flatten`),
  a Layout grid section for frames (`fig-layout-grids`: "+" adds a 10 px
  grid; rows `fig-grid-<n>` with color `fig-grid-color-<n>`, kind
  `fig-grid-type-<n>` (`GRID`, `COLUMNS`, `ROWS`), `fig-grid-visible-<n>`,
  `fig-grid-remove-<n>`, and `fig-grid-settings-<n>` opening count
  `fig-grid-count-<n>` (a number or `Auto`), type `fig-grid-align-<n>`
  (Stretch/Left/Center/Right), width or height `fig-grid-size-<n>`, margin
  or offset `fig-grid-offset-<n>`, and `fig-grid-gutter-<n>`), and the
  Export section (`fig-export`): "+" adds a preset (1x PNG, then 2x, 3x…;
  rows `fig-export-row-<n>` with size `fig-export-size-<n>` typed as `2x`,
  `0.5x`, `512w`, or `300h`, `fig-export-suffix-<n>`, format
  `fig-export-format-<n>` (`PNG`, `JPEG`, `SVG`, `PDF`), and for SVG and
  JPG `fig-export-options-<n>`: `fig-export-outline-text-<n>`,
  `fig-export-include-id-<n>`, or `fig-export-quality-<n>`; "−" is
  `fig-export-remove-<n>`). Presets are saved in the file (read-only viewers
  keep theirs for the session). `fig-export-button` ("Export <name>")
  downloads one file named as Figma names it (`Icon@2x.png`) or a ZIP of
  several, `fig-export-preview-toggle` shows a preview
  (`fig-export-preview`), and `fig-copy-svg` is Copy as SVG; ⌘/Ctrl+⇧E
  exports the selection with its presets (1x PNG without). Read-only
  viewers see the same values as text. The Code tab is Dev Mode's inspect
  panel (`fig-dev-inspect`): size and position (`fig-dev-width`,
  `fig-dev-height`), auto layout padding and gap (`fig-dev-padding`),
  typography with its text style (`fig-dev-text-style`, `fig-dev-font`),
  colors with the style or variable they come from (`fig-dev-colors`,
  rows `fig-dev-color`), effects, code with a language switch
  (`fig-code-lang-css|tailwind|swiftui|compose`; the code is `fig-css` or
  `fig-code-<language>`, copied with `fig-code-copy`), and the layer's and
  its layers' export presets as downloads (`fig-dev-asset`). While the Code
  tab shows, hovering a layer measures from the selection without ⌥, and a
  selected auto layout frame's padding and gaps are shaded with their
  sizes. With nothing selected
  it shows the page name and canvas color (`fig-page-color` opens the
  picker), then the file's local styles (`fig-local-styles`: color, text,
  effect, and grid styles by folder; a `fig-local-style` row, with
  `data-style-name`, opens to rename it in `fig-local-style-name`, change
  a color style's color (`fig-local-style-color`) or a text style's size
  (`fig-local-style-size`), which every layer using it follows, or
  `fig-local-style-delete`). With several layers selected (`fig-mixed`) it shows what they
  share; differing values read "Mixed", typing sets all of them, and "+"
  replaces mixed fills or strokes with one.
- **Components and styles in the design panel**: for an instance,
  `fig-instance-section` names its main component (`fig-main-component`;
  `fig-go-to-main` goes to it, `fig-swap-instance` picks another component
  in `fig-component-picker` with `fig-component-search` and
  `fig-component-choice` items, preferred ones first, and
  `fig-reset-instance` is "Reset all changes") and shows its variant
  properties as menus (`fig-variant-<Name>`; switching keeps the overrides
  that still apply), boolean properties as checkboxes, text properties as
  fields, and instance swap properties as component pickers
  (`fig-prop-<Name>`, spaces as dashes; a changed one gets
  `fig-prop-reset-<Name>`), then the same for nested instances whose
  properties are exposed. A main component, component set, or variant gets
  `fig-component-section`: "+" opens "Create component property"
  (`fig-new-property-kind`: Variant, Boolean, Text, or Instance swap;
  `fig-new-property-name`; `fig-new-property-create`; a variant property on
  a lone component makes it a component set), a set's variant properties
  are renamed in `fig-variant-property-<Name>` and removed with
  `fig-variant-property-remove-<Name>`, a variant's values are typed in
  `fig-variant-value-<Name>`, `fig-add-variant` adds a variant (a lone
  component becomes a set of two), and each property
  (`fig-component-property`) has its name (`fig-property-name-<Name>`),
  default (`fig-property-default-<Name>`, which the bound layers show),
  and `fig-property-delete-<Name>`. A layer inside a main component gets
  `fig-bindings-section`: which property drives its visibility, text, or
  instance (`fig-bind-VISIBLE|TEXT|INSTANCE_SWAP`; the last item creates a
  property from the layer), and for nested instances `fig-expose-instance`.
  The Fill, Stroke, Text, and Effects sections show the shared style in use
  (`fig-style-FILL|STROKE|TEXT|EFFECT`, `fig-style-detach-<kind>` detaches
  it, keeping its values) and a style picker (`fig-style-picker-<kind>`:
  `fig-style-option` items by folder, and `fig-style-create-name` with
  `fig-style-create` to make a style from the layer and apply it). Fill
  and Stroke also show the color variable the first paint uses
  (`fig-variable-FILL|STROKE`, `fig-variable-detach-<kind>`) and a picker
  of the file's color variables (`fig-variable-picker-<kind>`,
  `fig-variable-option`). Frames get `fig-variable-modes`: per collection
  with several modes, `fig-variable-mode-<Collection>` picks one (or
  Auto, inherited), and bound colors inside follow. With nothing selected,
  `fig-variables` lists the collections and their variables
  (`fig-variable`, `data-variable-name`) with a value per mode.
- **Color and paint pickers**: a paint's swatch (`fig-fill-<n>-swatch`,
  `fig-stroke-<n>-swatch`, `fig-effect-<n>-swatch`) opens the picker
  beside the panel (`fig-paint-popover`): the kind (`fig-paint-type`:
  Solid, Linear, Radial, Angular, Diamond, or Image, which asks for a
  file), for gradients the stop bar (`fig-gradient-bar`; click it to add a
  stop, drag a `fig-gradient-stop`, Delete removes the selected one), and
  the color picker (`fig-color-picker`): the saturation and brightness
  square (`fig-color-area`), hue and opacity sliders (`fig-color-hue`,
  `fig-color-alpha`), the eyedropper where the browser has one
  (`fig-color-eyedropper`), the format (`fig-color-format`: Hex, RGB, HSL,
  HSB) with its fields `fig-color-field-<n>` and opacity
  `fig-color-alpha-field`, and "On this page" swatches
  (`fig-color-swatch`). Dragging previews live and is one undo step;
  Escape closes the picker.
- **Toolbar** (`fig-toolbar`): Move (V), Frame (F), Rectangle (R), Ellipse
  (O), Line (L), Arrow (⇧L; ⇧ while drawing snaps lines to 45°), Pen (P),
  Pencil (⇧P), Text (T), Hand (H) as `fig-tool-<name>`, the boolean menu
  (`fig-boolean-menu`: `fig-menu-boolean-<union|subtract|intersect|exclude>`
  and `fig-menu-flatten`), undo/redo (`fig-undo`,
  `fig-redo`), the save state (`fig-save-state`, `data-state` is `saved`,
  `unsaved`, `saving`, or `error`), the zoom menu (`fig-zoom-menu`), and the
  shortcuts dialog (`fig-shortcuts`, Ctrl+⇧+?). After the tools: Comment
  (`fig-tool-comment`, C; `fig-comments-unread` counts unread threads)
  where the design has comments, and Present (`fig-present-button`,
  ⌥⌘↵ / Ctrl+Alt+Enter).
- **Comments** (the comment tool, C): pins (`fig-comment-pin`,
  `data-thread`, `data-unread`) at a constant size over the canvas; a click
  places a comment on the top-level frame there (it moves with the frame)
  or on the canvas, composed in `fig-comment-input` (Enter posts, ⇧Enter a
  new line, `@` offers people: `fig-mention-menu`, `fig-mention-option`).
  A pin opens its thread (`fig-comment-popover`: comments
  `fig-comment-item`, mentions `fig-comment-mention`, `fig-comment-reply`
  with `fig-comment-reply-post`, `fig-comment-resolve` /
  `fig-comment-reopen`, and the author's `fig-comment-delete`). The right
  panel becomes the comments list (`fig-comments-panel`, filters
  `fig-comments-filter-<open|resolved|all>`, rows `fig-comment-row` with
  `data-unread`; a row opens the thread on its page). Escape closes the
  thread, then the tool. In the app, comments are document discussions
  with a `fig` thread anchor, on wherever the viewer is; the fixture keeps
  them in memory.
- **Present** (`fig-present`): the selection's top-level frame (or the
  first flow's start, or the first frame) scaled to fit
  (`fig-present-screen`, `data-frame`), with the prototype playing: clicks
  on hotspots navigate (with dissolve, slide, push, move in and out; Smart
  Animate dissolves), open overlays (`fig-present-overlay`; a click outside
  closes one that allows it), go back, close overlays, open links, and
  hover and after-delay interactions run; a click on nothing flashes the
  hotspots (`fig-present-hint`). → ↓ Space and ← ↑ ⇧Space step through the
  flow (its frames as it reaches them, or every frame in page order when the
  frame is in no flow), R restarts, Escape leaves. The bottom bar shows the
  flow (`fig-present-flow`), frame name (`fig-present-name`), position
  (`fig-present-index`, "2 / 3"), `fig-present-previous` /
  `fig-present-next`, Copy link to frame (`fig-present-copy-link`, a link
  with `?present=<frame id>` that opens presenting it), and
  `fig-present-exit`. Variant changes and Scroll to are not played.
- **Prototype tab** (`fig-panel-tab-prototype`, beside Design and Code;
  `fig-prototype-panel`): for a top-level frame, its flow starting point
  (`fig-flow-add`, name `fig-flow-name`, `fig-flow-remove`); for a layer,
  its interactions (`fig-proto-interaction`): editors add a click
  interaction (`fig-proto-add`), and set its action (`fig-proto-action`:
  Navigate to, Open overlay, Back), destination frame
  (`fig-proto-destination`), animation (`fig-proto-transition`), and
  duration in ms (`fig-proto-duration`), or remove it (`fig-proto-remove`);
  other triggers and actions read as text (`fig-proto-summary`). The page's
  flows (`fig-flow`) present from their start. While the tab is open the
  canvas draws connections (`fig-noodle`, `data-from`, `data-to`; the
  selection's when it has any) and flow tags (`fig-flow-badge`). The first
  connection on a page without flows starts "Flow 1" at its frame, as in
  Figma. Edits are undoable, shared live, and saved as Figma's
  `prototypeInteractions` and `prototypeStartingPoint`.
- **Text editing** (`fig-text-editing`): the text box `fig-text-box`, the
  caret `fig-text-caret`, and selection rectangles `fig-text-selection` are
  drawn from the engine's layout; typing goes to a hidden textarea
  (`fig-text-editor`, which holds the selection as `selectionStart` and
  `selectionEnd`). Click places the caret, drag or ⇧-click selects,
  double-click selects a word and triple-click a paragraph; ↑/↓ move by
  line, ⌘←/→ (Home/End) to the line's ends, ⌥←/→ by word, ⇧ extends;
  ⌘B/⌘I/⌘U bold, italicize, or underline the selected characters (at a
  caret, what is typed next); ⇧Enter is a line break within the paragraph.
  With characters selected the Type section and fills show and change only
  theirs, "Mixed" where they differ. ⌘Z undoes typing in bursts (a pause of
  a second starts a new step) and keeps editing. Escape or a press elsewhere
  on the canvas ends editing (the panels keep it); an emptied layer is
  removed.
- **Fonts**: text keeps Figma's layout until edited; edited text is laid out
  in its own fonts, loaded first: fonts on this computer once permitted,
  else Google Fonts (the files for the text's scripts, cached by the
  browser), else Inter. A **Missing fonts** notice (`fig-missing-fonts`,
  rows `fig-missing-font`) lists fonts neither has, with **Use fonts on
  this computer** (`fig-use-local-fonts`, Chromium's Local Font Access
  permission prompt).
- **Keyboard**, as in Figma: ⇧0 100%, ⇧1 fit, ⇧2 selection, ⌘/Ctrl +/−, N and
  ⇧N next/previous frame, PageDown/PageUp pages, Enter children, ⇧Enter and
  Esc parent, Tab/⇧Tab siblings, ⌘/Ctrl+A select all, ⇧R rulers, ⇧' pixel
  grid, ⌃G (Ctrl+⇧4 off macOS) layout grids, ⌘/Ctrl+Y outline view,
  ⌘/Ctrl+\\ or ⌘/Ctrl+. hide UI, ⌥1 / ⌥2 / ⌥8 layers, assets, and design
  panels, ⌘/Ctrl+⇧C copy as PNG, ⌘/Ctrl+⇧E export. ⌘/Ctrl+P (or ⌘/) opens
  the design palette (`fig-actions`, Figma's actions menu, never the
  browser's print): type in `fig-actions-input`, arrows and Enter run an
  action (`fig-action-<action>`), Escape closes it. ⌘K stays the app's
  command menu; opened from a design it offers the palette in a hint row
  (`command-menu-hint`, "Did you mean to open the design palette?"), which
  ⌘P or a click opens. Editing:
  ⌘Z/⇧⌘Z undo and redo (each brings back what was selected around the
  step), ⌘D duplicate, ⌘C/⌘X/⌘V, Delete, arrows nudge (⇧ by 10), ⌘G
  group, ⇧⌘G ungroup, ⌥⌘G frame selection (like ⇧A's wrapping frame, it
  does not clip its layers), ⌘] / ⌘[ forward/backward, ⌥⌘] / ⌥⌘[
  front/back, ⇧⌘H hide,
  ⇧⌘L lock, ⇧H / ⇧V flip, ⌘R rename, ⌥⇧U union, ⌥⇧S subtract (the top layers from the
  bottom one), ⌥⇧I intersect, ⌥⇧E (or ⌥⇧X) exclude, and ⌘E flatten
  (booleans and shapes into one vector layer). ⌥A / ⌥H / ⌥D align left,
  center, right and ⌥W / ⌥V / ⌥S top, middle, bottom; ⌃⌥H / ⌃⌥V (Ctrl+Alt
  off macOS) distribute three or more layers; digits set opacity (1 is 10%,
  0 is 100%, two quick digits such as 4 5 make 45%); ⇧X swaps fill and
  stroke; ⇧⌘K places images; ⇧⌘R pastes to replace. A boolean keeps its layers as children and
  recomputes its shape when they change, and takes the bottom layer's fills
  and strokes.
- **App hotkeys over a design**: while the design has focus its own keys
  come first, so R, T, O, H, C, \\, ⌘\\, ⇧H/⇧L, ⌘Z and the others act on
  the design rather than the app's rename, tag, leader keys, or new split.
  Keys the design does not use stay the app's (⌘K, ⌘S, ⌘;, G, /, E, M), and
  so do ⇧←/⇧→, ⇧H, ⇧⌘C, and Escape when there is no selection to act on
  (focus the next split, copy the link, leave a spotlighted split). A
  read-only design leaves the editing keys (R, T, O…) to the app.

The viewer has a browser fixture that needs no backend. From `apps/web`
(build the engine first with `just ensure-fig-engine-wasm`):

```sh
bunx vite --config src/features/block-fig/browser-test/vite.config.ts
# http://127.0.0.1:3019/?file=showcase.fig
```

It opens files from `crates/fig_engine/tests/fixtures` (the synthetic
`showcase.fig`, `design-system.fig` with components, a component set,
properties, and styles, and `prototype.fig`, a clickable prototype), or from any directory named by `FIG_CORPUS_DIR`; the header
also opens a local `.fig`. `?edit` makes the file editable and `?new` opens a
blank design (editable); saves stay in memory, and `?reload` reopens each one
to check it round-trips. `window.figFixture` exposes `engine()`, `saves()`,
`errors()`, `notices()`, `downloads()`, `fontRequests()`, and `comments`
(the in-memory comment store: `threads()`, `arrive()` for someone else's
comment, `notified()`), and `?present=<frame id>` opens presenting; its font
source serves the bundled Inter for every Google family and has "Nowhere
Grotesk" installed locally, so font tests need no network. `?collab` (with
`&people=alice,bob`, the default) shows several people editing one file side
by side (`fig-person-<Name>` holds each editor), each running the real
shared-design session over an in-page sync server;
`window.figFixture.collab.people()` gives each person's `engine()`,
`saves()`, `status()`, and `peers()`. `?libraries` keeps two designs in
memory, the library "Design system" (`design-system.fig`, or `&library=`)
and a blank "App", opened one at a time with `fig-fixture-open-<id>`
(`design-system`, `app`; `&open=app` starts there); saves replace the
stored design, and `window.figFixture.libraries` has `open(id)`,
`current()`, and `reads(id)`. The Playwright suite runs with
`bunx playwright test --config src/features/block-fig/browser-test/playwright.config.ts`
(set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` when the bundled browser is not
installed). The sections above were verified on this fixture; the `/app/fig`
route itself needs a backend with an uploaded `.fig`.

For import fidelity checks, save a local copy from Figma and open that same
file in the fixture. Check the page names before switching pages, then use
**Find layers** and **⇧2** to compare the same frame at a useful zoom in both
apps. Include nested component logos, colors inherited from the page's
variable mode, effects supplied by library styles, repeated pattern fills,
and text that extends beyond a group's stored bounds. Compare exports as
well as the canvas; an overview thumbnail can hide missing letters, wrong
colors, or absent glows. Wait for the tiles to sharpen after zooming. The
fixture preserves imported text outlines, but
its substitute fonts do not verify the appearance of newly edited text.

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
- Editors get a toolbar labelled `Document formatting`, docked full width
  under the header (like the spreadsheet toolbar): `Undo`, `Redo`, the
  `Paragraph style`, `Font` and `Font size` selects, `Bold`, `Italic`,
  `Underline`, `Strikethrough`, `Superscript`, `Subscript`, the `Text color`
  and `Highlight` menus (`[data-docx-menu="color"]`,
  `[data-docx-menu="highlight"]`), `Clear formatting`, `Bulleted list`,
  `Numbered list`, the alignment buttons, `Decrease indent`, `Increase
  indent`, the `Line spacing` menu, `Insert table` (inside a table also the
  `Table rows and columns` menu, `[data-docx-menu="table"]`, to insert or
  delete rows and columns or the table), the `Insert footnote or endnote`
  menu (`[data-docx-menu="notes"]`, in the body), `Track changes`, `Hide tracked
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
- To add a footnote or endnote at the caret, use the toolbar's asterisk
  menu (`Insert footnote or endnote` → `Footnote` / `Endnote`) or Word's
  shortcuts (Ctrl+Alt+F / Ctrl+Alt+D; Cmd+Option+F / Cmd+Option+E on a
  Mac). The number appears in the text and the caret moves into the new
  note at the foot of the page (endnotes go after the body).
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
- Comments written in Word (stored in the file) show in the same margin as
  read-only cards (`[data-docx-word-comment="<id>"]`): author, date, text and
  replies, marked `In the document` (and `Resolved` when done). Their text is
  highlighted too (`[data-docx-comment-highlight="word:<id>"]`). They stay in
  the file on download; reply with a Macro comment.
- Threads whose text was deleted are listed under `Comments on text that has
  changed`, above the `Discussion` composer.
- AI `CommentOnDocument` works on DOCX by quote. The editor pins each quote to
  the first matching text the next time someone opens the file.
- AI `EditWordDocument` can record its edits as tracked changes
  (`trackChanges`, or by default when the document tracks changes) and add
  Word comments (`addComment`), both attributed to the requesting user by
  name rather than to the agent. Its comments are written into the file, so
  they appear as `In the document` cards and travel with the download.
- `Download .docx` exports the current collaborative state with every edit,
  including headers, footers and tracked changes. Macro comment threads are
  not written into the file; Word comments (including the agent's
  `addComment` ones) are.
- The stored upload is not rewritten yet. Search, the PDF export and AI
  `ReadContent` still see the original file.
- **Ask Macro**, in the header beside **Share**, opens a new agent session in
  a split with the document mentioned in the composer (nothing sends
  automatically).
- AI `ReadWordDocument` and `EditWordDocument` read and edit the live copy, so
  open editors patch agent edits in as they land. `ReadWordDocument` lists
  every paragraph, table cell and content control with its id. `EditWordDocument`
  applies an atomic batch of `replaceText`, `setText`, `formatText`,
  `insertParagraph`, `setStyle` and `delete` operations to those ids. Both
  refuse a DOCX nobody has opened in the editor yet: it has no live copy.
  `EditDocument` still rejects DOCX.

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

## Large-document undo checks

In a disposable Markdown document, change several paragraphs in one edit, then
undo and redo. Verify the text, paragraph count, and a second peer agree after
each operation; wait for saving to finish and reload to check persistence.
