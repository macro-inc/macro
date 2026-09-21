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

Use **Add column** immediately after the table’s headers. It creates an **Unnamed**
Text column (**Unnamed 2**, and so on if that name exists), selects its name in the
header, and lets you type immediately. Enter saves; Escape keeps the default name.
There is no creation dialog. Double-click a header, press F2 while it is focused,
or choose **Rename column** from its arrow or right-click menu to rename it later.
Its type icon stays in place while editing. Labels may change without breaking
existing SQL identifiers or saved queries.

The header arrow menu groups schema and view actions. **Change type** offers Text,
Number, Select, Multi-select, Date, Checkbox, URL, People, Documents, Tasks, and
relations to tables in this database. A type change validates all existing values
and either converts the whole column or leaves it unchanged. Numbers can become
text; plain number strings can become numbers. Padding, leading zeros, ambiguous
values, and multiple values that would be lost are rejected with an explanation.
Changing a placement never changes another table that uses the same property.
A relation can hold multiple records. **Delete column** opens a confirmation;
it removes this table’s column and values while preserving other tables.
Drag a column title left or right to reorder it, or use **Move left / Move right**.

The first nonempty entry in a new default Text column sets its type. A plain number
becomes Number; starting with `@` and choosing an item makes it the corresponding
reference type. Other entries keep Text, and identifiers with leading zeros stay
text. Choosing Text explicitly disables inference. Populated columns never infer a
new type. Reference cells use Macro’s native mention menu, limited to the selected
kind (for example, People shows users, Tasks shows tasks). Arrow keys navigate and
Enter chooses; Escape returns without changing the value. Delete clears a selected
reference cell. Text supports markdown and inline native mentions such as
`Say hi to @Maya`, stored using the same mention encoding as documents. A mention
inside a sentence preserves Text. Select values offer **Add option** for new choices.
Multi-select menus toggle each option independently and keep the other selections.

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
or tabbing through an empty row does not save an empty record.
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

Relation cells show the names of records in their related table. Click one or
start typing to search that table, then select records to link them. The selected
chips open the referenced record in the compact editor; their **Remove** buttons
remove only the relationship, never the related record. Enter selects a match.
Tab selects a searched match before moving to the next cell; with an empty search
it only moves. Escape closes the picker and returns focus to the cell. Choosing a
relation in the empty row creates the record and its links together. View-only
users can open references but cannot select or remove them. Search, filters, and
sorting use current record names; unavailable records have a readable label.

Edits save automatically. A failed save appears as an actionable error above the grid.
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

Tables contain the records; the **Views** beside **All records** are saved ways to
show those same records. **New view** offers Table and Board. A Board requires a
Select, Multi-select, or Checkbox property; choose any compatible property in
**Group by**. The choice is based on the table's schema, without a special Status
property. **View settings** can change the current layout or grouping later.
If the table has no grouping property, **Open table** returns to its grid so you
can create a column and choose a suitable type from its header menu.

Lanes start in alphabetical order, including empty options and a **No …** lane
for unassigned records. Drag a lane header to reorder lanes, or focus its handle
and press Alt+Left / Alt+Right. Saved views remember the lane order automatically.
Drag anywhere on a card into another lane, keeping its original size and shape.
The card's **Move …** menu offers the same action without dragging. On a multi-select
board a card can appear in several lanes: moving it replaces that lane's value
and keeps its other selections; moving it to the unassigned lane clears them.

**New** within a lane opens an inline title input. Enter creates a card with that
lane's value; it appears immediately while saving, and another card can be started
without waiting. Failed requests keep the typed draft for correction or retry.
Open a card to edit its details. **New group** at the end of a select board adds
another option and lane. Hiding a property does not change the record's title.
The table grid uses its always-ready empty row instead of a separate New button.

**Filter**, **Sort**, **Search**, and **View settings** are grouped at the right of
the views row. Boards also offer **New**.
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
view** or **Delete view**, or double-click/F2 to rename it directly in its tab.
Enter saves and Escape cancels. These actions target the clicked view, even when
another view is selected. **Save as new view** copies
the active view. Shift+F10 or the keyboard menu key opens tab context menus.
Use **Save changes** to update an edited saved view. The selected table and saved
view, including unsaved view adjustments, are restored when reopening the database.

## First database

When Databases is enabled and an authenticated user has no accessible databases,
the app creates one small **Getting started** example in the background. Its
**Ideas** table has Name and Stage columns and three cards spread across To do,
Doing, and Done. The saved Table and Board views show the same records; the first
open selects Board. This example is created at most once per user. Retrying or
opening another tab never overwrites edits, and removing the example does not
cause it to reappear. The app waits for the feature flag and database list before
provisioning, and disabled users receive no starter database.

## AI questions and live answers

Open **AI** in the database header to create a native chat in the adjacent split.
Its bottom composer contains a database mention and private context identifying
this database, its current table, and all its tables. Nothing sends automatically.
Type a question or requested change and send it using the normal chat controls.
The assistant uses database tools to read data, make requested changes, and create
personal table or board views. It reads current schema before editing and checks
actual results before reporting success.

Query tool results render inline. Requested charts open in their selected format
when the returned data supports it. Their display menu switches between a table,
a scalar answer, or compatible bar, line, and pie charts. **View data** reveals the
chart's records; **View SQL** exposes its query. A saved-view tool result offers
**Open view**, which opens that database/table and selects the created view.
These same result components are used for Macro tools in agent sessions reached
through the Macro MCP server.

In a document, `/database` → **Database** opens the question box with the AI prompt focused
immediately. The empty input rotates through example questions; a selected database
uses its actual table and column names. Typing hides these hints, and reduced-motion
preferences keep them static. **Automatic** finds a relevant accessible database from the question
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
The AI supplies a short answer title independently of the original question.
Double-click that title (or focus it and press F2) to rename it inline; Enter saves,
Escape cancels. Renaming keeps the question and SQL unchanged. Table references
survive database and table renames.

Database creation, navigation, slash actions, and interactive answer chips are
controlled by the `enable-databases` feature flag (`VITE_ENABLE_DATABASES` locally).
An existing document keeps its answer label when the flag is off and does not fetch
its database results.

## Sharing and files

**Share** opens Macro's standard sharing dialog. The owner can share with people
or channels and change or remove their access. Databases do not offer a public
link. Viewer avatars in the header show other people currently looking at the
database.

**Download database** offers **Current table as CSV** or **Database as SQLite**.
Exports contain all records, regardless of the current filters. CSV uses column
labels and preserves text, quoted commas, and line breaks; SQLite contains the
whole database. A table that changes during CSV export must be downloaded again
so the file does not mix different versions.

**Import CSV**, beside Download, opens a preview and focuses the new table's name.
Confirm **Import** to create a table with the CSV's columns and records. Imported
values remain Text, preserving leading zeros and large identifiers; use a column's
type menu afterward to convert it. The limit is 8 MB, 100 columns, and 10,000 rows.
A failed response offers **Retry import** with the same request, so retrying a
completed import does not create a second table.
