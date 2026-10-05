# Forms

A form is a questionnaire whose answers land as rows of one database table.
Every question is a column of that table; the form stores only presentation
(sections, order, help text, required, gates). Authoring is behind the
`enable-forms` flag (`VITE_ENABLE_FORMS=true|false`; on under `bun run dev`
and HMR, PostHog otherwise). Until the flag is enabled, including while remote
flags are loading, `/app/form/<uuid>` opens on the
respond view (no builder), and no Create entry, mention bucket, `/poll`,
`/form` or database form control exists. Responding (the respond route, form
cards and mentions in messages) does not depend on the flag: the service
decides who may respond.

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
- In a channel composer, `/form` creates a form and opens the builder beside
  the channel; its card joins the draft once the builder saves a question.
  `/poll` opens the poll dialog (question, at least two options, **Multiple
  answers**, **Show results to respondents**); **Post poll** puts the poll's
  card in the message and sends it. Closing the dialog while it posts sends
  nothing and trashes the poll. With results hidden, respondents answer
  without counts and editors review votes in the Responses tab.

## The form page

Editors see three tabs, kept per split (a split opened with
`params.view` `responses` or `share` starts there), with the status at the right ("Accepting responses · closes Oct 3",
"Closed", "Table deleted"). Viewers (respondents) land on the respond page
instead. The header's primary button, for owners, is **Publish** (opens sharing)
until someone responds or the form is shared (public, a channel, the team),
then **Open form** (respond view in a new split); other editors always see
**Open form**. The header badge follows the form's own access.

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
- The rail's **Section** and **Screener** controls can also be dragged directly
  into the canvas. The insertion line shows where the new section will go;
  dropping outside the canvas or pressing Escape leaves the form unchanged.
- "N columns not on this form" at the bottom lists table columns that are not
  questions; **Add** puts one on the form.
- Layout edits collaborate live through Loro. Other editors' selections appear
  in the builder. Connection and save failures are visible; there is no
  persistent saved badge. Invalid screener drafts remain editable while the
  public form keeps its last valid layout.
- A type change that existing answers do not fit shows **Convert into a new
  question**: a new column gets the answers that convert and the question
  moves to it; the old column stays (listed under columns not on the form).
- **Preview** opens a new tab with the respondent experience after pending
  edits are saved. Fill it, try the screeners, and return to the builder. Preview
  creates no response rows, file uploads or bookings.
- **Booking** in the rail selects an existing booking link from **Booking links**
  settings. It is always the last step. **Change** selects another link;
  **Remove booking step** leaves the link itself intact. A form's screeners
  control when its respondents see the link; the native link still works directly.
- New standalone forms share their name with the database they create. Rename
  either to change both. Forms added to existing tables have independent names.

### Responses

The linked table's grid, embedded and live, with **Open database**, **Export
CSV** and tiles: Responses, Stopped by a screener (per screener in its hint), Rows in
the table, and (owners, when posted in channels) People in its channels (the
owner excluded; a dash for public forms). Every row of the table shows,
including rows added in the grid.

### Share

**Who can respond**: Invited people (sign in, one response each, editable
while open) or Anyone with the link (anonymous; no file questions). The
respond link with Copy, Accepting responses, Close automatically, Show results
to respondents, Confirmation message, and **Manage access** (the share dialog,
which also shows the audience panel). Anyone with the link: visitors who aren't signed in respond anonymously;
people signed in to Macro respond as themselves. Roles: View can respond; Edit can change
questions and also edits the linked database (its response rows and columns)
through derived access; Owner can also change the audience, close and trash.
Posting a form in a channel grants that channel View, which means it can
respond; its row in the share dialog reads "Can respond (channel)", and roles
offered on a form are View and Edit. A database's own share dialog lists the forms over it: their editors
can also edit the database, and each form's chip opens its sharing. Owners also get **Move to trash** at the bottom; the database and its
rows stay.

## Finding forms

Drive lists forms you can open (type facet **Form**), and Quick Access has a
Forms bucket. Both come from `/forms/accessible`, so a form shared with you
appears without access to its database. Deleting a database table warns which
forms it deletes; deleting a column warns which forms ask it (both say so
while still checking, or when the check failed, instead of saying nothing).

## Responding

`/app/form/<uuid>/respond` is one page in two shells: signed-in visitors see
it inside the app shell (sidebar, command menu); anonymous visitors get a
focused page, so a public form never hits login. Signed in, a respondent
keeps their identity on either audience and can edit their response while the
form is open; anonymous visitors cannot. One section per screen with
**Back / Next**, **Submit** on the last. Next checks required answers and any
gate locally; a failing gate shows "This form can't take your response" with
the gate's message (never its rules), **Check my answers** and, signed in,
**Message the owner** (opens a direct conversation). Submit shows the
confirmation with a receipt; signed-in respondents (either audience) get
**Edit my response** while it is open and land on their receipt when they
return. A closed form says "This form is closed"; a returning respondent
sees their saved answers with that reason.

When the form ends with a booking step, the last action reads **Continue to
booking**. After the server accepts the response and its screeners, Macro's
time picker appears. Booking opens `/app/booking/<id>#<private-token>`; retain
that private link for cancellation or rescheduling. A returning signed-in
respondent can use **Book a time** on their receipt if their saved answers still
pass. Preview can show real slots, but its booking button is disabled.

In a message or document, a form card fills in place; a poll card shows one
bar per option, your vote marked, and "N votes · one vote each". Click an
option to vote; click another to change it. **Responses** opens the Responses
tab for editors; respondents get **Results**, the counts as a table in the
card. In a draft, the card menu's **Convert to Inline Mention** minimizes it;
in a sent message, **Collapse / Expand** hides the body for you only. Arrow
keys move between poll options; Space or Enter votes.

## Reading responses as an agent

Use the Responses tab grid, or open the database (`/app/database/<uuid>`) the
form names under **Stores to**. Each submission is a row; the `Submitted` and
`Respondent` columns are written by the form.
