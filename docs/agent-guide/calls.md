# Calls

## Calls — `/app/calls`

On desktop a collapsible sidebar starts with the shared outlined `New` button,
with `Search calls` immediately left of collapse. Search reveals its field above
New. The sidebar also holds
the views `All` / `Missed` / `Unattended`, a `Type` section (`Internal` /
`External`; External means at least one guest without a Macro account joined),
a `Channels` section listing channels seen in loaded calls, and `Tags`. Choosing
a type, channel, or tag shows only that one; choosing it again clears it. These
refinements carry across the three views. The desktop header uses one row:
title, an outlined filter group, a view-options group, `New`, and an expandable
Search icon. Command-F expands and focuses search; Close or Escape clears it
and restores the icon. Phones keep pill tabs and the header search.
With `enable-quick-calls` enabled, `New call` opens a menu with `Start an instant
call`, `Call a channel or contact`, and `Manage call links`; without the flag it
opens the recipient picker directly. `Start an instant call` opens `/app/meet/new`
without creating a meeting, the same setup reached from `New Call` beside
Calendar's `New event` or `Create` → `Call` (`C C`). Scheduled calls are created
through Calendar and can be shared with people who do not have a Macro account.
The channel/contact option opens the recipient picker. Starting a channel call
connects the creator without waiting for recording, transcription, or recipient
notification delivery. Verify that a second participant still receives the ring
and can join, and that leaving immediately does not leave a recording running.
Recordings, transcriptions
and summaries appear here; empty state notes "Calls are available to agents."

Opening a recording uses `/app/calls/call/<callId>` inside the Calls view,
with one breadcrumbed header (`Calls > <recording name>`). Choose `Calls` to
return to the list with its search, filters, focus, and scroll position preserved.
The desktop sidebar remains available; choosing a view or filter, or focusing
search, returns to the list. Phones show the same detail and return breadcrumb
instead of switching to Drive. Shift+Enter and Open in new split open
the recording in a second Calls view.
Old copied `/app/call/<callId>` links redirect to the Calls detail without losing
the transcript target. Existing `/app/drive/call/<callId>` links still work.
The detail shows a loading state, recording/transcript/summary, Share, and a call
side panel below the breadcrumb header; a failed load shows Retry.
`call_transcript_id=<segmentId>` seeks the matching video segment after loading.
Check a direct link, both old link formats, a Calls-list click, a second split,
the breadcrumb return, browser Back/Forward, and clicking the same transcript
search hit twice after playing elsewhere. On phones, recorded call headers omit
**Call Again**.

### Imported Granola meetings

Adding Granola in **Settings → Agent connections** (Pipedream Connect, Granola
Business or Enterprise API key) is the only setup; there are no sync controls.
Within about 30 seconds the backend registers a Granola webhook at the widest
scope the key allows, and removing or disabling the connection stops sync. Notes
whose first summary is generated, edited, or shared after that are imported as
private calls about a minute after Granola finishes the summary, and appear in
Soup lists without a refresh; history is not backfilled. Imported calls appear
in `All` and `Attended`, never in a channel's `Calls` tab, and open in the
normal call detail with title, summary, attendees
(shown as guests), and transcript but no recording. Rename and delete do not
apply to imported calls yet. Webhooks require a public HTTPS cognition callback origin (`CognitionPublicUrl`);
on a laptop stack, expose the webhook path with a tunnel such as Tailscale Funnel.

A channel's `Calls` tab lists that channel's recordings with the same rows, filtered
by the channel id. Its search field matches call names and transcripts in that
channel.

In the native iOS call drawer, the horizontal participant row excludes the person
shown in the large video. While holding or scrolling the row (including momentum),
the displayed primary and row membership stay fixed; speaking indicators still
update. The latest primary and membership update together after scrolling settles,
preserving a surviving participant's position where possible. Verify that dragging
does not pin someone, tapping pins the displayed person, and a participant who
leaves during a held touch cannot be selected. Exercise speaker changes and
departures during row gestures on a physical iPhone as well as the simulator.

