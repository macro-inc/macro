# Email Marketing

`/app/email-marketing` runs multi-step email sequences from the signed-in
user's own Gmail inbox. The view, its rail button (paper plane, `g k`), its
mobile dock entry and the enrollment card on CRM contacts exist only with the
`enable-email-marketing` flag (on in dev, PostHog in production; override with
`VITE_ENABLE_EMAIL_MARKETING`). A deep link with the flag off goes to Home once
the flag resolves.

Enrolling schedules real email in a real inbox. Against hosted dev data, use
your own addresses, and stop or delete what you enroll when you are done.

## Where it is

- Desktop: **Email Marketing** on the sidebar rail. Its own sidebar has
  **New campaign** and the sections **Campaigns**, **Contacts**,
  **Unsubscribed**, and **Delivery**.
- Mobile: **Email Marketing** in the bottom dock (or **More views** when the
  dock is full). The sections are icon tabs in the header.

## Create a campaign

1. **New campaign** (sidebar, the Campaigns header, or the empty state).
2. Name it, pick **Welcome series · 2 emails** or **Blank sequence**, and
   **Create campaign**. The campaign opens on its **Sequence** tab.
3. Choose **Send from** (a connected Gmail inbox), then edit each email's wait,
   subject, and message. `{{firstName}}`, `{{name}}`, and `{{email}}`
   personalize; **Send as a reply in the same thread** makes a follow-up reply
   to the previous email. **Preview** shows an email exactly as a chosen
   contact receives it, opt-out line included.
4. **Save draft**, or **Activate** to validate and allow enrolling. An active
   campaign is read-only until **Pause campaign**.

Unsaved edits save on every exit: Back, another section, **New campaign**, or
leaving the view. When they can't be saved (an empty name, a change from
another tab), the error shows in the banner and **Discard my changes** next to
"Unsaved changes" drops them.

## Enroll contacts

On an active campaign: **Enroll contacts**, check people (Macro, Gmail, and
CRM contacts; **Search CRM** finds more, and earlier picks stay checked across
searches), set **Start sending** (at least 10 minutes out), confirm permission,
and **Enroll N contacts** (up to 50 at a time). Each contact gets one scheduled
Gmail draft per email, which sends with the tab closed and stays out of Mail's
Drafts and Scheduled lists. The **Enrollments** tab shows each person's steps
with Pause, Resume, Stop, and **Mark unsubscribed**; **Open email** opens a
step's thread in Mail.

## Where records live

Campaigns, enrollments, and unsubscribes are rows in the user's own Macro
database, in the tables `Email campaigns`, `Sequence enrollments`, and
`Unsubscribed contacts`, created on the first write. **Delivery → Open
database** opens it. A CRM contact's page shows its enrollments in the Email
Marketing card.

## Verify without sending

`bunx playwright test --config src/features/email-marketing/browser-test/playwright.config.ts`
(from `apps/web`) mounts the real workspace over local storage and a
simulated Gmail scheduler; it never sends email. See the feature's
[README](../../apps/web/src/features/email-marketing/README.md).
