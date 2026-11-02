# Calendar meeting notes

Meeting notes link Markdown documents to a one-time meeting or one occurrence of a
recurring meeting. Each occurrence can have multiple notes, created from event
details or linked from the owner's existing documents.
They reuse the document's content, editor, collaboration, and ownership; calendar
sync does not copy or own that content.

## Access contract

- The document owner explicitly links it and optionally chooses one current team.
- Authenticated full-detail meeting viewers inherit **view** access. Busy-only
  visibility, snapshots, and anonymous links do not qualify.
- The selected team's current members independently receive **view** access.
  Team access does not expose the calendar event itself.
- `team_user_user_id_unique` restricts each account to one current team; the
  optional checkbox uses that membership, with no subteam picker.
- Existing ownership, editor, public, and other document grants remain unchanged.
- Unlinking removes only this occurrence's meeting/team grant, never the document.
  An owner can revoke it from the document's Share panel, SDK, or API even after
  losing meeting access.

`calendar_event_notes` stores `(event_id, occurrence_key, document_id)`, an optional
`team_id`, and the linking user. Recurring links use the original-start key, which
survives rescheduling that occurrence. One-time meetings use the canonical key
`single`, so moving their start time preserves notes and old API handles. The API
accepts the current calendar occurrence key for either kind; owner link listings
return `single` for a one-time meeting. Links intentionally have no occurrence foreign key: provider
sync replaces occurrence projections. Event, document, and linking-user deletion
cascade links; team deletion clears only the additional audience.

## Shared authorization

`calendar_note_event_visible` is used by both note reads and the ordinary document
access boundary. It checks the primary database on every authorization. A caller
must have a live full-detail copy through inbox ownership/delegation, a current
channel grant, or current full-detail team calendar sharing. Team projections
also require fresh, successful source snapshots and non-private event/override
visibility. Existing document permissions are checked first; the fallback never
elevates above view.

Different inbox copies have different event IDs. Matching iCalendar UID and
organizer alone is insufficient: each inbox must be corroborated by the other
copy's organizer or effective occurrence guest list. This prevents both reading
real notes from a fabricated event and injecting notes into a real meeting.
`calendar_note_copies_match` also checks the requested event against the note
anchor directly, even if the viewer separately has access to both meetings.
Both copies must have a live materialized occurrence. Provider cancellation
often removes an instance rather than storing a cancelled row; missing instances
therefore fail closed. If an old occurrence leaves the sync window, its inherited
grant stops until it is synced again. Durable links and independent document/team
grants remain. Hidden guest lists may also require an explicit document share.

Writes use an owner-level document receipt. Only live markdown is accepted;
additional team sharing requires current membership. A document-scoped advisory
transaction lock serializes link/unlink across equivalent inbox copies. Relinking
updates the existing grant and removes duplicates across those copies.

## Surface and API

The remote web flag `enable-calendar-meeting-notes` gates both event-details
surfaces and document Share meeting-link management before their query sources
mount. It defaults on in development; production falls through to PostHog, with
the initial rollout intended for `@macro.com` users. The local override is
`VITE_ENABLE_CALENDAR_MEETING_NOTES`. This is a UI rollout, not an authorization
boundary: backend/SDK operations and persisted grants retain the access contract
above when the web flag is off.
The Share panel retains known shared status and otherwise uses a neutral
restricted-link label while meeting access cannot be checked with the flag off.

The web feature lives in `apps/web/src/features/calendar-notes`, with an injected
data source, query adapter, controller, and presentational view. It mounts within
desktop and mobile event details. Its shared dialog becomes a phone sheet with
`Dialog.contentOwnsScroll`: only document results scroll, while context, sharing,
and actions stay visible. Choices survive failures. Note options use labeled menu
actions; **Share** opens the existing document Share dialog, whose Meeting links
section owns optional team access. The host dialog guard follows the menu and
Share dialog, and clears
when a note disappears during a live refresh.
**Create** and **Link** stay beside the section title so additional notes can be
added without leaving the meeting. **Create** uses the standard Markdown creation
flow, links the resulting document with no team grant, then opens the editor. It
captures the account and occurrence before creation starts, suppresses duplicate
clicks, and retains the created document for retry if linking fails. A disposed
view never navigates on a late result. There is no separate calendar-owned content
store or create endpoint.

