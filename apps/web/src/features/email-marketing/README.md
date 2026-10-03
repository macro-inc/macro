# Email Marketing v1

Email Marketing is a standalone outer-sidebar module at `/app/email-marketing`.
It owns campaigns containing ordered email steps, enrolls existing Macro/Gmail
contacts, and resolves optional CRM contact IDs by normalized email. CRM contact
overviews render the same enrollment records. CRM is not required.

## Storage and delivery

Production uses the existing authorized Macro Databases REST ops and GraphQL
row source. It creates an `Email Marketing` database with `Email campaigns` and
`Sequence enrollments` tables on the first campaign write. Discovery reserves
those names. The database remains private until the user shares it through the
existing database permission controls. Both table versions guard enrollment
reservations and writes, including a campaign pause racing with an enrollment.
Human-readable name, status, and contact email columns accompany a validated
JSON sequence snapshot. Activation saves a sending snapshot; enrollment content
is frozen at enrollment time.

Subject and body fields use the same Lexical/Loro editor and collaboration
provider as markdown documents. Each field has a stable collaborative surface
ID derived from its database, campaign, step, and field. The database is the
permission parent: its viewers/editors receive matching sync token access.
This PR adds database parents to the existing backend surface allowlist, so the
backend change must deploy with the frontend. No new persistence schema is needed.
Draft content syncs live independently of the explicit metadata/sending-snapshot
save. Both fields must initialize successfully before saving or activating;
connection failures expose retry controls. Active cards display the frozen
snapshot, so later edits from a stale draft tab cannot change queued messages.

Each email card reuses `ComposerSurface`, the actual email composer's chrome,
including its light-mode shadow and dark-mode glass rim and raised shadow.
The editor supports markdown formatting, but v1 delivery serializes plain text;
formatting does not imply HTML email sending. Campaign names, step order,
delays, and enrollment controls retain database version checks rather than
character-level collaboration.

The existing Gmail draft/scheduled-message API provides server-side delivery;
no browser timer or new sending service is needed. Draft handles are persisted
before scheduling. Partial failures attempt to cancel every created draft and
retain a visible recovery state. A start time at least ten minutes away provides
room for persistence and rollback. Enrollment batches are limited to fifty
contacts in the UI. Duplicate addresses in a campaign are blocked even when the
prior enrollment has stopped. Database conflicts are shown without silently
retrying an insert. Pause/resume uses the enrollment's original snapshot;
resuming never repeats a past-due step. Cancellation distinguishes the backend's
actual delivery-started response from other failures and never deletes a sent
message.

## Deliberate v1 boundaries

- Plain-text, manually enrolled sequences with day-based delays, personalized
  subjects/body, previews, Gmail inbox selection, and pause/stop/resume controls.
- Replies, unsubscribe requests, and delivery failures require manual handling.
  The consent check and appended reply-unsubscribe text make that visible.
- Scheduled/due states are not delivery receipts. No claimed open/click/reply
  analytics, automatic stop-on-reply, webhook suppression, or global opt-out list.
- No SendGrid credentials, bulk-sending server, billing integration, or separate
  sequence usage meter is introduced. Delivery settings state this explicitly.
- Database record tables are editable by permitted database editors; missing or
  malformed sequence data causes an error rather than an empty audience.
- This implementation has not been deployed. Production API adapters were
  checked against the repository's current API types and backend behavior;
  live authenticated sending was not available in the execution environment.

## Provider research

Google Workspace generally allows 2,000 messages per user per rolling day, with
lower trial limits and additional recipient limits. Account-level limits apply
to Gmail API sending too; normal inbox sends consume the same allowance. Do not
treat a fifty-contact UI batch as an enforcement of the account's daily quota.
Source: <https://support.google.com/a/answer/166852>.

For bulk sending, implement SendGrid as a server-side delivery adapter with a
mail-send-scoped API key, verified sending domain, unsubscribe groups and
suppression checks, and signed event webhooks. Its `send_at` supports only
72 hours in advance, so longer sequences need a Macro worker that submits each
due step. HTTP 202 is acceptance, not delivery. Keep API keys off the browser;
make billing a deliberate choice between customer-owned provider accounts and
Macro-managed subusers with quotas/usage metering. No provider price is promised
by this implementation.
Sources: <https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send>,
<https://www.twilio.com/docs/sendgrid/ui/sending-email/sender-verification>,
<https://sendgrid.com/en-us/pricing>.

## Verification and video

Use Bun as documented in `apps/web/AGENTS.md`:

```sh
bunx vitest run src/features/email-marketing \
  src/lib/service-clients/service-storage/email-marketing.test.ts \
  src/lib/service-clients/service-email/sequence-cancellation.test.ts
bunx playwright test --config src/features/email-marketing/browser-test/playwright.config.ts
NODE_OPTIONS=--max-old-space-size=10000 bun run type-check
```

The browser fixture mounts the production view, production sequence engine, and
the actual outer-sidebar navigation definitions with isolated local storage and
a simulated Gmail scheduler. Shared-content tests use real Loro managers,
Lexical editors, history, and collaboration providers; browser locks and
BroadcastChannel replace only the authenticated server transport. Its CRM panel exercises the same enrollment-card
component mounted in the production CRM overview. The fixture is labeled and
never sends real emails. Browser coverage includes creation, editing, adding
steps, personalization, activation, enrollment, scheduled payloads and delays,
CRM cross-reference, pause/resume/stop, reload persistence, duplicate blocking,
readonly controls, a mobile viewport, two-client concurrent editing,
unsaved-content reload persistence, focus retention during typing/reordering,
frozen activation snapshots, dark composer shadows, and initialization retry. Unit coverage includes reservation
conflicts, malformed records, sender routing, actual GraphQL aliases/pagination,
partial scheduling rollback, cancellation recovery, and stale-tab actions.
