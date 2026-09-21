# Databases

Choose **Create → Database** to create a database and its first table with a Name
column. **C → B** opens a new database with its title selected and ready to type.
Enter saves the title and focuses A1, ready to type without another click.
Databases open at
`/app/database/<uuid>`. A database contains tables; records belong to a table and
its properties describe each record. Click the database title to rename it later.
Enter or leaving the title saves; Escape cancels, and a failed rename keeps the
draft for retry.

## Properties and records

Use **Add column** immediately after the table’s column headers, beside Name in a
new table. **View settings** also offers **Add column**; boards keep it beside
**New**. Its panel opens beside the button with the name field focused. Enter a
name, or leave it blank to create **Unnamed** (**Unnamed 2**, and so on when those
names already exist). Text is the default. The compact type menu offers Text,
Select, Number, Date, Checkbox, or URL. Select **Add column** or press Enter;
in table view, its first cell receives focus.
The first nonempty entry in a new default column sets its type: a plain number
becomes Number; entering `@` opens a person/item picker and selecting a mention
sets the matching reference type. Other entries keep Text. Values with leading
zeros stay text. Explicitly choosing Text disables inference, including literal
`@` entries. Existing populated columns never change type automatically.
Mention suggestions support Arrow keys, Enter to choose, Tab to choose and move
to the next cell, and Escape to return to the unsaved text. Reference columns
then offer only matching types and display names rather than stored IDs.
Select options appear as editable choices; **Add option** or Enter in that field
adds a choice. Columns are the properties that describe each record.
Double-click a column header, press F2 while it is focused, or choose **Rename
column** from its right-click or arrow menu to rename it inline. Enter saves and
Escape cancels. The column's values and saved query references are preserved.

**New table**, beside the table tabs in the database header, creates another table
with a Name column. Enter a table name and press Enter. If the table is created
but its column setup fails,
**Retry setup** continues that same table; **Open table** lets you finish manually.
To rename a table, right-click its tab and choose **Rename table**, double-click
the tab, or focus it and press F2. These actions also work on inactive tabs.
The tab itself becomes an input. Enter or leaving the input saves; Escape cancels.
Renaming preserves records and saved views. A concurrent rename asks you to reopen
the editor, and a failed request keeps your draft available to retry.

An editable empty row always follows the records. Enter a value in any of its
cells to create a record; the next empty row appears immediately. Merely focusing
or tabbing through an empty row does not save an empty record. The toolbar’s
**New** button (accessible name **New record**) focuses that row's first cell.
Click a cell to edit, or focus it with the arrow keys and start typing. Enter
saves and keeps that cell selected; Down then selects the same column in the
next row, ready to type. Arrow keys inside a text editor keep their native cursor
behavior. Escape cancels. Tab saves and immediately edits the next writable cell;
Shift+Tab moves backward, and both wrap between rows. Read-only columns are
skipped. Select values open a menu, including **Add option**; checkboxes change
directly. Type on a selected select cell to search its options; Enter chooses a
match, and Tab chooses the focused option or typed match before moving on.
Invalid numbers and dates remain in the editor for correction.
Arrow keys also move between checkbox and closed select cells without changing
their values or opening a menu. Enter opens a selected select cell's menu.
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

Edits save automatically. Check the save status and any error before continuing.
A concurrent edit can cause a version conflict: the latest values load and
**Retry** reapplies the rejected change. A failed refresh after a successful save
offers a refresh action; creating the record again would create a duplicate.
If a row's create response is lost, its draft remains and the notice says it may
already be saved. **Refresh** only reads the latest rows. Compare them with the
draft, then use **Discard draft** to remove the local draft without deleting any
saved record. The same uncertain draft cannot submit another insert.
View-only access allows browsing and personal view controls but disables data
and schema changes.

## Table and board views

Open **View settings** and choose the Table or Board layout. Boards group by a
single-value select or checkbox column; the same panel contains **Group board
by**. When no grouping property exists, **Add Status column** opens the column
panel with Not started, In progress, and Done already filled in. Empty options
remain visible as lanes, and unassigned records appear in the **No …** lane.

Drag a card's grip into a lane to change its grouping property. The card's
**Move …** menu provides the same action without dragging. **New record** within
a lane creates a record with that lane's value. Open a card to edit its details.
**New group** at the end of a select board adds another option and lane.
Hiding a property does not change the record's title.