Leaving a native iOS call is final. The drawer's **Leave**, CallKit's end
button and the alone prompt's **Leave** all end the CallKit call, its LiveKit
room, the drawer and PiP, even when the native session has already lost
track of the call. PiP and the drawer appear only while a call is active, so
restoring a PiP left over from an ended call dismisses it instead of opening
an empty drawer. A call the user left is never rejoined automatically: a
native snapshot that still reports it is ended natively, and only tapping
Join in that channel lets the call back in. A CallKit answer handled more
than 60 seconds after it was fulfilled is dropped rather than joined. Verify
on a physical iPhone that Leave from the drawer, from the lock screen, and
right before backgrounding the app each end the call without a PiP or drawer
returning, and that tapping Join afterwards still rejoins a call that is
still running.

Native call logs go to the unified log (subsystem: the app's bundle id,
category `CallKit`) at notice level, so they survive on the device. Collect
them from a connected iPhone with
`sudo log collect --device-udid <udid> --start '<time>' --output calls.logarchive`
and read them with `log show --predicate 'category == "CallKit"' calls.logarchive`.
They never contain identities, names, or device names; participants appear
as LiveKit SIDs. The app's `call_action` analytics record `callId` on `joined`
and `left`, what started each join (`trigger`: `user`, `deep_link`, `restore`,
`auto_rejoin`), and why each leave ran (`leaveReason`: `user_initiated`,
`native_ended`, `join_cancelled`, `stale_native_session`).

### Alone in a call

When the only person left in a call is a Macro user, the server warns them
after 5 minutes: `You're the only one here` with **Stay in call**, and the
call ends 2 minutes later unless they stay. Staying restarts the 5-minute
clock, and someone joining clears the warning on every device. On the web,
desktop and Android the warning is a dialog (a drawer at phone width) with a
countdown; **Dismiss** hides it and keeps the deadline. On iOS CallKit calls
it is a native alert above the call drawer, or a notification while the app
is in the background, where the phone also posts its own notice after 5
minutes alone. A call whose only remaining participant is a guest never
times out. Verify by leaving another participant's tab and waiting in the
call: the warning, Stay, the end after the deadline, and dismissal when
someone joins.

If a recording fails to play, reload the page to obtain a fresh recording link,
or use **Open or download recording**. The playback warning does not assume
that the failure is caused by an unsupported media format.

### Call links and guests — `/app/meet/join/:shareToken`

These routes require `enable-quick-calls` for both signed-in users and guests.
In Calendar, create an event with `Macro call` selected (the default).
The composer waits for the quick-call flag to load before choosing its default.
Saving creates the call and includes its link in the invitation;
the room starts on the first join. Use Calendar to edit the event or invite guests.
Teammate rings require a live call; selecting teammates during new-call setup
sends invitations after the call connects.

`New call` → `Manage call links` lists your standalone links with `Join call`, `Copy
link`, and `Revoke link`. Revocation prevents new joins; it does not delete calendar
events or disconnect current participants. Each active channel call also shows its
URL and `Copy link`. A channel call's link stops working when that call ends.

Guests can use standalone meeting links without a Macro account. Links to channel
calls only admit signed-in Macro users; visitors without an account see a sign-in
prompt instead of the guest name form. Inside a channel call, the shareable link is
created on request via `Get shareable call link`.

New calls use `/app/meet/new`; shared links open setup at
`/app/meet/join/:shareToken`. A successful connection replaces the URL with
`/app/meet/:shareToken` without restarting the call. For signed-in participants,
hangup opens the call record when the server confirms the call ended (the last
participant left). Leaving an ongoing channel call opens its channel; leaving
an ongoing scheduled call opens Calendar. Ongoing instant calls return to Calls.
Guests return to Macro without opening a private call record.
An unexpected disconnection returns to setup so the user can retry.
Opening or reloading an in-call URL returns to setup and requires a deliberate
join; existing shared links continue to work.

Guests enter `Your name`, choose their microphone and camera preferences, and
press `Join call`. Setup requests microphone permission and waits until that
prompt finishes before requesting the camera, then previews video locally;
sharing starts only after joining.
Permission denial leaves the affected device off and still allows joining.
Shared-link setup shows the people currently connected, with avatars, names, and
an attendee count. It refreshes every 15 seconds while setup is open; guests see
this only for standalone links. Empty calls show `No one else is here yet`; a
failed roster request leaves joining available. Transcription agents and past
attendees are excluded.

