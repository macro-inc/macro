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
updated email service with its existing `CALENDAR_SYNC_ENABLED` setting enabled.
The migration uses PostgreSQL multiranges (PostgreSQL 14+) and `btree_gist` for
atomic host conflict exclusion. Each host needs a connected, writable primary
calendar with calendar sync ready. All connected calendars are checked for busy
time. Invitations and Google Meet links use the existing calendar mutation service.
Deployed invitations include the private cancellation/rescheduling URL.

The web entry points are Settings → Calendar, the calendar header shortcuts,
`/app/book/:profile/:slug?`, and `/app/booking/:id#token`. Existing Macro team
owners/admins can manage team scheduling; members have read access. Current
membership is checked again when booking or approving. Booking capabilities travel
in request headers/bodies, and scheduling responses disable caching.

Event types start paused. Public pages show enabled types only. Team availability
uses the selected shared weekly schedule plus every selected host's busy calendar
and personal default availability (including that host's time zone and date overrides).
Personal profiles without an explicit default use their first schedule; hosts who have
not configured personal availability use the team schedule.
Round robin assigns one available host, favoring the least assigned host. Public
slots are displayed on the visitor's local date. Existing bookings retain their
original event/schedule snapshots for management after a link is edited or removed.

Booking queries accept a half-open `from`/`to` range of start times, up to 733 days
(room for two full comparison years across daylight-saving changes). They return the
complete range or a clear error when more than 5,000 records match. Insights must not
interpret failures as an empty dataset. Reschedule counts increase only after a
successful move; old records default to zero, without reconstructing unknown history.
Attendance defaults to unknown and may be recorded only after a confirmed meeting has
ended, by a current assigned host or profile administrator. Elapsed confirmed meetings
can be counted as completed, but this alone is not evidence of attendance.

## Verification

- `cargo test -p calendar_scheduling --features postgres,inbound` with `DATABASE_URL` pointing
  to a disposable PostgreSQL server and `SQLX_OFFLINE` unset. The SQLx integration
  tests create isolated test databases and apply the actual scheduling migration.
- `SQLX_OFFLINE=true cargo check -p email_service` checks production composition.
- In `apps/web`, `bun --bun x vitest run --config src/features/scheduling/vitest.config.ts`
  checks client validation and request races/retries.
- `/src/features/scheduling/browser-test/index.html` on the Vite dev server mounts
  the real scheduling components with injected sample data. It never sends invitations
  or writes hosted data; it is separate from production routes.

## Operational behavior

A booking holds its host reservations before calling the provider. An uncertain
provider write leaves the booking `failed` (or `processing` after a process crash),
with reservations retained to avoid duplicate meetings. Durable operation intents, stable
provider creation IDs, pinned calendars, and version-fenced retries recover these states after
five minutes. The email-service worker runs every 15 seconds; repeated failures back off and
emit operator-attention errors. Keyed deletion works even after local calendar projection
retirement. Completion-persistence failures still return the durable private receipt. Rescheduling reserves the old and new intervals until the provider
accepts the update, then releases the old interval. Calendar projections without a
source time zone for all-day events conservatively block all possible UTC offsets.

This change does not include payments, workflow automation, routing forms, advanced
analytics, or webhooks. Core booking insights are derived from authorized booking records.
New approval-only configurations and bookings are disabled until standalone host/guest
notifications exist. Existing pending records remain manageable. Confirmed meetings receive
provider calendar invitations. Shared PostgreSQL budgets cap public availability and booking
requests per profile; all booking changes use a monotonic revision to prevent stale edits.
See `docs/CALENDAR_SCHEDULING_V1.md` for rollout, rollback and monitoring queries.
It does not deploy the backend or apply migrations to shared databases.
