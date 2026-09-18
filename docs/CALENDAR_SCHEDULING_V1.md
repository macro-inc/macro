# Scheduling v1 parity

Reference: signed-in Cal.com Links, event editor, Bookings, Availability, Teams,
and Insights, inspected September 18, 2026. Macro keeps its own identity and UI
primitives while using the same sidebar/page hierarchy, settings sections,
bordered lists, metric strips, and chart layout. Themes use Macro semantic tokens;
the isolated browser fixture defaults to the light reference appearance.

| Core workflow | Implemented |
| --- | --- |
| Personal booking links | Event CRUD, duration, description, URL slug, location/Google Meet, pause, duplicate, copy and preview |
| Booking form | Required name/email and configurable questions |
| Availability | Multiple named schedules, explicit default, weekly ranges, per-day enable/add/remove/copy, timezone, date overrides, deletion protected while in use |
| Scheduling policies | Notice, horizon, buffers, slot interval, daily limits; DST-aware server slot calculation and atomic conflict reservations |
| Team scheduling | Existing Macro membership and permissions, collective and round robin; team hours intersect configured personal default hours and busy calendars |
| Guest booking | Public links, visitor timezone, slots, confirmation, private cancellation/reschedule receipt; provider invitations and Google Meet |
| Booking management | Upcoming/unconfirmed/past/cancelled, search/event/timezone filters, guest/host/answer details, legacy-request approval, cancellation confirmation, reschedule, attendance/no-show recording |
| Insights | Personal/team scope, 7/30/90/custom dates, event/host filters, prior-period comparisons, completed/rescheduled/cancelled/no-show counts, scheduled meeting hours, duration, trends, hourly totals, event/host rankings, CSV |
| Calendar integration | Existing connected calendars and permission checks, busy conflict exclusion, provider event create/update/cancel |
| Macro entry points | Calendar settings tab; copy booking link and scheduling settings in calendar header; standalone public and receipt routes |

## Reporting semantics

Reports group bookings by their current start date in the profile default
schedule's timezone. Previous-period queries include equal calendar-day windows
across DST. Completed means confirmed bookings whose end time has passed,
excluding recorded no-shows; actual call duration is not tracked. Rescheduled
counts bookings with at least one recorded successful reschedule, once per
booking. No-shows require an explicit host/admin record. Categories may overlap.
Failed and processing provider operations are excluded. Oversized queries return
an actionable error instead of silently dropping records. CSV exports the filtered
current-period bookings and escapes spreadsheet formulas.

## Deliberate deferrals and remaining gaps

- Payments, routing forms, workflows/webhooks, recurring group classes, ratings and
  CSAT collection are outside this core scheduling release. Unsupported metrics
  are not shown as invented zeroes.
- New manual-approval links are disabled in the UI and rejected by the backend until
  host/guest notifications are implemented. Existing pending records can still be managed.
  Legacy approval links are paused for new bookings until automatic confirmation is enabled.
- Provider writes have durable, version-fenced recovery. Create uses a stable organizer-scoped
  provider ID; cancellation can replay after the canonical calendar record disappears.
  Uncertain writes retain reservations, return a private receipt, and retry automatically.
  Repeated failures require operator attention; see the release checklist below.
- Hosted activation still requires both scheduling migrations and the updated email
  service. The port 3007 browser fixture uses explicitly labelled sample data and
  the real UI components; its mutations do not send invitations or change Cal.com.

## Verification

Unit/integration tests cover timezones/DST, comparisons, exports, async races,
status filtering, authorization, attendance, host availability, and transactional
reservations. Browser checks cover page navigation, filters, chart interactions,
CSV trigger, no-show-to-insights updates, defaults, schedule deletion protection,
read-only scopes, event creation, and both themes. See the crate README for backend
setup and operational details; `docs/AGENT_GUIDE/surfaces.md` describes the UI.

