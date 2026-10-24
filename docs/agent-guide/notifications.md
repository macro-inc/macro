# Notifications

## Notifications view — `/app/notifications`

Behind `enable-unified-notifications` (with GraphQL Soup), the bell below Home
on the outer rail (`g i`) opens one list of everything that needs you, newest
first. The flag is off everywhere by default, dev included, because no PostHog
flag exists yet; run the frontend with `VITE_ENABLE_UNIFIED_NOTIFICATIONS=true`
to see it locally. With the flag off the route redirects to Home once flags
load, and `g i` stays on Home; with it on, Home keeps `g h`.

Each row is one row of the server's notification inbox
(`user.notificationInbox`): an email thread, a channel's top-level messages, one thread, one
top-level mention, an entity's comments, one comment thread, a task
assignment, a pull request, a calendar event, an access request or grant, or
an agent session. A message that mentions you appears once,
in its mention row. Rows show a type glyph, a muted line saying who did what
(for example **Jacob assigned you a task**), the subject (email subject,
message or comment text, task name, PR or event title), a count when the row
stands for several notifications, the time, and an unread dot. The author is
the row's actor: a Macro user by first name, an agent by its bot name, or
**Macro**; a row from outside Macro names its email sender, and GitHub rows
keep the GitHub login. A row type, author kind, or button this build doesn't
know yet shows as a plain row with a bell glyph, no author, and no button.

Click a row or press Enter to preview it beside the list, opened at the
notification's message, thread, or comment, under a **Notifications >**
breadcrumb that clears the preview. Previewing marks the row seen, including
notifications the row hides, and drops its unread dot. With a preview open, `j`/`k` move it along the
list; choosing the shown row again re-aims it. Calendar events and projects
open in their own views instead. Shift-click or the alternate key opens a new
split. Hover a row and choose **Mark done**, or press `e`, to complete that row
only: the channel thread stays when the channel's top-level row is done, and an
open preview moves to the next row. A toast offers **Undo**, as does
`⌘Z`/`Ctrl+Z`. A new notification in a done row brings it back. An empty inbox
reads **You’re all caught up**; with nothing chosen the pane reads **No
notification selected**.

Rows carry the buttons the server lists for them under the subject, the first
one highlighted. An access request offers **Approve** (grants the level asked
for) and **Deny**; a request to join an event you shared offers **Accept** and
**Decline**. Deciding disables the buttons until it finishes, shows a toast
(**Access granted**, **Access request denied**, **Added to the event**,
**Join request declined**), and removes the row; a failed decision leaves the
row and says so. An agent waiting for you offers **Answer** and a granted
access request **Open**; both open the row as choosing it does. A pull request
whose review was requested offers **Review**, which opens the pull request on
GitHub and marks the row seen.

**Filter notifications** (funnel, or `f`) offers **Status** (Unread, Read, All;
single choice) and **Type** checkboxes that start checked: Mentions, Replies,
Messages, Comments, Email, Tasks, Pull requests, Calendar, Access requests,
and Agents. Unchecking a type hides its rows (Mentions covers
both channel and comment mentions, Replies both channel and comment threads).
The trigger counts hidden types plus a narrowed status, and **Reset filters**
restores everything. Choices persist per user across reloads. Hiding every type
shows **Every kind of notification is hidden** with Reset filters; filters that
hide every row show **No notifications match these filters**. The gear beside
the filter opens **Settings → Notifications**, which decides what is delivered
at all (including push and email).

On touch devices the dock's bell (**Notifications**) opens this view with the
flag on, as the list alone under a floating **Notifications** header with a
filter drawer (Status and Type). Rows keep the same anatomy with 44px targets
and inline row buttons; tapping a row opens it full-screen in place, a left
swipe marks it done (with the same Undo), and pulling down refreshes. Hover
controls and the preview pane are desktop-only. The dock keeps the bell active
while the view shows.

Verify with two accounts: a reply in a thread you're in, a top-level mention,
and a document comment each add their own row; marking one done leaves the
others, and Undo restores it in place.

## Notifications

In the desktop app, **Settings → Notifications → Delivery → Desktop notifications**
controls system notification delivery for this installation. The Notifications
page is always present, in the same place on web, desktop, and mobile; Account
has no notification switch.
Turning it off takes effect immediately and persists across app restarts; turning
it on requests permission and resumes delivery when authorized. On macOS the
switch reads the actual system authorization, and enabling it requests macOS
permission if it has not been decided. If macOS reports denial, enabling the switch
shows directions to **System Settings → Notifications → Macro → Allow notifications**
without requesting permission again; returning to Macro refreshes the switch.
It does not change inbox items or other devices. Focus and presentation settings
can still suppress alerts even when authorization is granted.
Verify off/on and persistence after restarting; on the Notifications page, a failed
toggle should show an error toast and allow retry.

On macOS builds with notification activation, clicking an alert restores and
focuses Macro and opens that notification's message, thread, or document location.
The native notification retains its destination across app restarts, and startup
waits for the layout before opening it. Receipt and dismissal must not navigate.
Verify two alerts with different targets by clicking the older one, then repeat
with Macro minimized, hidden, and quit. Test a channel reply and a document
comment to check the location inside the entity, not just the entity itself.
This requires a full native macOS release; frontend-only updates cannot add the
response delegate or repair destinations in previously delivered alerts.

