# Calls

## Calls — `/app/component/calls`

On desktop a collapsible sidebar holds the search field (`Search calls`, `⌘F`),
the views `All` / `Missed` / `Unattended`, a `Type` section (`Internal` /
`External`; External means at least one guest without a Macro account joined),
a `Channels` section listing channels seen in loaded calls, and `Tags`. Choosing
a type, channel, or tag shows only that one; choosing it again clears it. These
refinements carry across the three views. Sort, group, filter, and `New call`
sit in the list's top bar. Phones keep pill tabs and the header search.
With `enable-quick-calls` enabled, `New call` opens a menu with `Start an instant
call`, `Call a channel or contact`, and `Manage call links`; without the flag it
opens the recipient picker directly. `Start an instant call` opens `/app/meet/new`
without creating a meeting, the same setup reached from `New Call` beside
Calendar's `New event` or `Create` → `Call` (`C C`). Scheduled calls are created
through Calendar and can be shared with people who do not have a Macro account.
The channel/contact option opens the recipient picker.
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
private calls about a minute after Granola finishes the summary; history is not
backfilled. Imported calls appear in `All` and `Attended`, never in a channel's
`Calls` tab, and open in the normal call detail with title, summary, attendees
(shown as guests), and transcript but no recording. Rename and delete do not
apply to imported calls yet. Webhooks require a public HTTPS `MCP_PUBLIC_URL`;
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
`/app/meet/:shareToken` without restarting the call. Leaving returns to Macro.
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
for audio, video, device selection, screen sharing, and effects. `Leave call` returns
to Macro. `Copy Meeting Url` is available during the call.
Rejoining from a new page waits for the prior page's pending leave cleanup before
requesting another connection, so a slow leave cannot disconnect the replacement.
Leaving the last participant archives the session first and tears down its media
in the background, so the next call does not wait for that room to be deleted.
It keeps its label and shows a checkmark for a few seconds after copying, then
restores the copy icon.

Guest access is limited to the call room; joining does not expose the channel or grant
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
