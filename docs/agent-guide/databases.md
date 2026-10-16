# Databases

Choose **Create → Database** to create a database and its first table with a Name
column. **C → L** opens a new database with the normal static split-header title;
opening or creating it does not start renaming or move focus into a cell.
Opening **Ctrl-K** refreshes database discovery so a database created by AI or
another client appears without reloading. **All** and **Documents** categories
match its name, including databases with no view history.

Creating from Home immediately shows the table selector with its **+** menu, **Database
actions**, and **AI** in the top bar; no reload is needed to use them.
`/database` immediately shows **Creating database…** at the insertion point while
the creation module loads. Moving the caret keeps that insertion anchored; removing
it before the module loads cancels creation.
A successful create opens its new editor while database discovery refreshes in
the background; a slow discovery refresh must not delay the new database card.
Databases open at
`/app/database/<uuid>`; from Drive (its list, favorites, or **New → Database**)
they open inline at `/app/drive/database/<uuid>` with Drive's sidebar in place.
A database contains tables; records belong to a table and
its properties describe each record. The database name in the split header is an
static label, matching other blocks. Choose **Rename** in Database actions to
edit it. Enter or leaving the input saves and closes it; Escape cancels. Saving
a title does not enter the grid, and a failed rename shows a toast. Viewers without edit access see the
split header's `viewer` badge instead.

Reopening a loaded table or view shows its cached rows while a background read
checks for changes. Wait for refreshing to finish before asserting server
reconciliation; visible rows alone do not mean the network read has completed.
Concurrent cache-only misses must not fail an outstanding network row read. A
successful background read clears an earlier refresh warning; a genuine failed
read keeps the warning and its Refresh action.

**AI** in the split header opens an agent chat about the database. Its composer
starts with a mention of the database; the schema and table guidance go to the
agent privately as session instructions, so the sent bubble shows only what you
typed. Plans that include the database model run the chat on it.

Database agents discover with `ListDatabases` and `DescribeDatabase`, then use
`QueryDatabase` for rows and schema commands (`CREATE DATABASE`, `CREATE TABLE`,
`ALTER`, and `DROP TABLE`). `DescribeDatabase` omits saved-view definitions and
conversion lists by default; request `includeEditingMetadata: true` when those
are needed. `SaveDatabaseView` / `DeleteDatabaseView` manage table and kanban
presentation; `SaveDatabaseQuery` saves a live answer. Document live-answer agents
remain read-only, including schema commands and database creation.

## Feature flag

Databases is behind the `enable-databases` PostHog flag. A deployed app reads it
at runtime, and a fresh `/app/database/<uuid>` link waits up to three seconds for
PostHog before deciding. `VITE_ENABLE_DATABASES=true|false` overrides it at build
time; `bun run dev` defaults it on, and a local stack's static build defers to
PostHog unless the variable was set when it was built. With the flag off:

- `/app/database/<uuid>` and a `~/database/<uuid>` split show the 404 view. The
  database block's code is never fetched and no database request is made.
- **Create → Database**, its **C → L** shortcut, the command palette entry and
  the slash menu's **Database** and **Query** actions are absent, and no starter database is
  created.
- The sidebar, mentions, search and Quick Access list no databases; Activity
  and the ReadActivity tool leave out database rows.
- A document's database answer shows its title (or "Database answer") as a
  plain label, keeps the node unchanged, and never loads the SQL engine.
- Database tool calls in a chat render as a muted "Database tool" line.
- The SQL engine's wasm and the database bundles are only fetched once a
  database surface mounts with the flag on.

`showDatabaseSql` (`VITE_SHOW_DATABASE_SQL`) is separate and only hides SQL.

The table selector matches the inset project/channel navigation. In narrow panes,
scroll its tabs horizontally with a trackpad, mouse wheel, or the arrow buttons.
The **+** menu stays visible, and focusing or selecting a table reveals its tab.

The grid’s sticky bottom summary shows the saved records in the current view.
Choose **+ Add calculation** in a column’s footer for filled/unique counts, or
sum, average, min, and max on numeric columns. Numeric columns default to Sum.
Calculation choices are local to the open table, not saved with the view.

## CRM pipelines

Clicking a company/contact cell opens its picker while preserving the current
label. Type to search for a replacement; Escape cancels and restores cell focus
without changing the record. The picker opens without an entrance animation.

