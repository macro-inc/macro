# Notifications

## Notifications view — `/app/notifications`

Behind `enable-unified-notifications` (with GraphQL Soup), the bell below Home
on the outer rail (`g i`) opens one list of everything that needs you, newest
first. The flag is on in dev and comes from PostHog elsewhere;
`VITE_ENABLE_UNIFIED_NOTIFICATIONS` overrides it locally. With the flag off the
route redirects to Home once flags load, and `g i` stays on Home; with it on,
Home keeps `g h`.

Each card is one row of the server's notification inbox
(`user.notificationInbox`): an email thread, a channel's top-level messages, one
top-level message with everything about it (its replies, mentions and reactions,
once there is more than one thing), an entity's comments, a task assignment, a
pull request, a calendar event, an access request or grant, or an agent session.
A top-level message that mentions you has its own card, with its thread; an
entity's comments stay on one card even when one mentions you. The server decides
all of this (`crates/notification_inbox/src/domain/rows.rs`), so live updates and
reads stack the same way. A card shows who it is from (an avatar, an initial for a
sender known only by name such as an email's, or the kind of notification for a
reminder), with a badge on the avatar's corner saying what kind it is, in the theme's color for
the entity it is on, as on that entity's icon elsewhere (Channel,
Message, Mention, Reply, Reaction, Email, Comment, Invite, Access, Agent, Task, Pull
request, Event or Reminder; a stack's newest notification decides, except that a
mention stays one). It is as tall as it has something to say: who did it (for example
**&lt;first name&gt; assigned you a task**), with an unread dot; what it is about;
and up to two lines of what was said. An email has all three (sender, subject,
snippet), a message in a channel has no middle line, and a task has no last one.
Several notifications on a row make a stack, with paper edges: it names
who, what they share (the top-level message when a notification carries it, the
channel, session, document or thread), and the newest line, with its sender when
there are several people.
Choosing a stack opens it and leaves it folded; only its caret unfolds it: the card
stays exactly as it was, its notifications spread into small cards below it, inset
evenly where its paper edges sat, and every other card dims until you close it. Hovering or moving to a dimmed
card brings it back. Each small card opens that notification:
its message or reply, its comment, or an agent's turn. A channel invite and an
email have no message of their own, so they open the channel or the thread.
A stack stays open as new notifications land. The time always shows; on hover Mark done takes its place, and nothing else moves. The author is
the row's actor: a Macro user by first name, an agent by its bot name, or
**Macro**; a row from outside Macro names its email sender, and GitHub rows
keep the GitHub login. A row type, author kind, or button this build doesn't
know yet shows as a plain card with no author and no button.
Date dividers split the list into Home's sections (**Last hour**, **This
morning**, **Yesterday**, and so on), by each row's newest notification; `j`/`k`
skip them.

Click a row or press Enter to preview it beside the list, opened at the
notification's message, thread, or comment, under a **Notifications >**
breadcrumb that clears the preview. Previewing marks the row seen, including
notifications the row hides, and drops its unread dot. With a preview open, `j`/`k` move it along the
list and through unfolded notifications; `l` or the right arrow unfolds the focused
stack and the left arrow folds it from anywhere inside it. Opening a notification
marks its whole row seen. Each small card has its own **Mark done** on hover, or `e` while it is focused, or a left swipe on touch: it completes that notification and the ones about the same message, the stack counts one less, and the stack's last one completes the row; a preview of it moves to the stack's next notification. Undo works as for a row. Choosing what's
shown again re-aims it. A calendar event or join request opens the Calendar
beside the list at the event, at `/app/notifications/calendar/<period>` with the
event in `sN.calendar.*`, under the same breadcrumb; the list keeps its place.
Projects open in their own view instead. Shift-click or the alternate key opens a new
split. Hover a row and choose **Mark done**, or press `e`, to complete that row
only: the channel thread stays when the channel's top-level row is done, and an
open preview moves to the next row. A toast offers **Undo**, as does
`⌘Z`/`Ctrl+Z`. A new notification in a done row brings it back. An empty inbox
reads **You’re all caught up**; with nothing chosen the pane reads **No
notification selected**.

Rows carry the buttons the server lists for them under their text. An access request offers **Approve** (grants the level asked
for) and **Deny**; a request to join an event you shared offers **Accept** and
**Decline**. Deciding disables the buttons until it finishes, shows a toast
(**Access granted**, **Access request denied**, **Added to the event**,
**Join request declined**), and removes the row; a failed decision leaves the
row and says so. An agent waiting for you offers **Answer** and a granted
access request **Open**; both open the row as choosing it does. A pull request
whose review was requested offers **Review**, which opens the pull request on
GitHub and marks the row seen.

