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
  and opens it at `/app/form/<uuid>`.
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

The sections ("Section 1 of 2", gates as "Gate 1") with each question's name,
type and help text; required questions are starred. It is read-only.

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
form belongs to (**Open database** on the Responses tab). Each submission is a row; the `Submitted` and
`Respondent` columns are written by the form.