Pipelines are created from the CRM sidebar's **New pipeline** action. Their
records are read and edited through the pipeline's access; they are not standalone
database app entities and do not appear in the Databases list. Anyone who can edit
a pipeline, including every member of a team pipeline, can **Share** it with people
and channels and change or remove their access. The message carries the pipeline and
grants the chosen level before it is sent. Recipients on the pipeline's team then see it in their
CRM sidebar. Viewers can only copy its link. Only the owner uses **Share → Team access**
to switch between **None** (private) and **Edit** (team). A pipeline's primary
company/contact reference is required. The same company or contact can appear
in multiple independent rows, including through the row menu's **Duplicate** action.
The reference column and table are protected against removal or type changes. See
[Customers (CRM)](crm.md#customers-crm--appcomponentcompanies) for the flow.

Teams migrated from the legacy CRM have a team-shared **Sales** pipeline with
their visible companies and copied Stage, Owner and Revenue values, including
closed and unstaged companies. Hidden companies are excluded. The migration is
a one-time copy: later edits to a company’s legacy properties do not synchronize
with its pipeline row. The pipeline can be renamed, customized or trashed normally.

Pipeline primary columns use the shared database column protections: their header
must disable deletion and type changes. Renaming and reordering remain allowed.
The primary column is non-nullable: inserting a row without its record, clearing
its cell, or choosing an empty list fails without saving any of the batch.
Company pipelines accept one company; contact pipelines accept one contact.
The referenced record can belong to another team if the editor can access it;
pipeline sharing does not grant access to the referenced record's details.

Pipelines use the shared database editor. Verify that column-menu sorting orders
all records, including records beyond the first page, and that opening a record
keeps it available when a view filter excludes it. Cell edits and **Add column**
use pipeline authorization. Viewer grants hide editing controls. The CRM editor
fixture (`features/crm/browser-test/editor.html`) covers the real pipeline API
adapter and shared provider against local test responses.
Pipelines poll every five seconds. A poll that returns unchanged data must not
remount company previews or request them again.

### Pipelines from AI chat

Chats and agent sessions manage pipelines with their own tools, not the database
tools: `ListPipelines`, `FindPipelineEntries`, `AddToPipeline`,
`UpdatePipelineEntries`, `RemoveFromPipeline`, `CreatePipeline`, and `EditPipeline`.
They address entries by the company or contact they track, fields by name, and
stages by label, so "move Acme to Negotiation in Sales" or "how many deals are in
Demo?" work without ids. Each tool row shows a kanban icon and expands to the
entries it read or changed; an update lists every field before and after.
To verify, ask a chat to move a company between stages and check that the pipeline
row (within the five-second poll) and the company page's **Pipelines** card both
show the new stage. The company's own Stage, Owner and Revenue properties in the
side panel are a separate field these tools do not change. A pipeline created or
renamed from chat appears in the CRM sidebar as soon as the tool finishes.

## Properties and records

An embedded records editor can allow cell edits while its host controls the
schema. In that case, column creation and schema actions are absent; record
editing still works. The standalone database app keeps its full column controls.

Use **Add column** immediately after the table’s headers. It creates an **Unnamed**
Text column (**Unnamed 2**, and so on if that name exists), selects its name in the
header, and lets you type immediately while creation saves in the background.
Renaming or editing the new column waits for creation to finish; a refused
creation removes the preview and shows an error. Enter saves the name and immediately
puts the typing cursor in that column's first cell, without waiting for creation
or renaming to finish. Escape keeps the default name.
There is no creation dialog. Double-click a header, press F2 while it is focused,
or choose **Rename column** from its arrow or right-click menu to rename it later.
Its type icon stays in place while editing. SQL refers to tables and columns by
their display names (double-quoted), so a rename changes the name a saved query
must use.

The current type has a checkmark in **Change type**; selecting it leaves the column unchanged. Types that cannot convert any existing values are omitted, while empty columns can still choose a new type.

The header arrow menu groups schema and view actions. **Change type** checks the
column's values against Text, Number, Select, Multi-select, Date, Checkbox, URL,
People, Documents, Tasks, and relations to tables in this database, showing
"Checking values…" meanwhile, then lists only the types the column can become (a
checkbox can only become text; only an empty column can become People or a
relation). A type some values would not survive shows how many, such
as "3 values aren't numbers · Converts into a new column"; it never changes the
column in place. Choosing it opens a confirmation listing a few of those values,
and **Convert into a new column** adds a column of that type right after this
one, named like "Amount (Number)", filled with the values that convert (one ops
batch), leaving this column as it is. Every other type converts immediately. A
type change never empties a value; only deleting a cell, row, column, table or
option does. Plain number strings can become numbers; padding, leading zeros and
ambiguous values count as values that don't fit. A date becomes its `YYYY-MM-DD`
text. Changing a placement never changes another table that uses the same property.
A relation can hold multiple records.

**Formula columns.** **Change type → Formula** opens the formula editor under the
header. On a new, never-filled column the formula column takes its place and name;
on any other column it is added right after it (named "Formula"). Type the formula
(`{Unit price} * Quantity`, `Due + 7`, `Due - Started`) or click the column and
`+ − × ÷ ( )` buttons below the input; only number, date and other formula columns
are offered. The line under the input says whether it gives a number or a date, or
why it does not parse (`The formula ends too soon.`, `A date can't be multiplied
by a number.`); **Save** stays disabled until it does, and Enter saves. Names with
spaces go in braces. Numbers added to a date count days; a date minus a date is
the days between them. An empty number counts as 0 unless every input is empty.
Formula columns show an ƒ icon, their cells are read-only, and their header menu
has **Edit formula** instead of **Change type**. Values follow edits to their inputs
at once, and sort and filter like numbers or dates. Deleting a column a formula uses
is refused ("Total's formula uses Quantity; change that formula first").
**Delete column** opens a confirmation;
it removes this table’s column and values while preserving other tables.
Drag a column header left or right to reorder it, or use **Move left / Move right**.
Holding or dragging a column menu item, including a type choice, does not move
the column; a drag must start on the header itself.
To add a column next to another, right-click its header and choose **Insert left** or
**Insert right**: a Text column appears on that side with its name selected for
editing, and its type is inferred from what you type.
An orange insertion line shows the exact boundary before or after the target
column. Release to place it there; Escape cancels. Original-position and
offscreen boundaries show no line and do not change the order.
The pointer can pass over the rows while reordering. Hold it at the grid's left
or right edge to scroll to other columns. Drops move immediately while saves are
queued, so another drag does not need to wait for the previous save.

The first nonempty entry in a new default Text column, including a new database's
or table's Name column, sets its type. A plain number
becomes Number; starting with `@` and choosing an item makes it the corresponding
reference type. Other entries keep Text, and identifiers with leading zeros stay
text. Choosing Text explicitly disables inference. Populated columns never infer a
new type. Reference cells use Macro’s native mention menu, limited to the selected
kind (for example, People shows users, Tasks shows tasks). Arrow keys navigate and
Enter chooses; Escape returns without changing the value. Delete clears a selected
reference cell. Text supports markdown and inline native mentions such as
`Say hi to @Maya`, stored using the same mention encoding as documents. A mention
inside a sentence preserves Text.

### Select options

A select or multi-select cell opens a compact option picker with its search field
focused (**Search or create…**). Typing filters the options; when the typed name is
not an option yet, a **Create “…”** row adds it, picks it, and keeps focus (on the
cell for a single select, in the search for a multi-select, which stays open). Arrow
keys move through the rows and Enter picks. The **Clear value** Button sits on the
right of a separate, bottom-padded footer below the option list. It sizes to its
label and empties the cell; it stays available while searching.
From a freshly opened picker, Down starts at the first option and Up starts at the
last. With no search text, Down after the last option focuses **Clear value** when present; Enter clears.
From that button, Up returns to the last option and Down returns to the first.
Multi-select pickers toggle each option and keep the others.

Each option row has a **⋯** button (`Edit <option>`) that opens the option editor:
**Option name** saves on Enter or when you leave it, the colour swatches (the same
picker tags use) recolour it, and **Delete option** asks for confirmation ("Cells
using “X” will be cleared.") before removing it and clearing it from every cell.
When the column's property is used outside this database, the editor says
**Changes everywhere this property is used.** The same editor opens from a column
header's **Edit options** menu item. Board lanes expose name and color editing
directly in the header. Changes show at once and roll back if the server refuses them.

**+ → New table**, at the right edge of the table selector in the split header,
adds an inline name field to the tab strip and focuses it immediately. Enter a
name and press Enter or leave the field to create the table with a Name column.
Escape cancels the draft; leaving an empty name also cancels. Duplicate names
are rejected inline. The table and its column are one request, so a failure
creates neither and keeps the draft available to retry with Enter.
To rename a table, right-click its tab and choose **Rename table**, double-click
the tab, or focus it and press F2. These actions also work on inactive tabs.
The tab itself becomes an input. Enter or leaving the input saves; Escape cancels.
Renaming preserves records and views. A concurrent rename asks you to reopen
the editor, and a failed request keeps your draft available to retry.
To reorder tables, drag a tab along the tab strip; an accent line shows where it
will land, and Escape cancels the drag. From the keyboard, focus a tab, press
Shift+F10 (or right-click it) and choose **Move left** or **Move right**; each is
disabled at its end of the strip. The new order shows at once, is saved for every
viewer, and survives a reload. If the save fails, the tabs return to their previous
order and a toast says so.
To delete a table, right-click its tab and choose **Delete table**, then confirm in
the dialog; its columns, records and views go with it, and a refusal shows as a
toast. A database's only table cannot be deleted: the item is disabled there.

An editable empty row always follows the records. Enter a value in any of its
cells to create a record; the next empty row appears immediately. Merely focusing
or tabbing through an empty row does not save an empty record.
Click a cell to edit, or focus it with the arrow keys and start typing. Enter
saves and immediately edits the same column in the next row, including the empty
new-record row. Typing there starts the next record without waiting for the
previous save. Shift+Enter moves up. Both place the typing cursor at the end of
the destination cell's text, ready to type. The active cell has one subtle outline,
with no additional border around its editor. Arrow keys inside a text editor keep their native cursor
behavior. Escape cancels. Tab saves and immediately edits the next writable cell;
Shift+Tab moves backward, and both wrap between rows. Read-only columns are
skipped. If a pending save infers a column's type, the cell currently being typed
in keeps its editor, draft and focus until it is committed or canceled.
Select values open the option picker; checkboxes change
directly. Type on a selected select cell to search its options; Enter chooses a
match, and Tab chooses the highlighted option or typed match before moving on.
Blank cells stay visually blank; no `Unnamed` placeholder is inserted. Delete
and Backspace both clear a selected cell immediately, including select and
checkbox cells. While editing text, they retain their normal text-editing behavior.
Number cells display thousands separators (for example, `100,000`); opening an
editor shows the raw number for editing. Invalid numbers and integers outside the
safe integer range stay in the editor with a failure outline instead of saving a
rounded value. **Enter a valid number** appears in an opaque, focus-only hint. Leaving
the field hides the hint but keeps the draft and outline; other fields remain
editable, including through Tab or Shift+Tab. Correct the value or press Escape to
cancel. Signed decimals and scientific notation remain supported.

Date cells open Macro's date selector (the one tasks use): type a date or phrase
such as `tomorrow`, `3d`, or `feb 17` and press Enter, or pick **Custom date...**
for a calendar. Typing on a selected date cell starts that search; Delete clears
the date, and Tab leaves the selector without changing it.
Invalid numbers remain in the editor for correction.
Drag across table cells to select a rectangle, or Shift-click another cell to
extend from the first cell. Delete or Backspace clears editable cells in that
rectangle as one undoable change; read-only cells are skipped. Newly saved rows
can be included immediately; unsaved insertion rows are excluded. Escape clears
the selection. Other participants see the selected range with a colored outline and
name banner, including when the selection covers several rows and columns.

Arrow keys also move between checkbox and closed select cells without changing
their values or opening a picker. Enter opens a selected select cell's picker.
Blank grid lines continue below the editable row to fill the available space.
Rapid edits remain attached to the same row while its first save is in flight.
Committed cell edits continue saving to their original table if you switch tables
while that first save is in flight.

Right-click a cell or row number for **Edit cell**, **Open record**, **Rename**,
**Duplicate**, or **Delete record**, as applicable. Shift+F10 or the keyboard menu
key opens the same menu for a focused cell. Right-clicking an active text input
keeps its native copy/paste menu. Duplicate copies editable values into a new row
and focuses its name. Deletion requires confirmation.

Click a row number or choose **Open record** for a compact centered dialog. The
name is editable once at the top, with the remaining properties below. Tab moves
directly between editable fields; previous/next controls browse the current view.
Close or Escape returns to the grid.

Relation cells show the names of records in their related table. Click one or
start typing to search that table, then select records to link them. The selected
chips open the referenced record in the compact editor; their **Remove** buttons
remove only the relationship, never the related record. Enter selects a match.
Tab selects a searched match before moving to the next cell; with an empty search
it only moves. Escape closes the picker and returns focus to the cell. Choosing a
relation in the empty row creates the record and its links together. View-only
users can open references but cannot select or remove them. Relation cells show
current record names, and unavailable records have a readable label. Search and
sorting skip relations; a relation filter can only test whether it is empty.

Rows are read in the browser: the grid runs its view, and relation pickers, CSV
export and live answers run their SQL, in the database engine over Soup GraphQL
(`/items/soup/graphql`), while every edit (a cell, a new or deleted record, a
card move, an option change, a view change, and every table or column change)
is a batch of typed ops sent to `POST /databases/{id}/ops`, applied together or
not at all. New tables, columns and options carry ids the client mints, so
later ops of the same batch can name them. Agents and MCP write SQL,
which the same engine turns into those ops on the server, and their schema
tools send the same ops.
Rows keep the table's order unless the view sorts them. After each of your own
edits the grid reads its rows again, and another viewer's edit reaches an open
grid or answer within a moment through the gateway's table-changed message; a
changed filter keeps the current rows on screen until the new ones
arrive.

Edits save automatically, and the last write to a cell wins. A failed save
appears as an actionable error above the grid; **Retry** reapplies the rejected
change. A failed refresh after a successful save
offers a refresh action; creating the record again would create a duplicate.
If a row's create response is lost, its draft remains and the notice says it may
already be saved. **Refresh** only reads the latest rows. Compare them with the
draft, then use **Discard draft** to remove the local draft without deleting any
saved record. The same uncertain draft cannot submit another insert.
View-only access allows browsing, searching, and filtering or sorting All records
for yourself, but disables data, schema and stored view changes.

## Table and board views

Tables contain the records; **Views** are shared ways to show them, stored with the
database and the same for everyone who can open it. **All records** is always first:
the table in its own order. Filters, sorts and column changes made on All records
change only what you see, until you make a view of them. Viewers can search and use
All records; only editors change stored views.

**New view** (the **+** beside the tabs) opens a dropdown with **Table** and
**Board**. Choosing one immediately creates and opens it with an available default
name, keeping the current filter and sort. A board starts grouped by the first
single-select or single-person column, or creates a Status column if there are
none. After creation, use the **Group by** dropdown in the board toolbar to change
the grouping column. Card settings stay; lane ordering resets for the new groups.
Multi-selects and checkboxes cannot group a board. Double-click a view tab, press
F2, or right-click it and choose **Rename view** to rename it in place (Enter saves,
Escape cancels). **Delete view** asks for confirmation; the records stay. Drag a tab
to reorder the views.

**Filter**, **Sort**, and **Search** sit at the right of the views row. In **Filter**, the first condition reads **Where**; the second row of a group
has the **And**/**Or** choice for that group. **Add condition** adds a test; **Add
group** adds a nested group joined the other way, with its own **Add condition** and
**Remove group**. Tests fit the column: text (contains, is, starts with…), numbers,
dates (before, after, on or before, on or after), checkboxes (checked or not), select
options (**is any of**/**is none of**, or **has any of**/**has all of**/**has none
of** for a multi-select, picked as coloured pills), and emptiness for any column. A
condition still being filled in is ignored and not saved. **Sort** orders by one or
more columns, first first; drag a level by its handle (or focus the handle and
press Up or Down) to change which sorts first.

**Search** (or Ctrl+F / Cmd+F anywhere in the database: grid, board, toolbar or a
cell being edited, instead of the browser's find) searches every table of the
database, not just the one on screen, and does not filter the grid. Each table is
read once in the browser's engine with a "contains" test over its text columns and
its options' labels. Results are grouped by table: each shows the record's title
and, when the match is in another column, that column and the matched text
highlighted, up to 20 per table with a count of the rest. Arrow keys move through
the results and Enter (or a click) opens one: the database switches to its table
and the row is scrolled to and highlighted, or its record opens when the view does
not show it. Escape closes the search and returns focus to where it was opened
from. The term is kept while you switch tables.

A view's layout, Table or Board, is chosen when the view is created. Creating a
view closes the menu and opens its tab immediately while saving. If saving
fails, the view shows **Retry** and **Dismiss**; retry checks whether the first
attempt committed before creating anything again. Columns
cannot be hidden, and they are added only from **Add column** after the headers or
a header's **Insert left**/**Insert right**. Dragging a column header's right edge
previews its width as you drag and saves it once you release (mouse or touch).
Switching views restores that view’s widths and column order.
Header menus offer sorting, **Move left** and
**Move right**. On All records, moving a column moves it in the table for everyone;
a stored view keeps its own column order.

A board's **Board menu** (the **⋯** above its lanes, for anyone who can change the
view) holds its settings: **Group by** another single select, **Card title** (the
column each card is headed by, the table's first by default), the **Card fields**
a card shows, **Hide empty lanes**, and **Hidden lanes**, whose **Show …** items
bring a hidden lane back.

Boards use the Tasks board layout, with virtualized lanes and cards. Scroll
horizontally to reach more lanes; each lane scrolls vertically on its own. A card
or lane being dragged stays mounted while scrolling. After a card move, its
destination is revealed. Starting a new card reveals the lane's draft at the
bottom and focuses its title, including after the lane was offscreen.

Lane headers show a color or type icon, a name, and an adjacent record count.
Cards use the Tasks board's header and compact, wrapping property layout rather than
stacked field rows. Cards without fields do not render an empty property area.
Title editing keeps the displayed title's typography, wrapping, and spacing.
Cards have a six-dot drag handle; their custom fields share a CSS grid with the title
and align below its left edge. **Open record details** (the expand
icon) and **Move** controls appear on hover or keyboard focus and stay visible on touch
screens. Lane fills contrast with the surrounding panel in light and dark themes,
with a subtle outline.
The Group by, Filter, Sort, Search, and Board menu controls use the same rounded
medium-size icon buttons as Drive. View tabs and New use the shared Button styling.

A board has a lane per option (or person). Records without a grouping value are
currently omitted from the board; they remain available in the table. Drag a card within
a lane or into another lane; it moves at once, and moving it to another lane also
sets its Select value. The order is saved for everyone and survives a reload. A
sorted board keeps the sort's order, so dragging a card asks **Remove sort to
arrange cards manually?**; **Remove sort** clears the sort and then places the
card. The insertion marker stays visible above the first card when reordering
within a lane. Drag a lane header to reorder lanes. Click an editable option lane's name to
rename it in place; the field keeps the title's typography, height, and position,
and grows with the draft up to the available header width. Enter or leaving the
field saves, and Escape cancels and returns focus to the name. Click its dot to
pick a color. The lane's **⋯** menu contains **Hide lane** and **Delete group**.
Deletion opens a confirmation dialog explaining that cells using the option will
be cleared, but records will not be deleted; **Delete group** uses danger styling.
**Hide empty lanes** remains only in the board's **Board menu**, with a right-side
checkmark when enabled. The card's **Move …** menu offers the same moves without
dragging. Click a card’s title or field to edit it in place using the same editors
as the table. Card-field inline editors fill the value area beside their icon and
keep its width, height, and typography; longer drafts scroll inside rather than
pushing neighboring fields.
Inline field edits save on Enter or leaving the field. Each save changes only that
field. Invalid drafts stay local, and saving another field or refreshing column
snapshots keeps their draft and failure outline until corrected or cancelled. Card
field inputs have no separate outline; validation outlines the entire field pill,
including its icon, and remains visible after blur.
Empty configured fields are editable too. Text and number fields reserve a small
minimum width so empty editors do not shrink to the dash. Use the card’s expand
icon to open the record-details dialog with all fields and previous/next controls;
field controls do not start a card drag.

The taller **+ New** button at the bottom of a lane (or the lane header's **+**) puts an empty,
focused card title in that lane; nothing opens. Enter creates the card with the
lane's value and opens another empty card below it, so several can be typed in a
row; each appears in place while it saves. Shift+Enter creates the card and opens
its record. Escape, or leaving an empty title, cancels; leaving a typed title
saves it. From the keyboard, press **n** with focus on any card or control in a
lane, or Enter on a focused lane header, to start a card there. The toolbar's
**New** starts one in the first lane. The dashed **New group** panel at the end
of the board matches Tasks' hidden-lanes panel. Its **New group** button opens a
name field. Its right-aligned actions show **Cancel** followed by a filled **Add
group** button, which adds another option and lane with the next palette colour.
Escape cancels; validation and save failures keep the draft for retry.

Creating or changing a record can make it fall outside the current
filters. A saved-record notice offers **Open record** to inspect it without
changing the view. Its record dialog explains why it is outside the view; you can
continue editing there. The selected table and view are restored when reopening
or reloading the database, once the signed-in user's identity is available.
Views and card places are typed data in the databases service
(`TableDetail.views`, `GET /databases/{id}/views/{view_id}/positions`) changed
through `POST /databases/{id}/ops` (`create_view`, `update_view`, `delete_view`,
`reorder_views`, `move_card`); rows load by running the view in the browser's
engine, never SQL text.

## Undo and history

**Cmd/Ctrl+Z** undoes your own last edit to the database you are in, and
**Cmd/Ctrl+Shift+Z** redoes it: cell edits, added and deleted records, column,
option and view changes, and card moves, newest first, for this session. While a
cell editor or another text input has focus, the shortcut stays with its text.
Undo only reverts your change: an edit someone else made later is kept. Undo
and redo show no toast; the grid shows what the server returned, and a refused
undo drops off the stack. Deleting records, a column or an option shows a toast
with an **Undo** action. Deleting a table cannot be undone.

Undoing option creation refuses while any entity still selects the option,
including uses of a shared property outside this table. Later column metadata
edits, incoming row references, and board regrouping also protect collaborators'
changes. Mixed batches restore required options and columns before their cells,
then remove options the original batch created.

Undo refuses when the stored inverse cannot restore the whole affected scope:
legacy unversioned inverses, shared-option deletions affecting other tables or
entities, and removing positioned cards, their lanes, or their boards. Regrouping
a board with saved card positions also refuses undo. These refusals write
nothing; they do not report a partial restoration as success.

Every committed batch is journaled with its inverse. `POST /databases/{id}/ops`
answers `changes` (one journal id per table version), `POST
/databases/{id}/changes/{change}/undo` undoes one of your own (undoing the undo
redoes), and `GET /databases/{id}/tables/{table}/rows/{row}/history` lists a
record's changes, newest first, also after it was deleted.

## First database

When Databases is enabled and an authenticated user has no accessible databases,
the app creates one small **Getting started** example in the background. Its
**Ideas** table has Name and Stage columns and three cards spread across To do,
Doing, and Done. Its Table and Board views show the same records; the first
open selects Board. This example is created at most once per user. Retrying or
opening another tab never overwrites edits, and removing the example does not
cause it to reappear. The app waits for the feature flag and database list before
provisioning, and disabled users receive no starter database.

## AI questions and live answers

Open **AI** (`Database AI`) at the right of the toolbar to create a native chat in the adjacent split.
Its bottom composer contains a database mention and private context identifying
this database, its current table, and all its tables. Nothing sends automatically.
Type a question or requested change and send it using the normal chat controls.
Any chat, not only one opened from a database, can build databases: the assistant
has six database tools: `ListDatabases`, `DescribeDatabase`, `QueryDatabase`,
`SaveDatabaseQuery`, `SaveDatabaseView`, and `DeleteDatabaseView`.
`QueryDatabase` reads and changes rows and handles schema changes through SQL
(`CREATE`, `ALTER`, and `DROP`). The assistant reads the current schema before
editing and checks actual results before reporting success.
A supplied `databaseId` must refer to an accessible database before rows or
schema changes resolve. Valid selections still allow qualified joins across
accessible databases.

Query tool rows say what the query did in words (**Read Invites**, **Updated 3
rows in Guests**, **Changed Price to number**, or **Queried Party Planner**) and
never show the statement. Query tool results render inline. Their display menu switches between a table,
a scalar answer, or compatible bar, line, area, scatter, and pie charts. A saved-view tool result
offers **Open view**, which opens that database/table and selects the created view.
The same tools are exposed to agent sessions through the Macro MCP server.

In a document, channel composer, or the task/document creation composer,
`/query` → **Query** opens the question box with the AI prompt focused
immediately. New draft questions bypass the saved-answer viewport gate; a cold
module load shows **Opening database…** until the question input is ready. Saved
answers still load when they approach the viewport. The empty input rotates through example questions; a selected database
uses its actual table and column names. Typing hides these hints, and reduced-motion
preferences keep them static. Use the searchable source picker below the question to
choose a database; the entire chosen database is in scope, without a table
prerequisite. **Automatic** finds a relevant accessible database from the question
with the discovery tools and inspects all its tables. The answer's `QueryDatabase`
runs with view access only, so asking a question never changes data, even for an
editor. Both discovery and final answer formatting receive the registered database
tool reference, including the current SQL dialect. Verify an Automatic question
that needs ListDatabases, DescribeDatabase, and QueryDatabase completes with live
results; repeat with an explicit source and an aggregate using an AS alias. The
formatting step must preserve tool-call/result names and ids without another tool
execution. If matching sources are
ambiguous, the assistant asks for clarification. Type to search the
source menu, use the arrow keys and Enter to choose, or Escape to return without
changing it. The displayed source is checked against the query's actual table
dependencies. Single values default to an inline answer; multiple records become a
result table. Asking for a chart can produce a **Bar chart**, **Line chart**,
**Area chart**, **Scatter chart**, or **Pie chart**; the AI can also split one
series into colored groups by a column, or stack bars and areas into a total. The
answer's display menu offers the formats supported by its data; **View data** opens
the underlying result table. Hovering a bar, point, or slice shows a tip with its
label and value. Categories draw as horizontal bars, and dates draw on a time axis;
rows without a date are left off that axis with a note saying how many. Missing
values remain empty, and an unavailable chart falls back to the table with an
explanation. Charts copied
into documents stay live: only their query and chart settings are saved, never a
copy of the reader's results. **Insert answer** saves a new answer. In a document,
open **Details**, edit the original question or source, and click **Regenerate**
to replace that answer after the new query succeeds. A failure keeps the previous
answer. Drag the answer's bottom edge to resize its result viewport; the chosen
height is saved with the document. The resize handle also accepts Up/Down arrows. Results refresh
when their source tables change, and each reader sees only data they can access.
The AI supplies a short answer title independently of the original question.
Double-click that title (or focus it and press F2) to rename it inline; Enter saves,
Escape cancels. Renaming keeps the question and its saved query unchanged. A saved
query names databases, tables, and columns by their display names, so renaming one
it reads makes the answer fail until the question is updated.

An existing document keeps its answer label when Databases is off and does not
fetch its database results; see [Feature flag](#feature-flag).

### Showing SQL

People never see SQL. Questions still compile to SQL and run, saved answers
still store it, and agents still write it through QueryDatabase, but the UI
shows only the question, the answer, and plain-words descriptions. There is no
SQL toggle, SQL editor, **Run SQL**, or **View SQL**, and a failed answer reads
like "This answer couldn't be computed: the column Price no longer exists."
instead of the engine's message. For development, start the web app with
`VITE_SHOW_DATABASE_SQL=true` (the env-only `showDatabaseSql` flag) to bring
back the SQL toggle and editor, **View SQL**, the raw error under **Technical
details**, and the server's summary on query tool rows.

## Sharing and files

**Share** opens Macro's standard sharing dialog. The owner can share with people
or channels and change or remove their access. Databases do not offer a public
link. **Share** and viewer avatars (other people currently looking at the
database) sit at the right of the split header, like other entities.

The toolbar's **Database actions** (`…`) menu, beside **AI**, contains **Rename**,
**Import CSV**, **Webhooks**, **Download**, and owner-only **Delete**. Rename focuses the inline
title in the split header; Delete opens the standard confirmation dialog.
**Download** offers **Current table as CSV**.
Exports contain all records, regardless of the current filters. CSV uses column
labels and preserves text, quoted commas, and line breaks. A table that changes
during CSV export must be downloaded again so the file does not mix different
versions.

**Import CSV** in the `…` menu opens a preview and focuses the new table's name.
Confirm **Import** to create a table with the CSV's columns and records. Imported
values remain Text, preserving leading zeros and large identifiers; use a column's
type menu afterward to convert it. The limit is 8 MB, 100 columns, and 10,000 rows.
A failed response offers **Retry import** with the same request, so retrying a
completed import does not create a second table.

**Webhooks** (editors only) opens a dialog for the current table. **Create
webhook** shows its URL once, with a copy button and a `curl` example built from
the table's columns; the list below shows each webhook's token prefix and a
delete button. POSTing a JSON object to the URL inserts one row (an array inserts
one per object, up to 100). Keys name columns, ignoring case; `null` leaves a
cell empty; unknown keys or values that do not fit refuse the whole call with a
400 listing every problem. The row is written as the webhook's creator, and the
webhook stops working if they lose edit access.

## Side panel and activity

The split header's `Show Side Panel` toggle (or `]`) opens the shared floating details panel,
closed by default. It overlays the database without resizing its content; click
outside to dismiss it. **Details** shows the Owner and Created time. **Activity** (behind
the `enable-entity-activity-section` flag, like documents) lists who created,
renamed, edited, shared, trashed, or restored the database, with the same glyph rail
and folding as a document's Activity section. Every write is one entry: a cell edit,
a SQL statement however many rows it touches, or a schema change such as a new
table or column. Consecutive edits by one person fold into `made N edits`. Changes an
AI agent made read as the agent acting for the user who asked. The same entries
appear on `/app/component/activity`; clicking one opens the database.

Database awareness identifies each mounted client with a random peer ID while the
server supplies its authenticated user. Open the same database in two tabs signed
in as the same user: each should show the other tab's selection and name. Moving
or leaving one peer must not overwrite or remove another peer's selection.
Refresh failures emit a `database.rows.read_refresh` span with the database ID,
table ID, and failure kind, plus a `database rows could not be refreshed` log.

Schema edits update their UI optimistically and finish after the write commits;
they do not wait for the background catalog refresh. A refused edit rolls back
its optimistic state when no newer cache update has replaced it, then refreshes.
A slow or failed refresh is not a reason to resend a successful mutation.

### Embedded database editors

In a document, `/database` creates a database and inserts its expanded editor.
Selecting an existing database from `@` inserts a compact chip. Its expand icon
opens the editor. **Collapse** returns it to a small mention. Cell and schema
edits use the same database grid and authorization as the standalone app. The
document stores only the database reference and selected table/view, never a
copy of its rows. See [Databases in documents](documents.md#databases-in-documents).

The shared editor also runs under a host's `DatabaseProvider`, using schema reads,
row queries and operation batches from that host's API. Verify cell edits and
column edits on the host surface, not only in the Macro database block. A host
without schema-edit permission offers no add, rename, delete or type-change
actions. Board card dragging requires a supplied position writer; a board without
one is still readable and must not report a successful move.

For local UI regression coverage, the database browser fixtures include an API
host with no Macro database entity. Its reads are paginated and its edits pass
through the same controller used by the database block.
