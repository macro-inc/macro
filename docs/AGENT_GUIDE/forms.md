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
- On a database page you own, **+ → New form** in the table selector makes
  a form with a question per existing column while no form writes to the current
  table. Each table has at most one form; the control opens that form once created.
  A trashed form reserves its table until restored or permanently deleted.
  Creating over an existing table needs
  database Owner: editors and viewers see the existing forms only.
- In a channel composer, `/form` creates a form and opens the builder beside
  the channel; its card joins the draft once the builder saves a question.
  `/poll` opens the poll dialog (question, at least two options, **Multiple
  answers**, **Show results to respondents**); **Post poll** puts the poll's
  card in the message and sends it. Closing the dialog while it posts sends
  nothing and trashes the poll. With results hidden, respondents answer
  without counts and editors review votes in the Responses tab.

## The form page

Editors see **Build**, **Responses** (with its count), and **Settings** in the
shared pill tab selector beside the form title in the top bar, kept per split (a split opened with
`params.view` `responses` or `share` starts there). Viewers (respondents) land on the respond page
instead. The header's primary button, for owners, is **Publish** (opens sharing)
until someone responds or the form is shared (public, a channel, the team),
then **Open form** (respond view in a new split); other editors always see
**Open form**. The header badge follows the form's own access.

### Build

Build uses the same centered 768px content column as a Markdown document.
The editable title sits above a linked-database property pill and a read-only
status pill ("Accepting responses", "Closed", or "Table deleted"), then the
description.
A compact document-style outline rail on the left previews sections and questions
on hover and navigates to them on click. It marks the selected section or question.
Each question section ends with a large **Add question** menu. It appends a new
question or existing database field to that section, regardless of the current
selection. Three visible actions sit below the canvas: **Add section** adds a
question section directly, **Add gate** adds a screener with its inline rule editor
open, and **Add meeting link** opens the booking-link picker (when scheduling is
available). Hover a question boundary to reveal a plus that inserts a question
at that position. Hover between sections to insert a **Section** or **Gate**.
These controls also appear on keyboard focus and stay visible while their menus
are open. Meeting links can only be added at the end; adding other sections later
keeps the meeting link last. Start an empty form by adding a section, then its questions.

- **Database row** asks which table to use before adding the question.
  Existing questions and sections can still be reordered with their drag handles.
