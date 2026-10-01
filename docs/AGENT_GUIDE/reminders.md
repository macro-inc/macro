# Reminders

Use the dedicated Reminders workspace to inspect reminder lists and open an
existing reminder. The create and edit surfaces share the same scheduling
controls; reminder creation is a real hosted-data mutation, so use request
interception when checking failures and cancel any draft used only for visual
inspection.

## One collection, independent completion and schedule

The Reminders workspace is one continuous list, without Active/Scheduled/Done
tabs. Due reminders come first, then upcoming schedules, then completed history;
ordering applies before pagination. An old saved tab opens the unified view.
Completion is acknowledgment of an occurrence: a done recurring reminder can
still have a future schedule. Its completed check and clock appear together.
Marking done keeps the row in the unfiltered collection. The explicit Completion
filter can limit the collection to Done or Not done.

A persistent clock beside the row metadata exposes the full date, time, timezone,
repeat rule, and email condition on hover or keyboard focus. Click or tap it to
edit using the existing reminder form. It remains available when row-hover
actions or notification metadata are visible and on narrow/touch layouts. Paused
and due tooltips describe those states without claiming a future firing or
successful delivery. Completed one-shot reminders have no scheduled clock.

An email-follow-up mirror's completed control opens its owning email composer
to schedule again; it must not call generic mark-not-done. Its completion toast
does not offer generic Undo, because the server rejects that operation.

For verification, include a done recurring reminder, due and completed one-shots,
a paused schedule, and a long recurrence. Verify hover/focus tooltips, editor
dismissal focus, retained rows after completion, and narrow notification rows.
Collection reads are paginated and refreshed in bulk, with no per-row polling.

## Create or edit a reminder

**New reminder** opens **Remind me about…**, an entity picker with recent items.
Search using **Search reminder items**, use Up/Down and Enter to select, or click
an item. Selecting an email opens the conditional email follow-up flow below;
selecting a task/document opens a time-first form with its title and icon.
**Add a note** is optional; no duplicate title is required. **Change** returns to
selection. **Write a reminder instead** opens the freeform form, where
**Reminder description** is required. The **When** field accepts date language such as
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

## Open or manage an attached reminder

Attached rows lead with their source icon and current title. A personal note,
when different, appears as secondary text. Click or Enter opens the email, task,
or other source directly, including in Home and when opening a new split/tab.
Freeform reminders open their editor. Use **Edit reminder** in the row menu to
change the schedule or note of an attached reminder. Completion and removal
still act on the reminder itself, not on its source. Inaccessible sources show
an unavailable label rather than a cached private title.

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

## Email follow-ups (H)

On one selected email or an open conversation, **H**, **Remind me** in the menu,
and the bell control open the same time-first picker. The subject is already
known; the first field is **When**, with no required title. Bare H remains text
inside reply, compose, search and other editable fields. Escape cancels without
moving the conversation. Saving uses one server operation to schedule and move
it out of the inbox; successful creation advances within the invoking list.

**If no reply** is the default. A genuinely new inbound message after scheduling
cancels it; drafts, outgoing mail (including provider SENT aliases), known own
inbox senders, replays and historical backfill do not. **Regardless** survives a
reply. Existing H opens the pending follow-up for editing or **Remove**. Remove
returns the conversation to its inbox; **Undo** cancels a newly scheduled
follow-up and restores its original inbox visibility. A stale undo cannot
remove a newer edit. Generic reminders attached to the same thread remain
separate reminders.

The bell is accented for pending and returned reminders and its accessible label
includes the pending time. Server dispatch returns eligible conversations to
the top of the corresponding inbox, including sent-only conversations, then
uses the existing persistent reminder alert. Trash, deleted and inaccessible
conversations are not returned. The server sweep runs once a minute; this is
not exact-second delivery, and it does not promise a closed-browser OS alert.
Pending operations and replies reconcile without an open browser.

Email writes use `PUT /dss/reminders/email/{threadId}` with a retained operation
ID. Unlike generic creation, retrying the same email request cannot duplicate
it. For failure verification, intercept that endpoint and verify the time and
condition remain, no client archive request is sent, and no navigation occurs
before the server confirms the operation.
