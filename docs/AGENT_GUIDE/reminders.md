# Reminders

Use the dedicated Reminders workspace to inspect reminder lists and open an
existing reminder. The create and edit surfaces share the same scheduling
controls; reminder creation is a real hosted-data mutation, so use request
interception when checking failures and cancel any draft used only for visual
inspection.

## Create or edit a reminder

The create dialog is titled **New reminder**. A standalone reminder requires the
**Reminder description** field; an entity-attached reminder may derive its title
from the source badge. The **When** field accepts date language such as
`tomorrow 9am`, `in 30 minutes`, weekdays, and explicit dates. The resolved
weekday, date, time, and timezone appear in the **Scheduled:** preview before
saving.

Quick choices are **In 30m**, **Later today** (only before 5 PM), **Tomorrow**,
**Next week**, and **Custom**. Each choice names its resolved time. Custom reveals
native **Custom reminder date** and **Custom reminder time** controls. These are
normal buttons and fields: Tab reaches them, Enter submits a valid form, and the
dialog restores focus to its opener on dismissal.

A local time skipped by a daylight-saving clock change (for example 2:30 AM on
a spring-forward day) is rejected inline. Choose a time before or after the gap;
the form must never silently normalize it to a different displayed time.

**Repeat** is a collapsed secondary section. It offers **Does not repeat**,
**Daily**, **Weekdays**, **Weekly**, and **Monthly**, followed by weekday/day,
time, and timezone controls where relevant. An existing cron expression the
picker cannot represent is labeled **Custom schedule** and remains byte-for-byte
unchanged unless a replacement repeat choice is selected.

The primary action reads **Set reminder** for create and **Save** for edit.
**Cancel** dismisses without saving. A description-only edit of an overdue
reminder keeps its old schedule instead of trying to reschedule it in the past.

## Verify save failure without changing dev data

Intercept `POST **/dss/reminders` and hold or reject the response. While held,
the primary action shows a spinner, every form control is frozen, and duplicate
submits issue only one request. On rejection, the dialog stays open, the entered
title and time remain, focus returns to the control used to submit, and an inline
alert explains that the draft can be retried.
The alert also warns that a timed-out request may already have succeeded; the
create API has no idempotency key, so the UI does not claim retries are
duplicate-safe.

After a confirmed response, the dialog closes and the success toast includes the
exact persisted time or recurrence. Only a confirmed create runs the invoking
surface's follow-up action.
