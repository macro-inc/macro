# RFC 02: Forms in the web app

Status: accepted for the first pass. Everything here is behind
`enable-forms`, defined like `enableDatabases` in
`lib/core/constant/featureFlags.ts` (`env: 'ENABLE_FORMS'`, on in local
dev, PostHog otherwise). Nothing form-related loads eagerly when it is off.

Paths are relative to `apps/web/src`.

## 1. The entity

Forms are a block named `form`, registered the way `database` is. The files
to touch are the ones the databases and pptx commits touched; the
implementation prompt lists them. The parts that are form-specific:

- `features/block-form/definition.ts`: `defineBlock({ name: 'form', ...,
  openTrackingEnabled: true, editPermissionEnabled: true })`. `load` accepts
  `source.type === 'dss'` and calls the new `loadForm(id)`, which is
  `storageServiceClient.forms.get`.
- Icon: Phosphor `clipboard-text` in `EntityIcon.tsx`.
- `ItemType` gains `'form'`; `blockNameToItemType('form')` is `'form'`, not
  `'document'`, so mentions and previews resolve to the form fetchers.
- Create menu: "Form" in `CREATABLE_BLOCKS` with hotkey tokens `create.form`
  and `create.formNewSplit`, shown only when the flag is on. Creating from
  the menu calls `POST /forms` with `source: New` and opens the builder.
- Client: `lib/service-clients/service-storage/forms.ts`, hand-written like
  `databases.ts`, mounted as `storageServiceClient.forms`. Types come from
  `just gen-api cloud-storage`. Hooks in `lib/queries/storage/forms.ts`:
  `useFormDetailQuery`, `useFormsForDatabaseQuery`, `createForm`,
  `putFormLayout`, `submitResponse`, `useMyResponseQuery`,
  `useResponseSummaryQuery`, `useTallyQuery`, permissions.

Routing needs nothing: `legacyContentRoute` claims `form:<id>` because the
block exists. The respond page (§4) is a second route.

## 2. The form page

`features/block-form/component/Block.tsx` renders a top bar and three tabs.
The top bar is `SplitHeader` with the form icon and name, presence, a
Share trigger (`useShareModal` with `itemType: 'form'`), and one primary
button: "Publish" while no one has responded and the form is not yet shared,
"Open form" afterwards, which opens the respond route in a new split.

Tabs, kept in the URL hash so a reload lands on the same one:

- **Build**: §3. Editors only; viewers land on Respond.
- **Responses**: §5. Editors only.
- **Share**: opens the share modal; it is a tab for discoverability, the
  content is the modal's panels inline. Owners see the audience radio.

A status line sits at the right of the tab strip: "Accepting responses ·
closes Oct 3", "Closed", or "Table deleted" when the service reports
`TableGone`.

## 3. The builder

The builder edits two things through two clients and keeps them in step
with one rule: **column facts go to `/databases/{id}/ops`, presentation
goes to `PUT /forms/{id}/layout`.** It holds the form detail (sections,
questions, column facts joined by the server) in a local store, applies
edits optimistically, and sends them as they happen.

Layout on screen (mock: Build tab of the first artifact):

- Centered column, max 680px. A title card with the form name, description,
  and a meta line: "Responses in <database name>" linking to the Responses
  tab, the audience, "3 sections · 1 gate".
- Sections as groups: eyebrow "Section 1 of 3", title, question count. Each
  question is a row in one card: title, type chip at the right, body preview,
  and when selected a footer with duplicate, delete, required toggle, more.
- A routing footer under every section: "After section 1 → Continue to
  section 2". In this pass it is informational (sections are linear); keep
  the control so branching slots in later without a layout change.
