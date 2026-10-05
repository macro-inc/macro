# Email reminders

Reminders snooze email conversations. They are available only inside Email;
there is no global Reminders sidebar item, standalone reminder, task reminder,
recurrence editor, or reminder AI tool. Old reminder routes redirect to
**Email → Reminders**. Calendar event alarms remain separate.

## Snooze or change a conversation

On one selected email or an open conversation, press **H**, choose **Remind me**
in its menu, or activate its bell. The shared command menu shows the subject
and time choices: **In 30m**, **Later today** (before 5 PM), **Tomorrow**, and
**Next week**. Type a future time such as `in 2 hours` or `tomorrow 9am` in
**Remind me when**. Up/Down changes the selection; Enter or clicking a choice
saves immediately. **Cancel** or Escape closes without saving. There is no
separate title, note, or recurrence step.

**If no reply** is the default. A new inbound reply cancels that reminder;
outgoing mail, drafts, replayed messages, and historical backfill do not.
**Regardless** survives a reply. Only one active reminder is allowed per user
and conversation. Opening the menu again edits that reminder; **Remove reminder**
returns the conversation to its inbox. Scheduling archives it and advances
within the invoking email list only after the server confirms success.

Bare H still types inside reply, compose, search, and other editable fields.
On tasks, H collapses the item or its parent group. On list group headers,
H collapses the group.

## Delivery and undo

When due, an eligible conversation returns to the top of its inbox. Its reminder
notification belongs to the original email row in Home; clicking the notification
opens the conversation. An unseen reminder contributes to the row's unread dot
without changing the mailbox read state. Mobile push titles read
**Reminder: <email subject>**. No reply email is sent and no reminder toast appears.
The dispatcher sweeps once a minute; delivery is not exact to the second.
Deleted, trashed, or inaccessible conversations are not returned.

Cmd/Ctrl+Z undoes a confirmed scheduling change. Undo of a new reminder restores
the original inbox position; undo of an edit restores its previous time and
condition. A stale undo cannot overwrite a newer edit.

## Email → Reminders

With reminders enabled, **Reminders** appears beside **Scheduled** in Email's
sidebar and mobile selector. Scheduled contains outgoing send-later messages.
Reminders contains original conversations with active snoozes, ordered by return
time. Fired, cancelled, removed, and legacy generic reminders are excluded.
Archived conversations remain here while snoozed. Each row has one clock; click,
tap, or keyboard-activate it to reopen that conversation's reminder menu.
Opening the row itself opens the email.

Inbox, Read, Done, Calendar, Tags, and attachment filters apply to the original
conversation before pagination. Text search is unavailable in this view.
Back/forward and reload retain the Email tab and inbox scope. Other Email and
Soup views do not make reminder collection requests.

A sparse page can have a **Load more** continuation; follow it. A final page
stays loading until its email rows hydrate. Failed pagination preserves earlier
rows and exposes **Couldn’t load more email. Try again**.

## Verify safely

For UI failure checks against hosted data, intercept
`PUT **/dss/reminders/email/{threadId}`. Hold or reject the response and verify:

- Saving disables controls and repeated input cannot issue duplicate writes.
- A failure keeps the chosen time and condition, shows an inline retry message,
  and does not navigate or send a separate client archive request.
- Retrying an unchanged choice retains its operation ID, including after a
  background read discovers a write whose response was lost.
- A confirmed save closes the menu, advances the list, and adds keyboard undo.
- Opening the menu from a row clock does not open or complete the email.

Use local fixtures for real create/edit/remove/undo and due-delivery checks.
Also verify reply cancellation, caller isolation, multiple concurrent set
requests, filtered pagination, desktop keyboard interaction, and a narrow viewport.