Pre-production checks also exercise lost provider responses and duplicate-provider
conflicts, database completion failures, recovery lease takeover, repeated cancellation,
and shared request budgets. The browser's lost-response fixture verifies that a guest
retries the same booking request and receives its existing receipt. Narrow 390px
layouts were checked for event types, availability, insights, and confirmation.
These fixture checks do not replace the connected-account rollout checks below.

The pre-production pass ran 36 scheduling tests (including PostgreSQL and HTTP),
140 calendar-domain/provider tests, and 23 frontend tests. TypeScript, the email-service
composition check, scheduling Clippy (all features/targets), and `just check` passed.
Five review passes completed after fixes.

An isolated full local stack also applied both migrations and verified actual sign-in,
personal event creation/editing/duplication, persisted weekly-hour edits, collective team
host selection, read-only team membership, and team Insights. This caught and fixed editor
cloning of Solid Query store proxies; the preview now uses reactive store inputs too.
A disconnected host correctly exposes no bookable slots and shows an availability error.
Real Google OAuth, invitations, and Meet remain the connected-account rollout gate.

## Pre-production release checklist

- Apply `20260918164303_calendar_scheduling.sql`, then `20260918175703_scheduling_recovery.sql`
  before deploying the email service. Both are additive; the second adds a nullable retry
  timestamp, partial recovery index, and bounded per-profile request budgets.
- Keep the existing `CALENDAR_SYNC_ENABLED` switch enabled for scheduling routes and recovery.
  New configuration cannot turn on manual approval. Automatic provider invitations remain active.
- Database-backed HTTP checks cover authorization, configuration, public slots, idempotent booking,
  private receipts, failed-write recovery, rescheduling and cancellation. External identity and
  Google are controlled in these tests; they do not prove real OAuth, email delivery, or Meet creation.
- Before rollout, complete one personal and one team booking with dedicated connected test accounts;
  confirm busy-time exclusion, invitation delivery, Meet, reschedule and cancellation. Test revoked
  access and restored access. Do not use a live customer's calendar as a fixture.
- Roll back the service/frontend to the version before scheduling if necessary; retain both additive
  migrations and every booking/claim. Do not delete reservations to clear a failure. Drain/reconcile
  pending intents before re-enabling scheduling on any older implementation without recovery.
- Shared profile budgets allow 120 availability requests/minute and 30 new booking attempts/hour.
  They fail closed if storage fails and are independent of replica count. They are backpressure,
  not human verification: gateway/IP abuse monitoring remains part of normal service operations.

## Recovery and monitoring

The email service polls every 15 seconds, at most 25 operations per pass. Each claim has a
five-minute lease, an incremented operation attempt, and a booking revision. All edits use the
revision, protecting against confirmed → processing → confirmed races. Provider errors back off
from five minutes to one hour; the third recovery attempt emits an operator-attention error.
Completed claims clear their due timestamp. Disconnected/inaccessible calendars keep reservations
until access is restored; recovery never interprets lost permission as a successful deletion.

Use the email-service logs for `scheduling operation queued for recovery`, `scheduling operation
recovered`, `scheduling recovery requires operator attention`, and `scheduling completion persistence
unavailable`. Alert on operator-attention/persistence errors and sustained scheduling 5xx. During
rollout, also check overdue rows so a stopped worker cannot hide behind missing logs:

```sql
SELECT status, count(*) AS bookings, min(recovery_at) AS earliest_retry
FROM scheduling_booking
WHERE status IN ('processing', 'failed')
GROUP BY status;

SELECT id, status, recovery_at, record->'operation'->>'attempt' AS attempts
FROM scheduling_booking
WHERE status IN ('processing', 'failed')
ORDER BY recovery_at NULLS FIRST
LIMIT 100;
```

These queries omit guest details and private management tokens. Investigate any due timestamp
more than ten minutes overdue; check worker health, calendar grant/sync state, then provider logs.
Do not manually release claims or reset database volumes. Permanent provider rejection needs a
reviewed resolution; retrying cannot repair a revoked grant or deleted target calendar.
