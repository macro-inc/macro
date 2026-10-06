# Forms: collaboration, Preview and booking

This follow-up records the product changes requested after the first browser
review. It extends RFCs 01–03; the table remains the schema and the destination
for response rows. Delivery is one PR with a preview.

## Builder and sharing

Use Macro's theme and existing buttons, menus, inputs, sharing dialog and
calendar picker. Remove the colored title stripe, the persistent saved badge
and explanatory implementation copy. The UI calls a gate a **Screener**; the
existing `gate` protocol value remains unchanged.

The top banner contains the editable form name, description and a link to the
database. Below it, the question canvas is centered between equal-width side
panels: a numbered outline on the left, and visible question types on the right.
The outline marks the selected question or section. Question types use compact
two-column buttons with icons to the left of their labels, grouped consistently
with the Add question and type menus: Text & files, Choices, Numbers & dates,
and Linked items. From database reuses existing fields. Section, Screener and
Booking sit separately under Form flow. Medium splits retain the palette beside
the canvas; mobile and narrow splits replace it with an **Add question**
dropdown containing the same question types, existing fields and form-flow
actions. Section cards have modest spacing, and palette groups use subtle
dividers.

Required state belongs in the builder question's footer: a quiet badge while
collapsed, and the native switch at the bottom right while selected. The
respondent's required-field legend sits below the questions beside response
editing guidance; required fields keep their accessible labels and asterisks.

Question type buttons, Section and Screener controls support click to insert and
drag from the right panel to an insertion point in the canvas. Question drops
create a column only after release; Database row first opens the native table
picker, preserving the drop placement. Existing section/question handles retain
pointer and keyboard reordering, invalid-drop feedback and Escape to cancel.

The native share dialog includes the responder link and **Anyone with the
link** audience. Public respondents receive form access, not table access.
File questions still require signed-in respondents. Sharing an editing URL is
separate from copying the responder link.

**Preview** opens the respondent experience for an editor after pending edits
are flushed. It checks required answers and screeners locally, including the
stop and completion screens. It creates no response rows, uploads or bookings.
A preview booking picker may read real availability but cannot reserve a time.

## Collaborative layout

The builder uses the existing Loro manager, sync engine, local snapshots,
write-ahead log, transport and awareness. The form owns one collaboration
surface whose id is the form id. Only editors can obtain its token; respondents
read the validated form API. Public surface creation and deletion cannot take
ownership of a form's document.

The document stores sections/questions by id and their order in movable lists.
Section titles, descriptions, stop messages and question help use Loro text.
Edits change only the fields the user changed. Column definitions and form
metadata remain in their owning domains; they are not duplicated into Loro.
Awareness identifies the selected question or section.

The forms service seeds the document from the existing layout once. Durable
Loro state is the source of layout edits. The relational layout is a validated
projection, replaced together with its revision under a compare-and-set check.
Drafts with validation problems remain repairable in the builder. Malformed
or unsupported records can be repaired by an explicit SDK layout replacement
in the same document history. Respondents use the last
validated layout. Storage or sync failures are reported, never treated as a
successful save. Reads and submissions refresh from durable state, so edits
delivered before the last editor closes do not require a remaining browser to
publish them.

`POST /forms/{id}/collaboration` requires Edit and returns the form detail plus
any draft validation problem. Existing SDK layout replacements update the same
Loro document with an expected revision; concurrent replacements can return
Conflict before writing. The replacement response has the same `{ detail,
publicationError }` shape as collaboration. A publication problem after a
successful draft write is reported in that success response: `detail` remains
the last respondent version. Callers can repair the draft or read collaboration
to retry publication, without unknowingly repeating a saved write. An explicit
replacement also repairs malformed draft records while preserving document
history. Respondent reads request a shallow snapshot at the current revision,
so old edit history does not inflate each request. Purging a form retires its
owned surface.

## Names

A newly created standalone form records that it follows the database it
created. That database's name is canonical: renaming the form invokes the
database domain's rename operation, and reading the form resolves the database
name through its domain read port. Database renames therefore rename the form
without an asynchronous name-copy process.

Forms attached to an existing table keep independent names. Existing records
without creation provenance also keep independent names; migration does not
guess how they were created.

## Booking step

The builder's **Booking** control chooses an existing personal or team Macro
booking link. A form has at most one booking step, always last. Its title and
description are editable. Removing the step does not remove the calendar link.
Availability, booking, cancellation and rescheduling use the native scheduling
domain and UI.

Editors can read the booking target. Ordinary form details omit it. The server
returns an unlocked target only after validation and all screeners pass and the
response has been accepted. A stopped or failed response cannot unlock it. A
signed-in respondent's saved response exposes it only when the current saved
answers still pass the current form; a missing row or table cannot unlock it.

The final respondent action becomes **Continue to booking**. Acceptance saves
the response before showing the native time picker. A completed booking opens
the native private receipt, which remains usable by respondents outside the
Calendar authoring rollout.

Screening controls discovery of the booking link through this form. An existing
native booking URL remains usable directly; attaching it does not convert that
URL into a private or single-use booking capability.