The preview and full-width join button retain their size while joining.
The call runtime preloads while setup is open. New-call setup also reserves an
empty room, without starting a meeting, recording, or invitations. Leaving setup
cancels that reservation; abandoned rooms expire after five minutes. Starting
still works if preparation fails or expires.
Entry waits for the room connection;
teammate invitations continue afterward. For a newly started call, transcription
and recording start in the background instead of delaying join credentials.
Copying the meeting URL is available after joining, in the in-call header.

The creator presses `Start call`; invitees press `Join call`. Loading the page or
completing authentication never joins automatically, including old `?join=true`
URLs. `Back to Macro` exits setup.
Channel-linked calls require sign-in. While authentication is loading or the
viewer is signed out, setup must not request microphone or camera access; the
guest name form is available only for standalone meetings.

The call page shows a recording/transcription notice. It uses the normal call controls
for audio, video, device selection, screen sharing, and effects. `Leave call` uses
the destinations above after the server confirms whether the call ended.
Check channel, scheduled, and instant calls with another participant remaining
and as the last participant, including at phone width. During a delayed leave,
the page shows `Leaving call…` without flashing setup; navigating elsewhere must
not be undone when cleanup finishes. Inline channel call controls return to
Messages on leave and open the record when that hangup ends the call.
`Copy Meeting Url` is available during the call.
Rejoining from a new page waits for the prior page's pending leave cleanup before
requesting another connection, so a slow leave cannot disconnect the replacement.
Leaving the last participant archives the session first and tears down its media
in the background, so the next call does not wait for that room to be deleted.
It keeps its label and shows a checkmark for a few seconds after copying, then
restores the copy icon.

Guest access is limited to the call room and its live text discussion; joining does not expose the channel or grant
anonymous access to saved transcripts and recordings. Guest names are preserved in
the host's call history. Signed-in attendees receive access to that session's saved
call without gaining access to the channel.

The join screen, in-call participant tiles, and incoming direct-call badges use
profile pictures; initials are the fallback when no photo is available.
The join screen has microphone, camera, and background effects buttons over the
preview, with pill selectors below for microphone, speaker, camera, and
backgrounds. The background button over the preview toggles the selected effect
off and back on; when no effect has been selected, it enables Strong blur.
Backgrounds use a simple menu with None, Light blur, Strong blur, and image upload
(JPG, PNG, or WebP, up to 10 MB). Dot icons distinguish the two blur strengths.
Selected devices and backgrounds carry into the call; unsupported browsers use
the system speaker. If a background cannot be applied, the camera stays off
until the user retries or chooses None. The screen uses a gray join
button. The in-call header has a gray `Copy Meeting Url` button with a copy icon
and shows the current local time before the call name. Owners can click the name
to rename it, then Save or press Enter; Cancel or Escape discards the edit. Guests and other participants see a
read-only name.

Join-preview and in-call controls use the standard Macro icon buttons. Pause
over the microphone, camera, or background group to reveal an animated settings popover
above the call toolbar; click its caret to keep it open. Brief pointer passes
do not open settings, and moving into the popover keeps it open. Settings
respect reduced-motion preferences. The toolbar and settings panels use Macro's
shared glass surface in both light and dark themes.
Audio settings include microphone, speaker, and noise suppression. Camera
settings include the camera selector. Clicking the background icon toggles the
selected effect off/on, restoring the last blur strength or image (Strong blur
by default). Its hover panel contains the same None, Light blur, Strong blur,
and image-upload menu as the join screen; the caret pins this panel for keyboard
and touch access. Click outside or press Escape to close the settings.
The controls also work by keyboard and touch.

### Browser call diagnostics

Browser OpenTelemetry requires `enable-browser-otel` (or
`VITE_ENABLE_BROWSER_OTEL=true`) and a configured exporter. PostHog deliberately
drops events on private call-link routes; it is not a substitute for these traces.
Existing `call_action`, audio-processing, and receiver-health analytics describe
other parts of the call, not waiting-room permission outcomes.

