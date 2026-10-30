# Email Marketing

Multi-step email sequences sent from the user's own Gmail inbox, at
`/app/email-marketing` behind the `enable-email-marketing` flag (on in dev,
PostHog in production). The flag hides the sidebar item, redirects the route
once flags load, and hides the enrollment card on CRM contacts.

## Storage

Records live in the user's own Macro database, found by its tables
(`Email campaigns`, `Sequence enrollments`, `Unsubscribed contacts`) and
created on the first write. Shared databases are never adopted: delivery acts
on the signed-in user's inbox. Each row has a `Name` label and a JSON
`Sequence data` cell; a campaign's `Name` edited in the database view renames
it. Rows that no longer parse are counted and block enrolling until fixed.
Every write sends all table versions. A write that loses to an unrelated
change retries only while its own record is untouched and what it depends on
still holds (campaign active, address subscribed). Edits to an open campaign
save only over the stored copy they started from.

## Sending

Enrolling freezes each personalized step, then creates and schedules one Gmail
draft per step in order, so the server sends them with the tab closed. A
batch that runs long starts later contacts later instead of failing.
Scheduled steps are marked as sequence sends, which keeps them out of Mail's
Drafts and Scheduled lists. A follow-up marked "reply in the same thread"
replies to the previous scheduled or sent step (`Re:` plus the thread's first
subject); with no earlier step left it starts a new thread. Pause, stop,
delete, and unsubscribe cancel unsent drafts at their stored generation; sent
email is never recalled.

Opening the workspace or a CRM contact reads the scheduler back, so failed,
missing, stalled, or interrupted sends and disconnected inboxes show as
needing attention. The workspace also lists every inbox's scheduled sequence
emails, so ones whose records were lost (a trashed database, a deleted table)
can still be canceled, and stops enrollments whose campaign row is gone.
Unsubscribing an address stops it in every campaign and blocks enrolling it
again. Replies are not processed automatically.

## Layout

`core/` model, errors, and attention rules; `queries/` database, Gmail, and
contact adapters; `primitives/` the sequence engine and workspace state;
`components/` presentation; `views/` the workspace and campaign detail.
User-facing text is in `lib/i18n/locales/en/email-marketing.ts`; errors carry
codes that views translate.

## Checks

```sh
bunx vitest run src/features/email-marketing
bunx playwright test --config src/features/email-marketing/browser-test/playwright.config.ts
```

The browser fixture mounts the production view and engine over local storage
and a simulated scheduler. It never sends email.