**All** and **Unread** under the header switch the list (`1` and `2`, or Tab, also
switch), and the choice is kept per user across reloads. A row you read under
Unread, or a stack you're going through, stays until you next switch or reload.
With nothing unread, Unread shows **You're all caught up**.

**Clear notifications** (double check, beside the filter; a sheet beside the
filter pill on touch) offers **Clear today** (everything since local midnight,
the rows under the list's today sections), **Clear all**, and **Clear by kind**
for each kind the filters show. It acts on the whole inbox, not only the
loaded rows, and never on a kind the filters hide; under Unread the choices
read **Clear today's unread** and **Clear all unread** and take unread rows
only. Clearing marks the rows done, but unlike a row's Mark done it doesn't
archive email threads. A toast says how many were cleared and offers **Undo**,
as does `⌘Z`/`Ctrl+Z`.

**Filter notifications** (funnel, or `f`) offers **Type** checkboxes that start
checked: Mentions, Replies, Messages, Comments, Email, Tasks, Pull requests,
Calendar, Access requests, and Agents. Unchecking a type hides its rows (Mentions
covers both channel and comment mentions, Replies both channel and comment
threads). The trigger counts hidden types, and **Reset filters** shows them all
again without changing All or Unread. Choices persist per user across reloads.
Hiding every type shows **Every kind of notification is hidden** with Reset
filters; types that hide every row show **No notifications match these filters**. The gear beside
the filter opens **Settings → Notifications**, which decides what is delivered
at all (including push and email).

On touch devices the dock's bell (**Notifications**) opens this view with the
flag on, as the list alone under the floating controls Home, Email, Tasks and Drive
use: the filter drawer (Type), then All and Unread pills. Cards keep the same anatomy with 44px targets
and inline row buttons; at phone width they have a larger avatar and slightly larger
text and sit further apart; a read card there loses its fill, fades its avatar and
mutes its text, so unread cards stand out. A tablet keeps the desktop's sizes. Tapping a card or an unfolded notification opens it
full-screen in place, tapping a stack's caret unfolds it, a left swipe marks it
done (with the same Undo), and pulling down refreshes. Hover controls and the preview pane are desktop-only. The
dock keeps the bell active while the view shows.

The list updates live, without a reload, and a live change never remounts a card:
list items are one object per row id and each card reads its row's latest data
(`primitives/inbox-date-headers.ts`). Scrolled down, a card landing above what
you're reading doesn't move it.

Verify with two accounts and the inbox left open: two top-level messages in a
channel stack on it; two reactions to your message, or a reaction and a reply, stack
on that message and leave the channel's card; comments in different threads of a
document share one card. Each appears within a second with no reload. Unfold a stack
with its caret and choose each notification: the preview moves to that message or
comment, and stays there as new ones land. Marking one
done leaves the others, Undo restores it in place, and a new notification in a done
row brings it back with only what's new.

## Reading items

Opening or previewing an item clears the unread dot immediately, before its
read request completes. Home, Mail, Drive and Tasks share this behavior for
Markdown/tasks, legacy AI chats, email, calendar events, agent sessions, CRM
records and pull requests. Loaded call/project notifications use the same policy.
Email clears both the mailbox unread state and reminder notifications, using the
thread's owning inbox. A failed notification write restores its dot; failed REST
mailbox writes refresh the affected thread. Direct document/chat/PR/email links
mark read when their content mounts, without an extra timer.

Check click/tap, Enter, keyboard preview following, next-item navigation and
mark-done advance. With writes held pending, the dot should already be gone;
fail the write and verify that the dot returns and reopening retries. Include
email from a secondary inbox and a received thread with a draft reply. Mark an
open email unread explicitly and leave it open: the mount marker must not keep
marking it read. Local-only drafts must not issue a mailbox read.

Channel/thread rows retain their scoped reads, and message readers still require
actual visibility; opening another entity must not mark hidden replies seen.

With GraphQL Soup enabled, modern project **Mark read** and **Mark done** actions
target all of the project's notifications, including notifications absent from
the loaded feed. The target is `INITIATIVE`; legacy Drive folders retain the
separate `PROJECT` target.
Check both actions with a partially loaded notification feed. This mapping does
not add read-on-open behavior to project routes or folder navigation.

## Notifications

Browser notifications must arrive while Macro is in a background tab, not just
when it is visible. With browser permission and in-app delivery enabled, switch
to an unrelated tab and trigger a notification from another session. Check that
the alert arrives before returning to Macro and does not repeat on return. Try
with one Macro tab and with several all hidden; only the elected notification
leader should show the alert. This does not promise delivery after every Macro
tab is closed or the browser suspends the page.

GraphQL notification callbacks run on network receipt, independently of the local
cache, which parks while all Macro tabs are hidden. Cache updates and channel
reconciliation catch up afterward. The backend-free `parking.browser.e2e.ts`
regression exercises that boundary with real storage and simulated visibility;
OS banner presentation still needs the manual check above.

For delayed cache catch-up, find `notification.receive` by `notification.id`.
Its linked `graphql.subscription.cache_queue` and
`graphql.subscription.cache_apply` phases distinguish waiting behind an earlier
event from applying the event to storage. Receipt completes without waiting for
these phases; listener errors mark receipt, while cache errors mark application.

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
conversation stack together in Notification Center and play the default sound,
unless Macro plays its own notification sound for that alert (see below).
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
first route after verifying its recipient account. Cold launches open the
channel in front of Home, retaining the header Back chevron and swipe-back
destination. Verify both return to Home without reopening the channel first.
A failed or stalled native bridge must release startup within 1.5 seconds;
the app can show its auth or retry UI while retaining the tap. If the bridge
recovers later, the tap uses
normal navigation without resetting the current page to the app root. Check
both listener attachment and pending-intent reads, including a tap delivered
before the pending read stalls. Receiving a push without tapping it must not
navigate.

For an iOS warm resume, leave the app running past its startup timeout before
backgrounding it. Tap an uncached notification without a direct channel target
and fail its notification lookup: the app must reveal the existing page and
show **Failed to open notification.** A later tap must still open normally.
Also stall navigation or its native acknowledgment: after eight seconds the
frontend releases the cover without discarding the pending destination. Duplicate
delivery must not restart that deadline; a newer tap must get its own deadline.
`notification.cover_timeout` is recorded on the notification-open trace. This
frontend recovery requires responsive JavaScript and native IPC; verify actual
iOS presentation separately from browser bridge simulations.

On iOS, Macro requests provisional authorization at launch, so
**Settings → Apps → Macro → Notifications** exists before any prompt, and a
signed-in device registers for pushes that arrive quietly in Notification
Center. A quiet push counts as delivered, so those users get no email digest
for it. The in-app **Mobile notifications** switch and enable prompt stay off
while delivery is provisional; turning either on shows the system prompt.
A quiet notification's **Keep → Deliver Immediately** authorizes Macro but
leaves banners and the Lock Screen off: the switch shows on, iOS never prompts
again, and only iOS Settings turns banners on.
Verify on a fresh install: the Settings row appears without a prompt, the in-app
prompt still appears, and upgrading from Settings or from a quiet notification's
**Keep → Deliver Immediately** turns the switch on when Macro returns from the
background. Notification Center pulled down over Macro does not background it,
so the switch updates only after the next return.

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

## Notification sounds

**Settings → Notifications → Sounds** turns on an in-app sound for incoming
notifications. It is off by default and saved per person on each device
(user-scoped localStorage), so a laptop and a phone choose separately. With
sounds on, it shows a volume slider and one row per type (Messages, Mentions,
Thread replies, Email, Meetings & reminders, Tasks, AI & agents, Everything
else), each with its own on/off switch, sound picker, and play button. Picking
a sound previews it. Email, AI & agents, and Everything else start off.
Channel join requests use Everything else, alongside sharing and invitations.

Sounds are synthesized with Web Audio (`features/notification-sounds`); there
are no audio files. Event types map to rows in `core/categories.ts`; a new
backend event type stays quiet until it is mapped there. Incoming calls keep
their own ring and never use these sounds. Only unseen notifications play,
notifications within 1.5 s of a sound share it, and only the Macro tab the
person last focused or touched plays, so several tabs ding once. Closing that
tab hands sound back to the others until one is focused. Browsers keep
audio suspended until the page has had a gesture; a notification before that
stays silent rather than playing late.

When Macro plays a sound for a notification, its browser or macOS alert is
sent silent so the person hears one sound. macOS builds older than the
`silent` argument on `send_macos_notification` ignore it and still play the
system sound.

**Settings → Notifications → Quiet hours** silences those sounds and skips
desktop and browser alerts on a weekly schedule. It is off until turned on,
then covers every day from 10:00 PM to 8:00 AM in the device's time zone. The
person picks the days, the start and end, and the time zone. A later start
runs through midnight, and the window is the clock time on each selected day,
so Tuesday morning is quiet only when Tuesday is selected. An equal start and
end covers no time. Incoming calls still ring and still show an alert. Inbox
items still arrive. The schedule is saved on this device with the sound
settings, so a phone and a computer can differ. A sound preview still plays.
Mobile push sent while the app is not open is unchanged.

The backend-free desktop/phone regression drives the real settings section,
persistence, previews, and delivery through a stand-in notification feed:
`bunx playwright test --config src/features/notification-sounds/browser-test/playwright.config.ts`
(from `apps/web`). To check real delivery, turn sounds on, click anywhere in
Macro, and trigger a mention from another session; then turn Mentions off and
check that the next mention is quiet.
