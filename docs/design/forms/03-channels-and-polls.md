# RFC 03: Forms in channels, and `/poll`

Status: accepted for the first pass. Depends on RFC 01 and 02.

## 1. Mentioning a form

`@` a form anywhere Lexical runs. The collapsed mention is the standard
icon-plus-underlined-name inline chip from `DocumentMention`, nothing
special. Converting it to a card (`$convertMentionToCard`) renders
`DocumentCard` with a form body: the respond page's section renderer in
compact mode, filling inline, with a header row showing the form icon, name,
a "can respond" or "can edit" pill, the current section, and Open and
Minimize actions.

`ValidNestingCombinations` gets `form` nestable in `channel` and `md`, which
is what makes `DocumentCard` show the inline body. Mobile keeps the chip
collapsed and opens the respond route on tap; the card body is too narrow to
fill there.

The inline body is the same component as the respond page with
`compact: true`; the only differences are density and that Submit shows the
confirmation inside the card. Answers are per viewer, in memory, never in
the message.

## 2. Posting grants view

Referencing an entity in a channel today grants the channel the level
`reference_sharing::grant_level` decides. Forms are the exception the brief
asked for: `ReferencedShareItemType::Form` maps to `EntityType::Form` with a
fixed `View` grant, in
`crates/channels/src/outbound/pg_channel_reference_share_permissions.rs`.
Edit is never granted by posting. The share modal lists the channel at View
"via channel post", and removing it there revokes it.

Respondents reached this way are channel members, so they are signed in; a
form with the members audience works as-is. The public audience is
orthogonal.

## 3. `/poll`

`/poll` is an action in the channel composer's `additionalActions`
(`lib/core/messages/configured-message-editor.ts`), shown when
`sourceBlockName` is a channel and the flag is on. The command list also
gets `/form`, which opens the create flow and inserts the mention when the
builder is saved.

`/poll` opens a small inline composer in place of the menu: a question
field, two option fields with "Add option", and two toggles, "Multiple
answers" and "Show results to respondents" (default on). The latter controls
`tally_visible`: off keeps tallies editor-only, including after a response.
The label must not promise after-vote results that this flag does not grant.
Posting it:

1. `POST /forms` with `source: New`, `name` = the question. The service
   makes the database "<question>" with table "Responses" (RFC 01 §6).
2. One ops batch: `Column Create` of a Select column named "Answer", `multi`
   per the toggle, with the options under client-minted ids.
3. `PUT /forms/{id}/layout` with one section and that question, `required`,
   widget `choice` or `checkboxes`.
4. `PATCH /forms/{id}` with `tally_visible` per the toggle.
5. Insert the mention into the composer as a card, and send.

So a poll is a form with one question, and the channel post grants view.
Its renderer is the card body in poll mode, which `DocumentCard` chooses
when the form has exactly one Select question and `tally_visible`: the
question, one bar per option with its count from `/forms/{id}/tally`, the
viewer's own vote marked, "19 votes · one vote each", and a "results" link
that opens the Responses tab for editors or the tally for everyone else.
Voting is a submission; changing a vote is `PUT /responses/mine`. Tallies
refresh on `database_table_changed` for the poll's database, which the
card subscribes to while mounted.

Every poll makes a database that appears in Drive. Decided and accepted for
this pass; if it proves noisy the fix is a Drive filter, not a different
model.

## 4. Document bodies

The same mention and card work in documents. A form card in a document is
the inline body; a poll in a document is the poll renderer. No document
specific code beyond the nesting rule.

## 5. Notifications

None in this pass beyond activity. "X responded to your form" as a
notification kind is a follow-up once the magic-chip notification kinds
settle.