The document References section lists meeting links alongside document and
message references. Readers need document view access and current full-detail
meeting access to discover a link. Owners also retain unavailable links; their
labels stay safe. Calendar previews resolve titles and times through the viewer’s
projection. Opening a reference uses the viewer’s own copy when available, or
the existing read-only event preview otherwise. The note flag gates this query
before it mounts.

The links response includes `canViewMeeting` and an optional exact `event`
preview, which References uses without another lookup. During a rolling deploy,
an older calendar service can omit those fields. Missing projection fields mean
the reference is unresolved, not that meeting access was denied; the dialog
offers Retry on the links query. It never substitutes a broader mention lookup
for the server's source-scoped authorization. An explicit `canViewMeeting: false`
still means the linked meeting is unavailable to the reader.
It also includes an optional `teamEvent` projection, resolved through
the same source entitlement reader and sanitizer as the team calendar. It never
borrows canonical details, includes busy-only content, or substitutes a nearby
occurrence. References previews expose no channel-share actions. A `single` link
can follow a moved one-time event, but cannot become a link to a new recurring
series.

The document Share panel also lists owner-only durable links, immediate optional
team access controls, and inline unlink confirmation. That list does not require
current meeting access. It uses
generic labels for inaccessible or indirectly shared meetings, so it cannot reveal
a richer canonical event title through a restricted provider projection.
The standard Team access control includes the current team's meeting-derived
view grant: it shows **View via meeting** when there is no direct team grant.
**Use meeting access** removes only additional direct team sharing; the meeting
checkbox still owns its independent grant. A team save does not disable or
remount the Unlink trigger, and destructive writes remain serialized.

Event notes and document links remain cached per account and target for five
minutes, with a 30-second freshness window and mutation invalidation. Event
Create and Link actions do not wait for the notes request. The picker immediately
uses the app's owned Markdown Quick Access candidates, then adds server title
matches. Matching previous results remain visible during the debounced request;
search responses are fresh for a minute and cached for five minutes. Previous
results never carry across accounts. This supplements the existing owned-note
endpoint; it does not use the full-text search backend.
Picker server reads emit `calendar.notes.search` and a server phase with meeting
ID, query length, configured debounce, local/remote result counts, and outcome.
Quick Access retains its existing search-page and materialization traces. Search
text and document names are not recorded.

The calendar service mounts these authenticated routes even when provider sync is
disabled. Every response is private and non-cacheable:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/meeting-notes/documents?query=` | Up to 30 owned markdown suggestions and current teams |
| GET | `/meeting-notes/documents/{document_id}/links` | Visible links for document readers; owners also receive unavailable grants |
| GET | `/events/{event_id}/notes?occurrenceKey=` | Notes visible through this occurrence |
| PUT | `/events/{event_id}/notes/{document_id}?occurrenceKey=` | Link/update with `{ "teamId": null }` or a team UUID |
| DELETE | `/events/{event_id}/notes/{document_id}?occurrenceKey=` | Idempotently unlink the owned document |

The gateway prefixes these paths with `/calendar`. The SDK exposes
`calendar.noteDocuments`, `CalendarEvent.notes`, `CalendarEvent.linkNote`,
`Document.meetingNotes`, `CalendarNote.setTeam`, and `CalendarNote.unlink`. Event methods accept the
occurrence record returned by calendar reads and reject an event mismatch.

Deploy the additive migration before the updated calendar/document services and
web client. Operation spans use `calendar.notes.*`; the ordinary authenticated
service client and HTTP middleware propagate trace context. Browser fixtures use
an in-memory source, while SQLx tests exercise real authorization and migrations.