- After **Section** (or
  focusing a section's title, which outlines it) it goes to the end of that
  section. An empty section has its own **Add question** menu.
- Click a section or question in the left **Outline** to reveal it in the
  canvas. A question opens for editing on the first click, including while a
  rename saves. Selecting a section also directs subsequent question additions
  there. Incoming edits preserve keyboard focus in the outline.
- Click a row to select it: the title input renames the column, the type chip
  opens the same grouped type menu (Short answer … Database row), choice questions edit
  their options in place, and the footer has Duplicate, **Remove from form**
  (keeps the column), **Required**, and the ⋯ menu (Move up / Move down / Move
  to section / **Delete column and answers…**, which confirms with the row
  count).
- Required questions show a **Required** badge below their answer preview.
  Selecting the question puts its Required switch at the bottom right, with
  duplicate, remove, and more actions on the left.
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
- Layout edits collaborate live through Loro. Other editors' selections appear
  in the builder. Connection and save failures are visible; there is no
  persistent saved badge. Invalid screener drafts remain editable while the
  public form keeps its last valid layout.
- A type change that existing answers do not fit shows **Convert into a new
  question**: a new column gets the answers that convert and the question
  moves to it; the old column stays (listed under columns not on the form).
- **Preview** opens a new tab with the respondent experience after pending
  question and form settings edits are saved, including edits started before
  switching tabs. Fill it, try the screeners, and return to the builder. Preview
  creates no response rows, file uploads or bookings.
  On touch devices, Preview, Publish (or Open form), and Share are in the
  floating header above the editor.
- **Add meeting link** selects an existing booking link from **Booking links**
  settings, or opens settings to create one. It is always the last step. Once added,
  the action becomes **View meeting link** and focuses the existing step rather than
  adding a duplicate. **Change** selects another link;
  **Remove booking step** leaves the link itself intact. A form's screeners
  control when its respondents see the link; the native link still works directly.
- New standalone forms share their name with the database they create. Rename
  either to change both. Forms added to existing tables have independent names.

### Responses

The linked table's grid, embedded and live, with summary tiles: Responses, Stopped submissions (per screener in its hint), Rows in
the table, and (owners, when posted in channels) People in its channels (the
owner excluded; a dash for public forms). Every row of the table shows,
including rows added in the grid. Stopped submissions counts signed-in respondents
whose latest recorded result is stopped. Retrying does not add another count;
a successful submission clears that stop. Anonymous attempts and stops before
submitting are not recorded; answers stay in the browser until Submit.

### Settings

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
form is open; anonymous visitors cannot. The response page has no top bar:
it uses the builder’s centered 768px content column, plain title and description,
and questions grouped within a single section card. Public sign-in guidance
sits below the form. One section per screen with
**Back / Next**, **Submit** on the last. Required fields keep their asterisks;
the legend and response-editing guidance sit below the questions. Next checks required answers and any
gate locally; a failing gate shows "This form can't take your response" with
the gate's message (never its rules), **Check my answers** and, signed in,
**Message the owner** (opens a direct conversation). Submit shows the
confirmation with a receipt; signed-in respondents (either audience) get
**Edit my response** while it is open and land on their receipt when they
return. A closed form says "This form is closed"; a returning respondent
sees their saved answers with that reason.

Presence avatars appear only in the editor. Respondent pages (including an
owner’s Preview) do not announce presence or show other viewers; their form
metadata refreshes periodically without a presence subscription.

Choice answers use the app’s themed radio and checkbox controls in both Preview
and the live form. Verify light and dark themes: radio arrow keys select one
answer, **Clear selection** removes it, and Space toggles checkboxes independently.
While submitting, **Clear selection** stays visible but disabled to keep the layout stable.

Temporary background refresh failures keep unsent answers on screen. If Submit
discovers an existing response but cannot load its receipt, **Try again** reloads
that response without submitting another one.

When the form ends with a booking step, the last action reads **Continue to
booking**. After the server accepts the response and its screeners, Macro's
time picker appears. Booking opens `/app/booking/<id>#<private-token>`; retain
that private link for cancellation or rescheduling. A returning signed-in
respondent can use **Book a time** on their receipt if their saved answers still
pass. A form with only a booking step still offers **Continue to booking** and
waits for server acceptance. Preview can show real slots, but its booking button
is disabled.

In a message or document, a form card fills in place; a poll card shows one
bar per option, your vote marked, and "N votes · one vote each". Click an
option to vote; click another to change it. **Responses** opens the Responses
tab for editors; respondents get **Results**, the counts as a table in the
card. In a draft, the card menu's **Convert to Inline Mention** minimizes it;
in a sent message, **Collapse / Expand** hides the body for you only. Arrow
keys move between poll options; Space or Enter votes. Polls can also be voted
on directly in mobile channels. In New poll, Add option focuses the new
choice; removing a choice focuses its replacement. Duplicate choice names
(ignore case and surrounding spaces) show an inline error and disable Post
until corrected. Poll cards omit permission badges and display the question
once, in the card header. Newly posted poll cards
store their option count in Lexical preview metadata to reserve their height
before loading. Choices have fixed-height rows; large polls and expanded
results scroll inside the card. Older cards without that metadata keep their
content-sized layout.

## Reading responses as an agent

Use the Responses tab grid, or open the database (`/app/database/<uuid>`) linked
in the form's banner. Each submission is a row; the `Submitted` and
`Respondent` columns are written by the form. They can be renamed and moved,
but their types cannot change and they cannot be deleted while the form exists
(including while it is in the trash). Permanently deleting the form releases
those protections and preserves its database, columns, and answer rows.
