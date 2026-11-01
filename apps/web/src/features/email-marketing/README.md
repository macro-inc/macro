# Email Marketing

Multi-step email sequences sent from the user's own Gmail inbox, at
`/app/email-marketing` behind `enable-email-marketing` (on in dev, PostHog in
production). The flag also hides the sidebar and dock entries and the CRM
contact card.

## Storage

Records are rows in the user's own Macro database (`Email campaigns`,
`Sequence enrollments`, `Unsubscribed contacts`; shared databases are never
used), each a `Name` label and a JSON `Sequence data` cell. Rows are read from
the primary with their table version, and every write carries all table
versions, so tabs conflict instead of overwriting each other. Unreadable rows
block enrolling, deleting, and recovery actions until fixed. Campaign edits save
on every exit and never over a copy changed elsewhere.

## Sending

Enrolling freezes each personalized step and schedules one Gmail draft per step
in order, so the server sends them with Macro closed; pending steps stay out of
Mail. A reply step answers the previous queued or sent step of its own thread.
Pause, stop, delete, and unsubscribe cancel unsent drafts last step first and
stop at the first failure; steps already sent are marked, never recalled. Resume
skips past-due steps unless the contact received nothing yet. The workspace and
CRM card read the scheduler back to flag failed, missing, or stalled sends, and
the workspace can cancel scheduled sequence emails whose records were lost.
Replies are not processed.

## Layout

`core/` model and rules; `queries/` database, Gmail, and contact adapters;
`primitives/` the sequence engine and workspace state; `components/`
presentation; `views/` composition. Text lives in
`lib/i18n/locales/en/email-marketing.ts`; personal data renders under
`ph-no-capture`. Tests: `bunx vitest run src/features/email-marketing`.