- A gate section renders its rule rows ("IF Team is not Contractor AND Start
  date is before Sep 1, 2026"), an "Add rule" affordance, and the message
  shown when a rule fails. Rules are edited with the same condition editor
  the grid's view filter uses, restricted to columns of earlier sections.
- Right rail: Add (Question, Section, Gate section, Questions from a
  database), Outline (sections and the selected question), Stores to (the
  database chip, and the sentence "Every question is a column. Adding a
  question adds a column. Removing a question keeps the column.").

Question editing, each mapped to its write:

| Edit | Write |
| --- | --- |
| Title | `Column Rename` op (with `previous_name`) |
| Type | `Column ChangeType` op; on refusal show the misfit count and offer "Convert into a new question" via the grid's conversion flow, then a layout put swapping the column id |
| Options (choice, dropdown, checkboxes) | `Column AddOptions` / `UpdateOption` / `DeleteOption` ops; same option editor as the grid |
| Help text, required, widget, section, order | layout put |
| Add question | mint `ColumnId`, `Column Create` op, then layout put placing it |
| Add existing column | layout put only; the Add menu's second group lists the table's columns not on the form, with their kinds |
| Remove from form | layout put (default on the delete icon) |
| Delete column | `Column Delete` op after the grid's confirm with the row count; the question disappears when the detail refetches |
| Add section, gate, reorder | layout put |

The type menu is the Google Forms list with a Macro group, mapped to column
kind plus widget: Short answer (Text/short), Paragraph (Text/paragraph),
Number, Multiple choice (Select/choice), Checkboxes (Select multi), Dropdown
(Select/dropdown), File upload (Link/file), Date & time (Date/datetime),
Person (Entity User), Document (Entity Document), Database row (Relation,
with a table picker). Boolean columns from an existing table show as
"Checkbox".

Hidden columns: a final row in the builder, "3 columns not on this form",
expanding to the list with an "Add" per column. It keeps "the form is the
table" visible without cluttering the questions.

Live changes from the grid: the builder subscribes to
`useDatabaseTableChangedSync` for the linked database and refetches the form
detail, so a rename in the grid shows up in the builder.

Autosave: layout puts are debounced 400ms and coalesced; ops are sent
immediately. A failed put shows a toast and refetches. Undo in this pass is
the grid's undo for column facts only; presentation edits have no undo.

### Reordering and keyboard access

Question and section handles support mouse, touch and keyboard input.
Questions move within a section and into another section, including an empty
section. A visible insertion marker identifies the destination, and dragging
near the viewport edge scrolls the builder. Inputs remain editable without
starting a drag. A drop commits one layout change; dragging never sends
intermediate layout writes.

Space or Enter picks up a focused handle, arrow keys move it, and Space or
Enter drops it. Escape, pointer cancellation and losing the window cancel
the move. Restore focus to the moved handle and announce its new position.
Also offer Move up, Move down and Move to section actions. Reject moves that
would put a gate before one of its referenced questions, with an explanation.

Use a feature-local pointer sensor. The repository's patched
`@thisbeyond/solid-dnd` uses mouse events, so its default sensor cannot cover
touch. Keep the layout reducer independent of the sensor and test pointer,
touch and keyboard behavior in the browser. This follows the explicit
non-drag alternatives recommended by the
[Pragmatic drag and drop accessibility guide](https://atlassian.design/components/pragmatic-drag-and-drop/accessibility-guidelines).
The question and section controls draw on
[Google Forms' editing workflow](https://support.google.com/docs/answer/2839737?hl=en)
while retaining Macro's column-backed schema and linear gates.

## 4. The respond page

Route `form/:id/respond`, rendered inside the app shell for signed-in users
and as a top-level route (like `publicBookingRoute`) for everyone else, so an
anonymous visitor on a public form never hits the login redirect. The page
component is shared; only the shell differs.

Header (signed in): wordmark, breadcrumb "Forms / <name>", "Responding as
<me>", "Open in Macro". Public: a slim line "Macro Forms · Public form ·
responses are anonymous", a footer with "Report this form" and the
never-share-passwords line, and a soft "Have a Macro account? Sign in to
edit your answer later" notice.

Flow (mock: the second artifact):

- Progress strip "Section 1 of 3" with a bar.
- Title card: name, description, "* required · you can edit your response
  until the form closes on Oct 3" (members audience) or "* required"
  (public).
- One section per screen. Questions render by widget (§3 table). The Person
  and Document pickers are the existing ones. File upload uses
  `uploadFile(file, 'static')` and stores `staticFileIdEndpoint(id)` as the
  Link cell; the control is hidden on public forms (the service refuses the
  combination anyway).
- Next validates the section client-side (required, basic shape) and keeps
  answers in memory; nothing is sent until Submit. Back works.
- A gate is not a screen the respondent fills; it evaluates on the server at
  submit. The client also evaluates it locally with the same `FilterGroup`
  semantics so "Next" on the section before a gate can show the stop screen
  immediately. The server is the authority; a stop from the server renders
  the same screen.
  `FormDetail` includes the gate predicates so this local evaluation can run;
  the respondent UI never renders the predicates or their editor. These
  predicates are available to a caller inspecting the response; gates are
  questionnaire flow rules, not a mechanism for keeping eligibility criteria
  secret. The server still enforces the rules on every submission.
- Stop screen: eyebrow "This form can't take your response", the gate
  message, "Nothing you entered was submitted", buttons "Check my answers"
  and "Message the owner". The rules are never shown.
- Submit posts the whole answer set. Success renders the confirmation: a
  check, the confirmation message (default "Your response is saved."), a
  receipt of the answers, "Edit my response" (members, while open), and the
  line "Stored as a row in a database the form owner controls. Your answers
  are visible to the form's editors."
- A signed-in respondent who already submitted lands on their receipt with
  "Edit my response", loaded from `/responses/mine`.
- Closed forms show the title card and "This form is closed".

Mobile: one column, sticky bar with Back and Next/Submit, native date
pickers. No special work beyond responsive CSS.

## 5. The Responses tab

It is the linked table's grid, embedded. `DatabaseGrid` takes objects, so the
tab loads `useDatabaseDetailQuery(databaseId)`, picks the table by id, builds
`allRecordsView(table)` (or the form's remembered view id, kept in
localStorage), calls `useDatabaseTableChangedSync` for the database, and
renders `DatabaseGrid` with `canEdit` from the database permission the user
holds (which the derived-access rule gives every form editor).

Above the grid: a header with the table name, the "Linked to <form>" chip,
"Open database" and "Export CSV" (the grid's existing CSV export), and four
stat tiles from `/responses/summary`: responses, stopped at gate, and two
from the table (rows, and "n% of invited" only when the form was shared into
channels, computed from the share permissions' member counts; otherwise
omitted). The grid shows every row of the table, not only this form's, by
decision: filtering would hide data from the people who own it.

## 6. Sharing and audience

`ShareButton.tsx` gets a `form` branch calling the forms permission
endpoints. Link sharing in the sense of `SharePermission` stays off for
forms (`isLinkSharingDisabledForItem` includes `form`); the public audience
is a different thing and is edited on the form. The share modal for a form
gets one extra panel above the people list, owner only:

- **Who can respond**: radio. "Workspace members: respondents sign in with
  Macro. One response per person, editable until the form closes." /
  "Anyone with the link: no sign-in, responses are anonymous unless you ask
  for a name." Below it the respond link with Copy.
- Role labels in the people list read as every entity's, with a hint under
  the panel title: "View can respond. Edit can change questions and read
  responses."
- A row for each channel the form was posted in, labelled "via channel
  post", at View.

The database's own share dialog explains derived access with the new
`ViaForm` grant: "Editor of Q4 offsite RSVP".

## 7. The database side

- Database top bar: a "Forms" chip after the table tabs when
  `useFormsForDatabaseQuery` is non-empty, listing forms over the current
  table; click opens the builder. With none, the table's "+ view" menu gets
  "Form" which creates one with `source: Table` and opens it.
- Delete-table confirmation names the forms that will be deleted with it.
- Column delete confirmation mentions "asked by <form>" when a form has the
  column as a question.
- Drive, Quick Access, activity and search list forms the way they list
  databases (same flag-gated code paths with a `form` entry).
  Drive and Quick Access use `/forms/accessible`: a form viewer can discover
  their forms without gaining access to the linked databases. This listing
  includes granted forms, not every form with a public audience.

## 8. Mentions and previews

`DocumentMention` gets a `form` match rendering the icon and name;
`DocumentCard` gets an inline body for forms (RFC 03). Preview fetchers get
`fetchFormPreviews` reading `FormDetail`.

## 9. Testing

Unit tests for the layout reducer (add, move, remove, swap column id) and
the client-side gate evaluator (table-driven, same cases as the Rust one).
A browser pass of: create from menu, add three question types, add a gate,
publish, respond as another persona in an isolated context, see the row in
Responses, create a form from an existing database, delete a column from the
grid and watch the question vanish. Record the pass with the `record-proof`
skill for the PR.

## 10. Agent guide

`docs/AGENT_GUIDE` gets a Forms page: the create door, the three tabs, the
respond route, and how to read responses (the grid). Update it in the same
change as the routes.
