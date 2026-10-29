# calendar_events

## What it is

Part of Calendar: owns the stable `CalendarEvent` entity — parsing from
external sources (Google Calendar, Outlook, email invitations), mutation,
reminder dispatch, team availability, and provider/Postgres persistence.

## Start here

- `src/domain/models.rs` + `src/domain/events.rs`: the `CalendarEvent` entity and
  recurrence-occurrence projections.
- `src/domain/mutations.rs`, `src/domain/invitations.rs`, `src/domain/meeting_links.rs`:
  write paths — mutations, email invitations, and Macro-call meeting links.
- `src/domain/capabilities.rs`: Google's organizer-set `GuestPolicy` and the
  `ViewerCapabilities` every read surface exposes as `viewerCan`.
- `src/domain/team_availability.rs` + `src/domain/team.rs`: team sharing/availability.
- `src/domain/notes.rs`, `src/outbound/pg_notes.rs`, `src/inbound/notes_router.rs`:
  occurrence-scoped markdown links and optional team view access (feature `notes`).
- `src/outbound/google.rs`, `src/outbound/pg.rs`: Google Calendar and Postgres adapters.
- `src/outbound/pg/outlook.rs`: durable Outlook synchronization; preserve
  provider-specific coverage on discovery.
- `src/inbound/dispatch_worker.rs` + `src/outbound/sqs_dispatch_queue.rs`: reminder
  dispatch queue (feature `dispatch`/`dispatch-sqs`).

## Scope

- Owns: the `CalendarEvent` entity, its Google/Outlook/email sources, recurrence
  occurrences, reminder dispatch, and team calendar sharing/availability.
- Not here: booking links, scheduling pages, and host/attendee booking policy →
  `crates/calendar_scheduling`; the calendar service's HTTP composition root →
  `services/calendar_service`.

## Boundaries

- Depends on: `call` (feature `call-meetings`, meeting links), `macro_user_id`,
  `notification` (feature `notify`), `model_notifications`, `aws-sdk-sqs`
  (feature `dispatch-sqs`).
- Used by: `email`, `ai_tools`, `channel_bots`, `graphql_calendar`, `complete_graph`,
  `calendar_scheduling`.

## Recipes

- Add a mutation: `src/domain/mutations.rs` → `src/outbound/pg.rs` (or
  `src/outbound/calendar_service_mutations.rs` for the HTTP client adapter) →
  `src/inbound/mutation_router.rs` / `src/inbound/toolset.rs`.
- Add a reminder type: `src/domain/reminder_dispatch.rs` → `src/inbound/dispatch_worker.rs`
  → `src/outbound/notification_notifier.rs`.
- Change team availability: `src/domain/team_availability.rs` → `src/outbound/pg_team.rs`
  → `src/inbound/team_router.rs` / `src/inbound/team_toolset.rs`.

## Checks

- `cargo test -p calendar_events` (`SQLX_OFFLINE` unset).
- `cargo test -p calendar_events --features notes,postgres` covers meeting-note
  policy and its document-access integration against a migrated local MacroDB.

## Gotchas

- Keep note links separate from sync-owned occurrence rows; require a live
  occurrence and corroborated inbox copies for inherited view access. A document
  owner can unlink after losing meeting access. Document readers can discover
  only links whose meeting details they can currently see; owners also retain
  unavailable links for revocation. See
  [meeting-note access](../../docs/architecture/calendar-meeting-notes.md).
- `CalendarEvent` is the stable Macro entity; external calendars and email
  invitations are sources feeding it, and recurrence instances are queryable
  occurrence projections, not separate events — don't model them as new entities.
