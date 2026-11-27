# Calendar scheduling

Personal and Macro-team booking pages, event types, weekly schedules/date overrides,
collective and round-robin hosts, booking limits/buffers, custom questions, host
legacy approval management, cancellation, rescheduling, and recorded attendance. `domain::Service` owns
authorization and booking policy. HTTP adapters expose public presentation types and authenticate
management requests; PostgreSQL and the existing calendar/team domain ports supply
storage and provider operations.

## Integration

Apply MacroDB migrations `20260918164303_calendar_scheduling.sql` and
`20260918175703_scheduling_recovery.sql`, then deploy the
updated calendar service with its existing `CALENDAR_SYNC_ENABLED` setting enabled.
The migration uses PostgreSQL multiranges (PostgreSQL 14+) and `btree_gist` for
atomic host conflict exclusion. Each host needs a connected, writable primary
calendar whose grant works, and every calendar that counts toward their busy time
must be current (`macro_services/sync_health.rs`, over
`CalendarSyncHealthReader`): a calendar failing transiently still offers time
around its stored events for 45 minutes after its next sync was due (its last
successful sync; for a calendar Macro syncs daily, such as holidays from Google
or an Outlook mailbox's own read-only calendars, a day after it), while a
permanent or reauthorization failure, a calendar or inbox still on its first
sync, or a failure past that window refuses availability. A calendar with Busy
off never blocks booking, whatever its sync state. A personal link can name one of the host's
connected inboxes (`emailLinkId`): its bookings are created on that inbox's primary calendar, so the
invitation comes from that address, and the link offers no time while that calendar cannot take a
booking (removed, read-only, failing permanently or needing reauthorization). It never falls back to another inbox. A
link without one books on the primary inbox, as before; team links always do, on each host's. Each
booking pins its calendar, so changing a link's account moves only later bookings. Busy time comes from every connected calendar
the host has not turned off (the Busy switch in Settings → Calendar, stored in
`calendar_availability_preferences` and read in process, never through the
calendar service's HTTP listing), plus meetings the host is in on any calendar
(`calendar_events::domain::labels::attends_meeting`). Invitations and Google Meet links use the existing calendar mutation service.
Deployed invitations include the private cancellation/rescheduling URL.

The web entry points are Settings → Calendar, the calendar header shortcuts,
`/app/book/:profile/:slug?`, and `/app/booking/:id#token`. Existing Macro team
owners/admins can manage team scheduling; members have read access. Current
membership is checked again when booking or approving. Booking capabilities travel
in request headers/bodies, and scheduling responses disable caching. Responses to the booker (book,
receipt, reschedule, cancel) carry no hosts: a Macro user identity holds the host's sign-in address.

Event types start paused. Public pages show enabled types only. Team availability
uses the selected shared weekly schedule plus every selected host's busy calendar
and personal default availability (including that host's time zone and date overrides).
Personal profiles without an explicit default use their first schedule; hosts who have
not configured personal availability use the team schedule.
Round robin assigns one available host, favoring the least assigned host. Public
slots are displayed on the visitor's local date. Existing bookings retain their
original event/schedule snapshots for management after a link is edited or removed.
Replacement-slot requests accept `timeZone` with `date` to return starts on the
visitor's local day, across host dates and daylight-saving boundaries. Requests
without `timeZone` retain schedule-date semantics for existing clients and host
administration. The booking's own reservation and calendar event remain excluded.

Booking queries accept a half-open `from`/`to` range of start times, up to 733 days
(room for two full comparison years across daylight-saving changes). They return the
complete range or a clear error when more than 5,000 records match. The management UI starts with a 61-day range and exposes date controls so large profiles can narrow it; round-robin balancing uses aggregate host counts and is independent of this list limit. Insights must not
interpret failures as an empty dataset. Reschedule counts increase only after a
successful move; old records default to zero, without reconstructing unknown history.
Attendance defaults to unknown and may be recorded only after a confirmed meeting has
ended, by a current assigned host or profile administrator. Elapsed confirmed meetings
can be counted as completed, but this alone is not evidence of attendance.

## Verification

- `cargo test -p calendar_scheduling --features postgres,inbound` with `DATABASE_URL` pointing
  to a disposable PostgreSQL server and `SQLX_OFFLINE` unset. The SQLx integration
  tests create isolated test databases and apply the actual scheduling migration.
- `SQLX_OFFLINE=true cargo check -p calendar_service` checks production composition.
- In `apps/web`, `bun --bun x vitest run --config src/features/scheduling/vitest.config.ts`
  checks client validation and request races/retries.
- `/src/features/scheduling/browser-test/index.html` on the Vite dev server mounts
  the real scheduling components with injected sample data. It never sends invitations
  or writes hosted data; it is separate from production routes. Its Playwright suite
  (`src/features/scheduling/browser-test/playwright.config.ts`) checks a booking whose
  answer is lost and a receipt still processing.

## Operational behavior

A booking holds its host reservations before calling the provider. The HTTP routes
that book, approve, cancel, reschedule or change a booking run it on its own task, so
a caller that hangs up mid-request (a dropped connection, a closed tab) still leaves
it finished and saved within seconds; a retry of the same request returns it. An
uncertain provider write leaves the booking `failed` (or `processing` after a process
crash), with reservations retained to avoid duplicate meetings. Durable operation intents, stable
provider creation IDs, pinned calendars, and version-fenced retries recover these states after
five minutes. The calendar-service worker runs every 15 seconds and failures back off to an hour.
A refusal decided before anything reaches the provider (no writable calendar, a read-only calendar,
an event the host can no longer see) abandons the operation at once; any other failure is retried
hourly until the meeting's start time has passed, then abandoned. An abandoned booking stays
`failed` with its reservations and is never retried again; its booking carries `abandonedAt`, so
the booker's receipt and the host's dialog offer Cancel instead of saying it is retrying. A create
refused on its first attempt never reached the calendar, so cancelling it releases them without a
calendar change. Any other abandoned booking releases them once the calendar accepts the
cancellation; a calendar that refuses that too keeps them, as lost access always has, and both
views say the cancellation did not reach the host's calendar. A move the calendar refuses on its
first attempt returns the booking to its original time and status and releases the new interval;
one refused after an earlier attempt that left no recorded outcome, or that keeps failing until its
new start, stays failed at the requested time with both intervals held. Keyed deletion works even after local calendar projection
retirement. Completion-persistence failures still return the durable private receipt. Rescheduling reserves the old and new intervals until the provider
accepts the update, then releases the old interval. A booking link's daily limit likewise
counts a move whose first attempt is still waiting on the calendar on both days, so a
refusal that returns it cannot leave its original day over the limit. Replacement times for a
reschedule skip a day already at the limit, without counting the booking being moved. Calendar projections without a
source time zone for all-day events conservatively block all possible UTC offsets.

This change does not include payments, workflow automation, routing forms, advanced
analytics, or webhooks. Core booking insights are derived from authorized booking records.
New approval-only configurations and bookings are disabled until standalone host/guest
notifications exist. Existing pending records remain manageable. Confirmed meetings receive
provider calendar invitations. Shared PostgreSQL budgets cap public availability and booking
requests per profile; all booking changes use a monotonic revision to prevent stale edits.
See `docs/design/calendar-scheduling-v1.md` for rollout, rollback and monitoring queries.
It does not deploy the backend or apply migrations to shared databases.

## AI booking-link workflows

`ListBookingLinks` discovers personal links, current team IDs, reusable schedules and
full editable drafts. Pass a returned team ID to discover that team's links. Both
active and paused links include their shareable URL and profile revision.
`CreateBookingLink` and `EditBookingLink` execute directly in every host after
conversational confirmation. The agent explains the complete proposal, waits for
the user's approval, then passes that reply verbatim in required `userConfirmation`.
Missing or blank confirmation is rejected before calling the scheduling service.
As with confirmed email/calendar tools, the quote is not verified against conversation
history. There is no booking review card, elicitation, or deferred user-tool result.
The agent discovers internal identities through tools instead of asking users for IDs.
Code mode reaches the same workflows through `macro.calendar.booking` in the SDK, over
`GET/POST /scheduling/links` and `PUT /scheduling/links/{id}`; the HTTP writes take the
same required `userConfirmation`.

The scheduling service owns authorization and validates the complete draft. Edits
replace only the chosen event type; changed hours use a separate schedule to
preserve other links and personal default availability. All writes retain the
profile's compare-and-swap fence. An identical create at an existing slug or an
identical edit is a no-op; a conflicting slug or stale edited revision fails and
requires reading and reviewing the current state. Creation returns actual saved
identities and URLs. Paused links cannot accept bookings, and creating a link never
sends invitations. Guest booking still uses the normal calendar-readiness and
availability checks. This workflow has no Forms dependencies.