**Filter**, **Sort**, **Search**, and **View settings** are grouped beside **New**.
**Search** expands an inline **Search records** field; **Clear search** leaves
filters intact and keeps that field focused. Escape clears and closes search.
Multiple filters are combined with AND. Multi-select filters match the selected
members. Column headers offer sorting, **Move left**, **Move right**, and
**Hide column** for the current view. Moves skip hidden columns; the Columns
checkboxes in **View settings** restore a hidden column to its saved position.
Hidden columns remain available in the record dialog, and new columns appear
after the saved layout.
Creating or changing a record can make it fall outside the current search or
filters. A saved-record notice offers **Open record** to inspect it without
changing the view. Its record dialog explains why it is outside the view; you can
continue editing there. A failed data refresh after creation keeps the saved
record available rather than requiring another create.
**New view** offers Table or Board, a name, and **Create view**. It stores the
current filters, sorting, column order, and visible columns as a personal view
for this table.
Saved views appear beside **All records**. Right-click a saved view for **Rename
view** or **Delete view**, or double-click/F2 to rename it. These actions target
the clicked view, even when another view is selected. **Save as new view** copies
the active view. Shift+F10 or the keyboard menu key opens tab context menus.
Use **Save changes** to update an edited saved view. The selected table and saved
view are restored when reopening the database.

## AI questions and live answers

Open **AI** in the database header. Its question field receives focus; describe
what you want to know or build and press **Ask** or Enter. Shift+Enter adds a line
break. The source line shows the current table. An explicitly named table takes
precedence, and the assistant can discover tables in other accessible databases.
For a question or chart it reads data; an explicit request to add tables, columns,
select options, records, or views uses the corresponding database tools. Completed
changes appear above the result. Created table tabs, updated records, and saved
views refresh without reopening the database.
While Database AI is working, its request and SQL stay read-only so another
submission cannot overlap the same operation.

Ask for a named kanban board grouped by a status/select column, or a named table
view with filters and sorts; it appears in the table's view rail. These views are
personal and preserve source records. Charts render in the answer and can be
copied into a document; they are not saved table/board layouts. The assistant
checks the resulting schema/records before reporting success. If work partially
completes, review the saved changes before revising the request.

Asking an unchanged question reuses its read-only verification SQL instead of
repeating edits. **How this was calculated** explains the result, and the answer's
refresh button reruns only that query.

**SQL** reveals direct editing and **Run SQL**, which are always read-only. **Undo**
restores a question draft; it is absent after the assistant makes changes because
it cannot undo database edits. A failed verification keeps the completed-change
notice visible and retries only the read. Queries run with the current reader's
permissions. Live document question editors have read-only discovery and query
tools; they cannot change records, schema, or saved views.
If the connection ends before the assistant reports its outcome, the panel does
not claim success or repeat the request. Check the table, then revise the request
to continue; some changes may already have been saved.

After an answer appears, **Copy for a doc** copies a live answer. In a document,
`/database` → **Database** opens the question box with the AI prompt focused
immediately. **Automatic** finds a relevant accessible database from the question
and inspects all its tables. Use the searchable source picker beside **SQL** to
choose a database explicitly; the entire chosen database is in scope, without a
table prerequisite. Type to search the source menu, use the arrow keys and Enter
to choose, or Escape to return without changing it. The displayed source is
checked against the query's actual table dependencies. If matching sources are ambiguous, the assistant asks for
clarification. Single values default to an inline answer; multiple records become a
result table. Asking for a chart can produce a **Bar chart**, **Line chart**, or
**Pie chart**. The answer's display menu offers the formats supported by its data;
**View data** opens the underlying result table. Missing values remain empty, and
an unavailable chart falls back to the table with an explanation. Charts copied
into documents stay live: only their query and chart settings are saved, never a
copy of the reader's results. **Insert answer** saves a new answer; **Save changes** updates an
existing one. Existing answers retain their resolved source and preview their
saved query when opened. Changing the question or source preserves the draft but
requires updating the result before saving. Results refresh
when their source tables change, and each reader sees only data they can access.
Table references survive database and table renames.

The database header's export button downloads a SQLite snapshot. It exports the
database, not only the currently filtered or visible rows.