- Imported point (non-recurring) events must survive sync and cache round-trips
  unchanged (#7762) — a regression here silently drops user events.
- Normalize imported Google all-day events with matching start/end dates to one
  day in the adapter, including recurring instances and overrides; preserve the
  raw provider payload and keep reversed dates invalid.
- Only an organizer (or a guest the organizer lets modify) may replace an
  event's attendee list. Everyone else adds guests through `invite_guests`
  (`src/domain/mutations/invite.rs`); a guest's `update_event` attendees are
  routed there and removals are refused. Google refuses new attendees in
  `attendeesOmitted` mode (`omittedAttendeesSpecified`), so the invite writes
  the whole list Google returned plus the new guests, and a guest is refused
  (`guest_list_hidden`) while the organizer hides the guest list, since their
  copy lacks the guests it would drop. Microsoft Graph has no attendee-side
  write either: an Outlook organizer adds guests with the same full-list write
  (`email_api_client`'s `outlook/calendar/invite.rs`), and an Outlook guest may
  only answer (`guests_cannot_invite`). An Outlook organizer may not answer:
  Graph fixes the organizer's response, so `ViewerCapabilities::rsvp` is false
  and the adapter refuses an answer with `NotAttendee`.
- A guest without `edit_details` may change only what Google keeps on each
  guest's copy (reminders, availability) and add guests where allowed:
  `update_event` drops details the patch repeats at their stored value
  (`get_event_details`, the series or the addressed occurrence) and refuses
  any other detail change with `GuestsCannotModify` before inviting anyone.
  Someone neither organizing nor invited is left to their calendar access.
- Only the organizer of a Google copy sets the guest policy
  (`src/domain/mutations/guest_policy.rs`): drafts and patches carry it as
  Google's three switches, a policy equal to the stored one (or Google's
  defaults on create) is dropped, a change from anyone else is `NotOrganizer`,
  one on Outlook, which has no such switches, is `ProviderRejected`, and one
  scoped to a single occurrence or on a new out-of-office event is
  `InvalidInput`.
  `ViewerCapabilities::set_guest_policy` is therefore Google-only, and
  `organize` is the organizer signal clients read instead.
- The organizer's own copy decides the guest policy of every Macro-held copy
  of a Google meeting (`src/outbound/pg/guest_policy.rs`). Google takes 4 to
  12 seconds to carry an organizer's change to its guests' copies, and a guest
  invite in that window gets a 200 while Google drops the guest and mails
  nobody. The organizer's copy is the Google source on the calendar Google
  names as the organizer (the address for a primary calendar, the calendar id
  for a secondary one) that its inbox can write: the copy
  `organizer_copy_calendar_id` routes organizer writes through. Every upsert
  reads that source's policy and writes it to each entity of the meeting with
  that organizer (the organizer's own, when its canonical copy is the
  primary-calendar invitation, included) and to every other Google source's
  projection, across users, so a guest-side write or an invitation read-back
  echoing Google's stale switches cannot reopen inviting. Copies pair by
  `calendar_meeting_uid` and organizer; Outlook copies and snapshots take no
  part. The aligned copies' inboxes get change-log entries and refresh nudges
  (`CalendarEventWriteOutcome::aligned_copies`). An organizer whose calendar
  no Macro inbox writes still reaches guests only through Google's sync.
- Sharing an event into a channel writes an `entity_access` row on the
  sharer's copy. The `calendar_event_entity_access_cleanup` trigger deletes it
  with the event row, which covers every way a copy goes away: a delete
  through Macro, a sync tombstone or removal, a disabled calendar, and the
  `email_links` cascade when the inbox is removed. A cancelled, private or
  confidential row keeps its grants, since readers skip them and the row can
  come back. Removing one source, or cancelling one occurrence, leaves the row.
- A channel-shared event reaches a member's calendar as a snapshot, not a
  seat: `copy_shared_event` (`src/domain/mutations/copy.rs`) imports it under
  the meeting's iCalendar UID with no join link, behind the same
  `event_export` visibility query as the .ics route. Google imports only for
  the organizer or an attendee (`participantIsNeitherOrganizerNorAttendee`,
  mapped to `copy_refused`), so the body keeps the real organizer and lists
  the target calendar, accepted, as the only guest, plus the private
  `macroSnapshot` extended property. Sync stores it as `is_snapshot`, which
  grants no capability and makes RSVPs and invites fail with `snapshot`,
  since neither would reach the meeting. An invitation to the same meeting
  later lands on the snapshot's Google event (same UID, marker kept), so
  `import::is_snapshot` counts a marked copy as a snapshot only while it holds
  what the import wrote: the calendar as its only attendee, answered. Another
  attendee (a Google meeting with guests lists its organizer) or the
  calendar's row back at `needsAction` makes it the owner's seat, and the
  Postgres upsert keeps a source stored as a seat from turning back after
  they answer. Its owner changes its details only
  as a guest without modify rights would (reminders and availability), and
  may delete it. The mutation target reads the flag from the addressed
  copy's projection, since a snapshot can share its entity with the real
  meeting on another calendar of the same inbox. Google
  only: never import over a UID the calendar already holds, since an import
  updates that event in place and would strip an unsynced invitation's
  guests. The agent adds a copy with `AddSharedCalendarEvent`
  (`src/inbound/toolset/add_shared_calendar_event.rs`) only while the
  `ENABLE_CALENDAR_ADD_SHARED_EVENT` deployment switch is on (off unless set,
  like the card's `enable-calendar-add-shared-event`); without a `calendarId`
  it takes the card's only target calendar or asks which one. An event file
  forwarded by email takes the same import through
  `CalendarSnapshotImporter::import_snapshot`, fed an `EventSnapshot` that
  `crates/email`'s `invitation_import` builds from the email's saved snapshot.
  Only the channel-share path strips the Macro call
  (`EventSnapshot::without_macro_call`); a forwarded file keeps the join link
  it carries.
  The other direction, a guest forwarding their copy of an event, renders it
  through `CalendarEventForwardSource::event_forward`, which also names the
  inbox holding that copy (`meeting_copies`), and is `None` for a channel
  share or a delegated inbox's copy; `crates/email`'s `event_forward` sends
  it. The copy decides the kind (`ForwardedCopy::outside_organizer`, read by
  `forwarded_copy` from every source of the copy): Google's private copy
  (`privateCopy` in the stored raw payload, which Google sets on every
  invitation from another calendar system) that is not a snapshot, whose UID
  Google did not mint (`…@google.com`), and that names its organizer becomes a
  `METHOD:REQUEST` invitation naming only the recipients, answered to that
  organizer, as Google's own Add guests sends there. Anything else, a Google
  organizer who turned inviting off above all, keeps the `METHOD:PUBLISH`
  file naming no attendees, so a recipient can only add it to their calendar
  and nothing reaches the organizer; missing evidence falls back to it. One
  renderer serves every use: `render_event_ics` takes an `IcsPurpose`, and
  only `Forward` keeps the Macro call and adds the copy's conference link
  (`JoinLink`), which `Share` (the .ics download) and channel shares never
  carry.
- Asking to join a channel-shared event (`src/domain/join_requests.rs`) is a
  Macro-stored request, not an `entity_access` row: the grant is a provider guest
  write. Eligibility is the invite path's own `copy_capabilities` on the
  sharer's copy, so a request that can be made is one the sharer can accept,
  and accepting calls `invite_guests` as the sharer
  (`src/domain/mutations/join.rs`). A declined request stands: asking again
  is refused with `Declined` (409 `request_declined`) and never notifies the
  sharer twice. While the requester's request is pending or accepted,
  `copy_shared_event` refuses with `JoinRequestOpen`: the answer is an
  invitation under the meeting's UID, which a snapshot imported meanwhile
  would take in. A declined requester may still add a copy.
- Calendar mentions reach the agent as document mentions (`blockName`
  `calendar`), but `ReadContent` and `ReadMetadata` need document access, which
  a channel-shared event never grants. The agent reads a mentioned event with
  `ReadCalendarEvent` (`src/inbound/toolset/read_calendar_event.rs`), which goes
  through `mention_previews`: the hover card's visibility and fields.
- Google names the calendar an event was made on as its organizer, so an
  event on a secondary calendar has that calendar's id
  (`…@group.calendar.google.com`) as `organizer_email`; Google's
  `organizer.self` is not stored. An inbox organizes an event when the
  organizer is its address or a calendar it can write
  (`OwnedInbox::organizes`, fed by `owned_inboxes`' `writable_calendar_ids`),
  as Google allows, and the mention preview's `inbox_organizes` and
  `meeting_copies` apply the same rule in SQL. When such an event also lists
  the inbox's address, Google invites its primary calendar too, and both
  copies share one entity whose canonical copy is that invitation. Changes
  only the organizer may make (details, guests, guest policy, deleting) go
  through the copy on the organizer's calendar
  (`CalendarEventMutationTarget::organizer_copy_calendar_id`,
  `src/domain/mutations/organizer_copy.rs`), then the addressed copy is read
  back (`CalendarMutationProvider::refresh_event`); reminders, availability
  and answers stay on the addressed copy, written before the organizer's
  copy. Google carries the change to the invitation 15 to 30 seconds later,
  so the read-back is usually stale: the response takes the meeting from the
  organizer copy's echo, and the Postgres upsert lets a user edit through the
  organizer's copy write the meeting's title, description, location and
  visibility (stamped in `calendar_events.content_updated_at`) and its whole
  schedule, guests included. The canonical copy retakes that content only
  once it is at least as fresh, and until then `fetch_source_contents` serves
  every older copy with it, since the web shows a copy's own title. Only a
  user edit starts this; a sync of the organizer's copy leaves content to the
  canonical copy as before. A new event lists the inbox as an accepted guest
  on its primary calendar and on Outlook, but on another Google calendar only
  when it has other guests, as Google's own client does, so a solo event is
  one block.
- `viewer_can` is viewer-relative, like an attendee's `is_self`: resolve it with
  `ActorInboxes::mark_event` and the copy's source link wherever a read path
  marks the viewer, and never store it. Calendar caches refresh only the
  events the change log lists, so a change to how capabilities are resolved
  leaves cached events with the old ones until each changes; ship it with a
  migration that logs an upsert for every event it affects, as
  `20261026184741_log_events_organized_by_a_writable_calendar.sql` does for
  events a writable calendar organizes. Each connected inbox gets its own copy
  (entity) of an event, written through that inbox's grant, so the viewer
  organizes or attends a copy only as its inbox: another of their inboxes on the
  same event lends it nothing, and only that inbox's row is `is_self`. Mutations
  act as `CalendarEventMutationTarget::copy_inbox`, and so does an RSVP without
  a `responding_email`. A delegate owns no copy inbox and gets nothing beyond
  the no-attendees rule. `guest_policy` is stored on the entity row (the
  canonical copy's values) and in each source's projection, omitted there while
  it holds Google's default. Event responses always carry both;
  `StoredSourceProjection` strips them so unchanged events keep comparing equal.
  Since one meeting on two inboxes is two entities, the agent tools label every
  event they return with its calendar's name, its `inbox` and the user's
  `myRole` there (`ToolEventRole::of`), so the agent can ask or pick by inbox.
  Their descriptions set the rule: reminders and an answer may go to one copy
  if the reply names its inbox (an answer asks first when the user is a guest
  through several inboxes); a change whose effect differs by copy (details,
  guests, permissions, deleting) goes to the only copy allowed to make it, with
  the reason, or the agent asks, and guests are added from the copy the user
  organizes. The agent must never choose between the user's inboxes itself,
  whatever they look like: the SDK's CalendarNamespace overview, the delete
  and update docs and the DeleteCalendarEvent and UpdateCalendarEvent
  descriptions state the ask rule first. `domain::copies::check_copy` enforces it: such a change on a meeting
  the user holds through several of their own inboxes (`meeting_copies`) is
  refused, listing each copy and ending with the question to ask word for
  word, until `inbox` names the addressed copy's inbox. The route cannot tell
  an inbox the user chose from one the agent picked, so the wording is the
  only guard against a guess. UpdateCalendarEvent and DeleteCalendarEvent check
  every call; the update, invite-guests and delete routes check agent runs and
  any request naming `inbox` through `CalendarCopyConfirmation`, answering 409
  `copy_choice_required`. An agent run is a token with `agent_id` (in-app code
  mode) or a request carrying `x-macro-code-execution`, which
  `code_execution`'s bootstrap sets on every code-mode program's SDK requests,
  public MCP clients' included. Code-mode agents never see the calendar tools
  (`agent_code_mode::covered_by_code_sdk`), so the routes and the SDK docs are
  what reach them; the web, which opens one copy, sends no `inbox` and is not
  checked.
- Copies of one meeting pair by `calendar_meeting_uid(ical_uid)`, not the raw
  UID: Exchange gives a meeting it imports from an invitation its own UID that
  wraps the original after `vCal-Uid`, and the SQL function unwraps it, so an
  Outlook copy of a Google meeting pairs with its Google copies in
  `meeting_copies`, the mention preview, `event_export` and email invitation
  matching (`pg/invitations.rs`), where an Outlook inbox's invitation card
  resolves to that inbox's own copy and answers as it.
- Preserve the conservative OOO refresh hint on write outcomes and sync reports;
  its contract is in [team sharing](../../docs/design/calendar-team-sharing.md).
- The team out-of-office overlay (`src/outbound/pg_team/ooo.rs`) starts from
  the viewer's teammates and reaches sources through
  `calendar_event_sources_out_of_office_idx` on the source's typed
  `event_type`. Filtering on the payload's `eventType` alone makes Postgres
  unpack every source on every primary calendar in the tenant (about 1.8 s per
  call in production before October 2026).

## Related

- Rules: `.agents/rules/rust/architecture.md`, `.agents/rules/rust/db.md`
