# Forms

A form is a questionnaire whose answers land as rows of one database table.
Every question is a column of that table; the form stores only presentation
(sections, order, help text, required, gates). Authoring is behind the
`enable-forms` flag (`VITE_ENABLE_FORMS=true|false`; on under `bun run dev`
and HMR, PostHog otherwise). With it off, the form at `/app/form/<uuid>`
says forms aren't enabled, and no Create entry or database form control
exists.

## Creating

- **Create → Form** (shortcut **C → Q**, **Shift** opens it in a new split)
  creates "Untitled form" with a new database whose table is "Responses",
  and opens the builder at `/app/form/<uuid>`.
- On a database page you own, **+ view** offers **Form** beside Table and
  Board while no form writes to the current table, and the control after the
  table tabs is **+ Form**; both make a form with a question per existing
  column. When forms exist that control reads **N forms**: a menu of them
  plus **New form from this table**. Creating over an existing table needs
  database Owner: editors and viewers see the existing forms only.

## The form page

Editors see three tabs, kept per split (a split opened with
`params.view` `responses` or `share` starts there), with the status at the right ("Accepting responses · closes Oct 3",
"Closed", "Table deleted"). Viewers see the form's sections and questions,
read-only, without tabs. For owners, the header shows **Publish** (opens
sharing) until someone responds or the form is shared (public, a channel, the
team). The header badge follows the form's own access.

### Build

A centered column of sections, each a card of question rows, with the rail
(Add, Outline, Stores to) at the right on wide splits.

- Add question goes after the selected question; after **Add section** (or
  focusing a section's title, which outlines it) it goes to the end of that
  section. An empty section has its own **Add question** menu.
- Click a row to select it: the title input renames the column, the type chip
  opens the type menu (Short answer … Database row), choice questions edit
  their options in place, and the footer has Duplicate, **Remove from form**
  (keeps the column), **Required**, and the ⋯ menu (Move up / Move down / Move
  to section / **Delete column and answers…**, which confirms with the row
  count).
- Drag by the six-dot handle (mouse: move 4 px; touch: hold 200 ms). A line
  shows where it lands; a red line with a note means a gate checks that
  question and it must stay above the gate. Escape cancels; nothing saves
  until the drop. Keyboard: focus a handle, **Space**, **↑/↓**, **Space** to
  drop, **Escape** to cancel, **Tab** leaves (cancelling).
- Sections drag by their own handle. A gate section's **Add rule / Edit rules**
  opens the grid's condition editor over questions of earlier sections only;
  **Add condition** adds a row that saves once it is complete (pick a value).
  Rules are sent to respondents' browsers, so keep confidential criteria out.
  A gate whose rule tests a question that is gone shows **Remove broken
  rules**.
- "N columns not on this form" at the bottom lists table columns that are not
  questions; **Add** puts one on the form.
- The **Saved / Saving… / Not saved** label tracks layout saves (400 ms
  after the last edit). A refused save shows a toast and reloads the form.
- A type change that existing answers do not fit shows **Convert into a new
  question**: a new column gets the answers that convert and the question
  moves to it; the old column stays (listed under columns not on the form).

### Responses

The counts (Submitted, Stopped at each gate, Rows in the table) and **Open
database**, which opens the linked database where each response is a row.

### Share

**Who can respond**: Workspace members (sign in, one response each, editable
while open) or Anyone with the link (anonymous; no file questions). The
respond link with Copy, Accepting responses, Close automatically, Show results
to respondents, Confirmation message, and **Manage access** (the share dialog,
which also shows the audience panel). Anyone with the link: visitors who aren't signed in respond anonymously;
people signed in to Macro respond as themselves. Roles: View can respond; Edit can change
questions and also edits the linked database (its response rows and columns)
through derived access; Owner can also change the audience, close and trash.
Roles offered on a form are View and Edit. A database's own share dialog lists the forms over it: their editors
can also edit the database, and each form's chip opens its sharing. Owners also get **Move to trash** at the bottom; the database and its
rows stay.

## Finding forms

Drive lists forms you can open (type facet **Form**), and Quick Access has a
Forms bucket. Both come from `/forms/accessible`, so a form shared with you
appears without access to its database. Deleting a database table warns which
forms it deletes; deleting a column warns which forms ask it (both say so
while still checking, or when the check failed, instead of saying nothing).

## Reading responses as an agent

Open the database (`/app/database/<uuid>`) the
form names under **Stores to**. Each submission is a row; the `Submitted` and
`Respondent` columns are written by the form.