Find `meeting.join` by `call.id`, then use its `meeting.setup.id` to find that
page's earlier `call.media.capture` spans, including guest attempts. The setup ID
is random and scoped to the page owner; it is not derived from the share token.
Each capture records the device, whether it was enabled, the trigger, outcome,
and whether the captured stream was retained. Camera permission can succeed
while its toggle remains off. A pending request cancelled by navigation ends
with `cancelled`; a camera constraint fallback emits `call.media.constraints_retry`.
Join records final `meeting.join.microphone_access` / `camera_access`, enabled
flags, and whether each live preview track was handed to the call.

Failures include an allowlisted `error.type`: `NotAllowedError` or `SecurityError`
indicates blocked access (browser, OS, or policy), not proof the user explicitly
clicked Deny. `NotFoundError`, `NotReadableError`, and `OverconstrainedError`
help distinguish missing devices, capture failures, and unsupported constraints.
Unknown provider errors are redacted. Raw error messages, device labels/IDs,
guest names, and bearer URLs/tokens are not attributes.

`call.connect` and background `call.media.setup` are children of the join flow.
`call.media.publish_prejoin`, `enable`, and `toggle` expose publishing/capture
failures after admission; `enumerate` and `background` cover waiting-room
device lists and effects. A completed join/setup does not imply every device
worked: inspect its media children. Later toggles and connection-state samples
are searchable by `call.id`. `call.connection.disconnected` records the SDK's
numeric reason when available. These spans cover the browser LiveKit path,
not the native CallKit media implementation.

Verify allowing and blocking each device, joining with both off, granting
access on retry, and leaving while a prompt is pending. Confirm setup and join
share the setup ID and that media failures remain visible when join succeeds.

### Sharing a call

With quick calls enabled, channel calls use the same **Copy Meeting Url** button
as instant and scheduled calls. Clicking it creates the share link and copies it;
opening the call tab alone does not create a link. If loading fails, click again
to retry. If clipboard access fails, a selectable URL appears below the button.

A channel call's **Share** dialog has a `Team access` control (None or View) for the same canonical
team share. Its side panel has a `Sharing` section with one `Share with team` checkbox, and the
in-call controls carry the same checkbox while a call is live. It is canonical team sharing (the
same `Team access` model documents and AI chats use), fixed at **view**. While the call is **live**
the checkbox is a pending toggle (on by default for channel calls)
that any participant with edit access can flip;
other participants see it update live. When the call ends it is applied: with the toggle on,
everyone on the creator's team can open the recorded call, read the transcript and AI summary,
and find it under Calls and in search; off means nothing is shared. Afterwards only the call's
**creator** can change it — everyone else sees the checkbox read-only with a note saying so.
Team sharing is independent of channel access and of link sharing.

Standalone instant and scheduled calls are excluded from team memory. They have no
`Share with team` or `Team access` controls during the call or on the saved recording.
Signed-in participants keep direct access to their recordings, transcripts, and summaries;
joining a standalone call never makes its content available to the wider team.

### Android native channel calls

Android channel calls use a native call activity rather than browser media.
After joining, the themed drawer shows a large participant tile and a horizontally
scrolling participant strip without the transcription agent; tap a strip tile to make it primary. Speaker toggles
speaker mode (hold it for headset/Bluetooth routing), Mute and Video control capture, and **Leave** ends the call.
The local primary video tile exposes Switch camera. Swipe the drawer handle down,
tap outside the drawer, or use Back to shrink it to a thumbnail over Macro, as on
iOS: tap it to reopen the drawer, drag it to another corner, or drag it past a side
to tuck it away (an edge tab brings it back once someone else is in the call). Leaving the app continues the call in system PiP (you and the
active speaker); tapping PiP shows Android's menu with Mute, **Leave** and expand,
which reopens the drawer. **Open call controls** in the web call controls also
reopens the drawer. Leaving the channel does not end the call. Incoming calls
expose Answer/Decline in the **Calls** notification channel, including while
locked/backgrounded; while Android 14+ blocks full-screen notifications, a toast
offers **Allow** (system setting) or **Hide**. PiP is a native, device-dependent
flow. Browser-only tests cannot validate Telecom, FCM wakeup or background media;
follow the hardware matrix in [Android development](../development/android.md#native-calling).
