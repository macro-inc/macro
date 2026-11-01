# Email Marketing

`/app/email-marketing` runs multi-step email sequences from the signed-in user's
own Gmail inbox. It, its rail button (paper plane, `g k`), its mobile dock entry,
and the CRM contact card exist only with `enable-email-marketing` (on in dev).
Enrolling schedules real email: on hosted dev, use your own addresses and stop or
delete what you enroll.

- **Create:** **New campaign**, pick a template, then choose **Send from** and
  edit each email (`{{firstName}}`, `{{name}}`, `{{email}}`; **Send as a reply in
  the same thread** for follow-ups). **Preview** shows what a contact receives.
  **Activate** to allow enrolling.
- **Enroll:** **Enroll contacts** on an active campaign, pick people (**Search
  CRM** for more), set **Start sending** (at least 10 minutes out), and confirm.
  The **Enrollments** tab has Pause, Resume, Stop, **Mark unsubscribed**, and
  **Open email**.
- **Records:** rows in the user's own Macro database (**Delivery → Open
  database**).