In a signed macOS release, an alert from a person shows their avatar in place of
the app icon, their name as the title, and the channel or document name beneath
for group conversations; direct messages show only the sender. Alerts from one
conversation stack together in Notification Center and play the default sound.
Verify a channel message, a direct message, a document comment, and a reminder
(no sender: app icon and the combined title). Local and ad-hoc builds lack the
communication entitlement and show the app icon with the sender and subtitle.

On Linux desktop builds with native notification activation, clicking a system
notification (or its **Open** action) restores/presents Macro and opens that
notification's target using the normal in-app navigation. Dismissing or expiring
an alert must not navigate. With two alerts, click the older one to check that the
correct target opens. Also test with Macro hidden/minimized and on another
workspace: Wayland focus requires the notification daemon to supply an activation
token. This needs a native AppImage update, not just a frontend update; an older
binary reports **Update Macro to receive desktop notifications.** Activation is
supported while the app process is running, not after quitting it. The isolated
Linux WebKit/D-Bus regression is `bun run native:e2e:notifications`; compositor
focus behavior still needs a real Wayland/X11 desktop check.

On iOS builds with durable push navigation, a tapped channel push chooses the
first route after verifying its recipient account. A failed or stalled native
bridge must release startup within 1.5 seconds; the app can show its auth or
retry UI while retaining the tap. If the bridge recovers later, the tap uses
normal navigation without resetting the current page to the app root. Check
both listener attachment and pending-intent reads, including a tap delivered
before the pending read stalls. Receiving a push without tapping it must not
navigate.

On native Android, enable notifications in Settings while signed in. Android 13+
also asks for system permission; the system's **Activity** notification channel
must be enabled. Remote push owns system notification display after registration,
so the same WebSocket event should not create a second local notification. Tapping
a notification opens its target; simply receiving one does not navigate. Check
this with the app foregrounded, backgrounded, and after ordinary process death.
Logout clears delivered notifications and disables receipt for the old account.
After a transient native listener failure, verify that notification taps recover
without restarting the app. Android alerts without display text show
`New notification`; silent read/done clears must remain silent.
Also verify logout and notification opt-out while registration is pending: late
backend or native completions must leave the receiver disabled. If a new account
signs in before cleanup finishes, its registration must remain active afterward.

Mute indicators must use the current account's query data, not a retained copy
from the previous session. Verify a same-tab sign-out/sign-in with the second
account's muted-items request delayed: show no previous-account mute indicators
while that query is pending, then apply only the second account's response.

Toast regions are labeled `Notifications (alt+T)`; seven empty live regions always exist in
the a11y tree (ignore them when parsing snapshots).

Staff Noise emails still create in-app notification rows, but do not send a new-notification
event over GraphQL or the legacy WebSocket gateway, so they do not trigger browser popups.
Those rows are available on the next fetch/refetch. Signal delivery and the existing
staff/customer eligibility rules are unchanged; no browser eligibility request is needed.

Discussion composers on companies, contacts, documents, tasks, and PRs use the
shared channel/AI composer surface, 26.25px desktop corners, 15px desktop text, and
a circular neutral Send button. Edit with AI uses the same composer treatment.
Inline comments, replies, and their edits use a plain
input without a surface background, rounded frame, or shadow. Attachment and
formatting actions stay available.
On mobile, open documents and tasks put their new-comment composer in the
accessory dock above navigation, using the channel input's compact pill and
expanded surface. New is hidden when the comment composer is available; list
screens keep New. Users without comment permission have no comment composer.
The floating Ask AI input appears only on the AI/Agents view.

On touch devices, an email thread's floating action bar has Previous email and
Next email arrows beside the larger Mark done checkmark. The arrows follow the
source list's filtered order, skip non-email items, and disable at its ends.
They keep working from the thread's former neighbours after it leaves the list.
`J` / `ArrowRight` and `K` / `ArrowLeft` use that same order in the Email view.
Arrow keys in a reply editor or other text input keep their normal editing behavior. They do not wrap; a thread
opened without a source list has disabled arrows.
Mark done archives the current thread and opens the next email in that same
filtered list, loading pages until another email is found or the list ends.
On native mobile, stepping replaces the current email while preserving the
filtered list behind it for swipe-back. In the newer Email view it retargets the
view-owned detail stack instead of opening another block. To verify, open the
first email from Signal or Noise, tap Next and then Previous, and return to the
same filtered list.
Leaving the email cancels pending
navigation and archiving while a page loads. At the end it opens the previous
email; with no neighboring email it stays on the archived thread. Mark as not done
does not advance. Undo restores the archived email and returns to it.

The mobile reply/forward drawer uses matching circular glass buttons for
discard, attachments, and send, with the dock's button/icon sizing and regular
Phosphor icons. Send remains disabled until the draft is valid and shows a
spinner while sending.

The mobile new-email composer nests the channel-style Send button inside its
top-right glass toolbar, with an even 5px inset on the top, bottom, and right.
The toolbar is 46px tall; attachment and schedule controls align with Send.

Channel, email, Markdown, and composer body text use `text-base`: 15px at the
default root size. Supporting `text-sm` text is 14px and `text-xs` is 12px.
Desktop and mobile share this scale, with accessibility text scaling preserved.

Desktop channel and AI composers use an `Attach files` paperclip that opens the file picker directly, without a plus menu. Comment composers open the image picker directly. Channels and DMs always open in message mode; create tasks through the task creation dialog. Shift+Enter, including an empty new line, expands channel and AI inputs so text starts above the toolbar at the left inset. Sent AI message bubbles use the ink fill with a contrasting foreground in each theme.
