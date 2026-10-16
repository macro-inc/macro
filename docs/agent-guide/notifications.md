# Notifications

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
