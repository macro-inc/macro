# Calls

## Calls — `/app/calls`

The Calls list starts with the Calls `TutorialRow` (from `features/video-tutorials`) once that video is in its catalog; it sits below the touch inset, outside the virtualized rows.

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
Verify signed-in joins for both instant and scheduled links with
`enable-programmatic-calls` on and off: the app's empty POST must work even
with its `Content-Type: application/json` header. Guest joins send a JSON body
through the separate public endpoint.
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
search, returns to the list. Shift+Enter and Open in new split open the recording
in a second Calls view. Old copied `/app/call/<callId>` links redirect to the Calls
detail without losing the transcript target. Existing `/app/drive/call/<callId>`
links still work. A failed load shows Retry.

### Saved call detail

On desktop the header keeps the breadcrumb, the call's More menu, Call again before Ask Macro,
combined Share/copy-link control, and the details toggle. Calls and Drive use the
same More menu for call actions, including rename, recording download and delete.
The channel appears above the title, with the
participant avatars before the start/end time range. Call again keeps its existing
availability checks in the header; active calls retain Join call below the title.
The existing tag picker sits below the title metadata and uses the call's property tags. The recording
precedes the stored summary and read-only Call chat. Summary headings are the
stored Markdown, not generated client-side sections.

The full-width top bar stays above the content, with the standard details toggle.
Details opens in the existing floating popover below the header, without
Transcript/Details tabs. On touch it uses the standard details drawer.
At call-column widths of 1108px or more, a 480px Transcript card sits beside
an at-most-720px player, with the existing 28px section gap. The centered group
caps at 1308px including 80px of page insets, preserving the original 800px
content wrapper's player width. The threshold leaves at least 520px for the
player; split panes switch independently of the window. Identity spans the
group, aligned to the video's left edge. The left column scrolls through
the player, Summary and Call chat while the transcript stays in view and scrolls
internally. The card uses the next Layer surface depth, the player's corner radius,
a light-theme inset edge and shadow (dark stays unchanged), and an inset Sync surface in both themes. Details floats over
the card without changing its scroll position or follow state. There is no separate
Transcript header button. The card fades and slides into wide layouts while the player animates from its
previous width and position over the same 240ms curve, rather than jumping to its
narrower width first. Reduced motion disables both entry animations.
Fullscreen opens the recording workspace with the same video and transcript.
The player's Transcript toggle hides or shows the right panel until fullscreen
exits; narrow HTML fullscreen uses a right overlay. Native iOS video fullscreen
remains video-only. Playback, seeking, manual follow and Sync retain their state.

Transcript rows show a flush-right recording time, with the active waveform to its left; long speaker names truncate and reveal the full name in a
tooltip on hover or row focus. Click or press Enter on a row to seek.
The active line reuses the live-call waveform and its bar timing on desktop,
driven by recording playback. It stays still when paused, on phones, or when
reduced motion is enabled. Playback follows the transcript until the user
scrolls away; Sync to video sits on an opaque floating pill above pinned or phone
playback and returns to the current line. Authorized chat messages
appear inline at their recorded moment. Details keeps owner, dates, duration,
status, channel, team sharing, properties, activity and references on their
existing permission-scoped readers. Only team sharing has a card, always visible below metadata with no collapsible
Sharing section; other sections use the shared floating-detail rows and standard
dividers, matching other entity detail popovers.
After a call ends, only its starter can change team sharing. Other viewers see
the current state and an explanation naming the starter, not a disabled switch.
Until a display name is available, the explanation says only the person who
started the call can change sharing; it never substitutes their email.
An editable switch stays disabled while its change is pending.

Below that threshold, medium-size Summary/Transcript tabs sit below the recording.
The inline transcript list has no horizontal padding, aligning its row edges with
the tabs and Summary. The tab selection and one mounted video/transcript survive resizing in either
direction. Summary has an AI icon before its tab label and wide-pane heading;
hovering or focusing either shows “Written by Macro after the call” in a tooltip, rather than
a separate credit line. The credit remains the Summary tab's accessible description
on touch, where tooltips stay disabled. Details starts closed and
floats over content without moving it. Playback remains reachable in a pinned bar
after the recording scrolls above the viewport. Its width follows the left column
on wide panes and the centered content column on narrow panes. Show video returns
to the recording; all controls drive one media
element. Chat jump chips use message time relative to recording start and appear
only within the known recording duration. Attachments retain their usual cards.
There is no caption control without a caption track or synthetic speaker video
layer over the recorded composite. After 2.5 seconds of idle playback, controls
slide down by their own height and fade out over 240ms, and the cursor hides,
including in fullscreen. Only transform and opacity animate; the page stays still.
Movement, focus or touch brings them back; pause, control hover, control focus and
open menus keep them visible. Reduced motion uses only the fade. Speed uses a dropdown, and volume opens a vertical slider above the mute
button on hover or focus. Clicking the icon still toggles mute. Both sliders keep
white thumbs across themes. Dragging the volume thumb, clicking its track, and
arrow keys update native volume immediately without closing the popover.
Clicking the picture toggles playback without intercepting controls or overlays.
On touch, the first tap reveals hidden controls; a tap with controls visible toggles playback.

Phones use separate Back, title-menu, and Details header islands. The player
comes before identity, then Summary/Transcript/Chat tabs with the real chat count.
Ask Macro floats above the dock on Summary and Chat. The avatar chevron opens the
participant list. Details opens the same content in the standard bottom sheet. In the scrolled Transcript tab, manual downward
scrolling replaces the navigation dock with the mini player; scrolling upward
restores navigation below it. Search, the keyboard, and leaving the view release
that chrome. No Call again action appears in the phone header.

While a call is in progress, Join call below the title remains available on both
desktop and phone, except when already connected. This is separate from the live
call controls. `call_transcript_id=<segmentId>` seeks the matching segment;
`call_message_id=<messageId>` opens the phone Chat tab and highlights the message.

Check a saved call with recording, transcript, summary, chat and attachments at
1920x1080, 1440x900, 1280x800 and 1024x768, in splits on both sides of the 1108px
call-column threshold, in 680px and 480px splits, and at 390x844 with touch emulation. Cover
Details over the Transcript card, both themes, independent scrolling, retained tab
and playback state after resizing, pause/seek/skip/speed/fullscreen, scroll-follow
and Sync to video, pinned playback, phone scroll direction, Details dismissal,
and switching away while playback chrome is mounted. Also check calls without a
recording, standalone guests, private channel access, owner/non-owner sharing,
a direct link, both old link formats, repeated transcript targets, Calls-list
return, a second split, and Back/Forward.

Saved call route loading records `call.record` and `call.discussion` phases on the
existing view trace. Reading-tab selections record `call.detail.tab`; attributes
contain only the call ID and tab kind, never transcript or message contents.

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

The rail's live waveform opens a 300px popover without leaving the current view.
It shows the call title and duration, current attendees and compact media controls.
The popup and floating player reuse the full call's microphone, camera/background
and screen-audio caret menus, without the full toolbar container.
Open call returns to the existing meeting/channel route. More offers
**Show floating player**, **Copy meeting link**, and **Full screen**. Copy creates the link
only after explicit selection and reports success or failure. More stays available
when copying is its only action. The grouped dropdown opens below More and aligns
to its right edge. Away from the channel's Call tab, the desktop player
starts bottom-right, follows the speaker and gives screen sharing priority.
Speaker changes wait 650ms to ignore brief gaps, then crossfade over 200ms. Screen
shares and participant departures update immediately. Reduced motion skips both
the hold and the fade; outgoing controls stop accepting input during a transition.
Drag its header freely within the window. The nearest corner glows faintly within
120px, strengthening until both edges reach the 24px snap range. This
edge-anchored success gradient previews the snap, fading
toward the centre with only the two outer edges marked. Release there to ease
into that corner, or elsewhere to keep the dropped position. The indicator
fades over 150ms; reduced motion shows/hides and snaps without animation. Collapse
tucks it back into the rail. **More → Reset position and size** clears saved
size preferences and restores the 336px player to the bottom-right corner.
Resize from any edge or corner; video/screens remain 16:9 and audio retains its
minimum height. Width is capped at 960px, or the available window width/height
when smaller. Width and audio height persist as local preferences; the player
reclamps to the viewport when media or window size changes. Short windows cap
the player's outer height and allow its contents to scroll; only the pointer
that began a drag or resize can update or finish that gesture.
Audio-only calls keep a 144px minimum stage with a neutral 48px avatar and name,
rather than collapsing to a thin row. Channel and standalone
calls navigate and leave through their existing session owner; standalone calls
do not depend on the quick-call feed loading first.

The desktop Chat sidebar has no separate Live section. Live calls are marked
on their conversation rows with a waveform and elapsed time. Your current call
uses the waveform as its channel icon and shows live participant avatars.
Ringing conversations keep their existing Answer and Decline actions; these
use the real incoming-call signal rather than treating every active call as ringing.

Only the current call's desktop Chat sidebar row, channel-header duration pill
and app-rail item use live waveforms; all other call and phone surfaces use the
original static icon. Live waveforms animate only while someone in the joined
call is speaking, using the same speaking state as the participant tiles. Silent calls, other live calls
without speech data, and reduced-motion preferences show a low, even five-bar
resting mark. Speech eases into the existing waveform loop and settles back to
that resting mark when speech stops.
Speaking participants have the same success-colored ring in tiles and the
filmstrip, the Participants roster, header/sidebar avatar groups, and the floating
player. Avatar groups without a matching joined room have no speaking ring.
Browser calls sample existing microphone tracks for quieter speech, with a
250ms release hold between syllables; muting clears the indicator immediately.
This visual-only detector changes no microphone gain, noise suppression or
transmitted audio. It retries after returning to the tab or starting a microphone.
Unavailable analysis, including temporarily unsubscribed tracks, falls back to
LiveKit speaking state. Background noise can also activate this audio indicator.

### Calls whose discussion is a channel thread

With the `enable-call-channel-thread` server flag on for the caller, a new call in a channel stores
`channel_thread` as its discussion, and `CallRecord.discussion` says so. Past channel calls, calls
already running, and calls with no channel keep `call_chat`, and behave as described elsewhere here.

While a call is active and you have not joined, a compact **Call in progress**
card stays above the composer with a light success tint, live duration, attendee
avatars and **Join**; both themes keep the normal readable text rather than a solid green fill.
The channel header also shows attendees, duration and Join. The live status pill
opens the call tab: its pre-join screen when outside the call, or the live view
when already connected. Clicking that pill never joins automatically. On phones, Join is
a success-colored phone icon and the compact card keeps up to three avatars. While you are in
the call, Messages shows the live waveform/duration chip instead of a Return button. Joining uses the
existing call action; no call is started merely by opening the channel.

In the channel, the call is also a row at its start time: `<name> started a call`, the call time, live
avatars and **Join** for viewers outside the call, with the thread collapsed under it, which replies like any other thread.
When it ends the line says how long it lasted. The join card remains above the
composer while the viewer is outside the call, independent of scroll position.

In the call, the panel opens on desktop and tablet, closed on phones. Its first tab is **Chat**.
On phones, Chat and Participants fill the shared sheet's tab row; Participants keeps the attendee count. The sheet opens at 65% height. It shows the channel up to the call's row, opened on the call-specific chat illustration at the default 192px size and “Start the conversation.” when the thread is empty
and at the newest message otherwise. The composer shares the messages' horizontal inset
in both docked and overlay panels while keeping its bottom spacing. The composer opens as a plain message input bound to the call discussion. Reply
mode appears only after choosing Reply on a message, with target navigation and
**Stop replying** available; closing or sending that reply returns to the plain
call composer without replacing its editor. The call root remains above the conversation;
replies show root-style avatars, names and times without thread rails or indent.
This is presentation only: nothing posts top-level from the panel. A popup counts top-level messages
others have sent to the channel since you joined, and **View** swaps to the Messages tab with the
call still connected. On the meeting page it navigates to the channel.

People connected to the call get no notification from its thread, mentions included; they stay
followers, so later replies reach them after they leave. The call's root accepts replies and nothing
else: no edit, delete or reactions. On a call's record the chat is read-only;
its contents require channel read access. Deleting a record leaves the thread in the channel.

To verify, turn the flag on for your test user in PostHog, start a call in a channel from one account,
and open the channel from a second. Check replying from each side, a quote reply inside the thread,
that no notification reaches the person in the call, and that ending the call updates the row.

While you are in a call, a green phone button (`Return to call`,
`data-sidebar-next-item="active-call"`) sits at the bottom of the desktop rail,
above Settings. It opens the channel's Call tab, or the meeting page for a quick call.

In the native iOS call drawer, the horizontal participant row excludes the person
shown in the large video. While holding or scrolling the row (including momentum),
the displayed primary and row membership stay fixed; speaking indicators still
update. The latest primary and membership update together after scrolling settles,
preserving a surviving participant's position where possible. Verify that dragging
does not pin someone, tapping pins the displayed person, and a participant who
leaves during a held touch cannot be selected. Exercise speaker changes and
departures during row gestures on a physical iPhone as well as the simulator.

Leaving a native iOS call is final. The drawer's **Leave** and CallKit's end
button both end the CallKit call, its LiveKit room, the drawer and PiP, even
when the native session has already lost track of the call. PiP and the drawer appear only while a call is active, so
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

If a recording fails to play, reload the page to obtain a fresh recording link,
or use **Open or download recording**. The playback warning does not assume
that the failure is caused by an unsupported media format.

Where a call shows the block header's "…" menu (Rename, Delete), that menu
also offers **Download** when the call has a recording. It saves the recording
under the call's name with the recording's extension (`<name>.mp4`), through the
same download flow and confirmations as Drive files.

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
Messages on leave and stay in the channel, even when that hangup ends the call.
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
In-call grid tiles fill their cell but are never wider than 16:9. A staged camera
or screen retains its track's aspect ratio; pinning uses the same fixed-size
strip as Speaker or Sidebar, without remounting tracks. Short Sidebar stages
shrink strip tiles to keep every participant accessible. Hiding the strip also
hides non-stage screen shares without stopping their tracks. Unpin restores the
selected layout. Check landscape and portrait cameras, shares, and 3–6 people.
Participants with the LiveKit `macro.program` attribute show an **Agent** badge
beside their name on video tiles, screen shares, and in the Participants list,
including on phones.

The join screen has microphone, camera, and background effects buttons over the
preview, with pill selectors below for microphone, speaker, camera, and
backgrounds. The background button over the preview toggles the selected effect
off and back on; when no effect has been selected, it enables Strong blur.
Backgrounds use a simple menu with None, Light blur, Strong blur, and image upload
(JPG, PNG, or WebP, up to 10 MB). None, Light and Strong show the same room
illustration, with only the room blurred and the person kept sharp.
Background pickers share five device-local recent uploaded images. Selecting one
moves it first; hover/focus Remove or press Delete/Backspace to remove an inactive
image immediately. Removing the current image asks for confirmation, turns the
background off, then removes it from recents. Cancelling preserves both. Uploads stay usable if optional
IndexedDB storage fails. Selected devices and backgrounds carry into the call; unsupported browsers use
the system speaker. If a background cannot be applied, the camera stays off
until the user retries or chooses None. The screen uses a gray join
button. In a channel's Call tab, the header shows the live waveform and duration,
then an icon-only meeting link and Invite. Below 560px of header width, the
duration pill hides so the channel title and tabs retain room; Call tabs, join
cards and the app's live-call entry remain available. The link is fetched only when copied.
Active phone calls fill the viewport and retain Back, channel title and live status.
The speaker button sits before the live time in channel and standalone call headers.
It opens Audio output with the available routes and a check on the active one.
Native channel calls use their system routes; connecting or removing a headset updates
that check and the native video speaker toggle. Browser calls show the button only
when `setSinkId` supports output selection, using the same Speaker devices as
call settings. Older native builds without the route commands hide the button.
The header shows the current local time before the call name. Owners can click the name
to rename it, then Save or press Enter; Cancel or Escape discards the edit. Guests and other participants see a
read-only name.

Join-preview and in-call controls use the standard Macro icon buttons.
The full and compact call bars keep split and standalone controls at the same
outer height (40px and 32px respectively), including each split frame's border.
Desktop popover and floating-player controls use 14px glyphs, including their
reaction and leave actions, without shrinking buttons or carets. Main and phone
controls retain their existing glyph sizes. In a
call, one floating-menu surface with a hairline edge, soft shadow, 8px padding
and 8px gaps contains mic, camera, screen sharing, Team, More and Leave. The chat toggle stays outside this panel. The microphone and camera
are split buttons (`ButtonGroup`): the left half
toggles the device; when muted or off, both segments use the subtle danger
fill and failure ink. Browser-blocked devices instead stay neutral with a muted
slashed icon and amber warning badge. Their label explains browser settings;
pressing the badge or button retries, and device menus stay available. Retryable
permission prompts use the browser's capture request. Denied access opens brief
browser-specific instructions with Try again; the macOS app also offers Open System
Settings for that device's privacy pane. A pending camera request does not block
microphone actions, or vice versa. Failed capture recovers after permission changes
or returning from system settings, without reloading; stale calls cannot recover.
Help stays anchored to the selected device. Cancel or Escape returns focus to that
media button; clicking outside preserves the newly focused control.
Only successful capture clears a previously failed device's warning. Connecting controls remain neutral and
dimmed. The caret
opens a settings menu above the toolbar on click only; hovering opens nothing.
**Audio settings** lists microphones, speakers (when the browser can choose one),
and a noise suppression switch with its label on the left.
**Video settings** lists cameras and the background effects as tiles: None,
Light blur, Strong blur, Recent images, and Upload in one even grid. In-call blur
tiles show independent live previews of your camera with the same background
processor while the menu is open (8fps on its canvas fallback); they never modify your published
camera. Off, denied or unsupported cameras show a neutral effect tile. Screen share is
also a split button: the left half starts or stops sharing (pressed while
sharing), and **Screen share settings** holds **Share audio**, off by default,
saved per device, and locked while sharing. Its disabled row stays focusable:
hover or keyboard focus explains “Stop sharing to change this” or, while
connecting, “Available once you've joined”; the description is also announced
to screen readers. The compact row aligns its speaker
icon, title and switch on one line. With it on, the browser picker offers
tab audio (and system audio where Chromium supports it), and other participants
hear it alongside microphones, even away from the Call tab. Leave call is a
separate button. Live channel calls also include **Call sharing** in the toolbar:
its **After the call ends** menu offers **Share with team** and **Channel only**
for channel-thread discussions. Legacy call-chat and standalone calls retain
**Private** rather than promise channel access. The control shows Team, Channel
or Private with the corresponding icon and a caret; it locks while saving.
Desktop and tablet keep the device settings dropdowns. The phone call's sharing
control uses the shared bottom drawer; its media buttons are single-tap toggles
without device carets.
The sharing icons align with the option titles, with short descriptions below.
Click outside or press Escape to close and return focus to the opener. The
controls also work by keyboard and touch.
The floating mobile **New** action is hidden while the call view is open and
returns when you leave the call view. Phone calls also hide the app's bottom
navigation and channel Invite action, but keep the channel header island visible.
Invite returns when you leave the call tab, including in the block-hosted channel
header; Invite remains available on setup screens, desktop, and tablets. Back
returns to the app without hanging up; when a channel has no navigation history, Back opens its
Messages tab instead. Only **Leave call** ends participation.

On desktop, pin a participant, yourself, or a shared screen to take the stage; see [Pinning call tiles on desktop](#pinning-call-tiles-on-desktop). A phone tap does not pin; hold a tile for its Pin/Unpin menu.
A talking participant has a success-colored border above their video or avatar.
Camera-off tiles are flat and show a neutral initial, never a profile-color gradient.
In desktop Auto layout the self view floats at the bottom-right beside the controls,
or above them while chat is docked, unless pinned. Grid, Speaker and Sidebar keep
the self view in a grid or strip tile. Alone, your tile fills the stage in every layout. Muted icons sit beside the participant name.

A shared-screen chip leads with its screen icon, then the presenter's avatar
and name. A hidden-participant speaking chip uses the same order with a waveform; the
presenter's tile also carries a screen icon. Local sharing shows **You're sharing
your screen** and **Stop sharing** instead of recursively playing your own display.
The call bar uses the vertical three-dot More icon; the live-call popover keeps
its horizontal icon. Desktop **More → Layout** offers Auto, Grid, Speaker and Sidebar and remembers
the choice for later calls. Auto keeps the existing behavior; Grid gives people
equal tiles; Speaker puts the active person or share above a filmstrip; Sidebar
puts that strip on the right. Phones always use Auto.
**More → Hide participants** hides the strip and self view during screen sharing,
leaving a speaking-person chip on the share. It resets when sharing stops and is
not shown without a share. Hover or focus the shared screen to reveal the same
visibility toggle on its bottom edge, or its right edge in Sidebar. The caret
flips while hidden. Grid has no edge caret; its equal participant grid remains
controlled through More. Tracks stay mounted and audio continues.

Desktop **Reactions** beside Team opens a one-row picker with arrow-key navigation.
The picker stays open for repeated reactions; in compact call panes it moves into More.
The live-call popover and floating player offer the same compact reaction picker
and 8px-spaced media controls; the popover header stays unchanged. The player shows incoming
reactions at mini scale, and marks the local preview when the microphone is muted.
Choosing an emoji sends a temporary reaction to the connected room, not
chat history. The emoji pops in, rises gently with a slight sway and fades over 3.2 seconds;
quick repeats start at slightly different horizontal positions. When the
sender's tile is off screen it appears at the stage's bottom-left. Reduced motion
fades in, holds, then fades out without movement or scale. Reactions have no sound and disappear when leaving.

Desktop **More → Full screen**, including the rail popover, expands only the call area.
The call area lays out its stage and initial panel before a single short fade;
reduced-motion settings omit the animation.
The call chat panel stays attached while crossing the docked/overlay width
threshold; its draft, active thread and reading gap survive reflow.
The call provider owns a persistent fullscreen target so a popover action enters
fullscreen during its click before the call route loads. The same item becomes
**Exit full screen**; browser Escape also exits. Call menus and tooltips remain
inside the fullscreen surface. Unsupported webviews disable the action.

Desktop **More → Keyboard shortcuts** opens a four-row call-only popover.
While the call view is open, ⌘D toggles the microphone, ⇧⌘E toggles the camera,
Space holds the microphone open only in the focused call view while muted,
and ⌃⌘F toggles full screen. Non-Mac desktops use Ctrl for ⌘ and F11 for full screen.
Space ignores text fields, editable content, buttons and ARIA widgets. Releasing
Space, losing window focus or leaving the view restores mute; cancellation also
retires permission recovery so a later grant cannot enable the microphone. A
delayed action never mutes a replacement call. These
bindings use the app hotkey registry without changing the global shortcut sheet.

Open **Chat** and **Participants** from the button beside the media controls.
The call discussion reuses the main channel panel and its thread/draft owner.
Its composer says **Message this call…**, has no reply flag, and still posts into
the call thread. Call replies render as a flat list without thread connectors.
The sidebar and phone drawer share a compact grouped section switcher at the top.
**Participants** shows the live attendee count on phones and a scrollable roster, including
you and connected guests but excluding recording agents. Rows show names,
avatars, microphone and camera state, and a speaking indicator. Off microphones
and cameras use the failure color. Known users use the shared user icon:
hover it on desktop or tap it on touch to open the profile card; guests use
the shared avatar fallback.
This is the current call roster, not the channel member list. Participant media
controls remain read-only. The roster remains available when chat is unavailable,
without starting message queries.

On phones, the full-screen call puts the self view in the participant grid.
Away from the call, a separate live-call island sits above the phone dock with
the speaker's neutral avatar, call name, duration, mic and Leave. It occupies its
own float region so channel/email composers remain available. It hides with the
keyboard and while the Call tab is open. Tap the name to open the call.
Mobile conversation rows show live duration or inline ringing actions instead of
the normal timestamp; the current call uses a waveform avatar.

A compact bottom island holds microphone, camera, Team/Private and Leave;
Chat is a separate island beside it. Both keep the safe-area gutters and stay
below the tiles. The phone island has no screen-share button or device carets.
The desktop control bar is centered beneath the tiles and the chat toggle sits
at the stage's right edge, including when chat is docked. The toggle uses the
same floating surface and shadow as the pill. Its desktop button matches More:
40px normally and 32px beside compact controls, with a 20px glyph. When space is tight,
the pill shifts left to preserve the toggle and at least an 8px gap; there is no
invisible balance element. The self view stays above the controls row. The
toggle uses the primary button's inverted colours while open; existing
discussion/Work updates retain their badge at the edge.
On desktop channel calls, the meeting-link action lives in the header, not the
footer. Phones retain their channel header islands. Media controls occupy a
separate row below the video, never over it. Controls remain visible while idle;
auto-hide is disabled for now. Header islands also stay visible. Check 320px
phones, safe-area insets, and rotation.

In wide desktop panes, the sidebar fills the call content height alongside the
video and controls, with an opaque `surface-2` fill and rounded corners, without
a border. A soft shadow separates the docked card in light mode; dark mode
stays shadowless. The inset card in a narrow desktop pane uses the same
fill with a drop shadow; the phone sheet keeps its own surface. Tabs, message
hover, composer and empty-state styles remain shared. Drag its divider, or focus
the divider and use the arrow keys, to resize it between 280px and 480px while
leaving at least 320px for the call. It starts at the shared 380px SidePanel width and retains its resized
width when closed and reopened. Below 640px, media controls use the compact
button sizes and the self view joins the grid. Narrow desktop panes overlay the
whole call, controls included, with an inset full-width chat card;
phones use the shared bottom sheet instead of a resize handle.

Desktop has a **Close chat and participants** button beside the tabs.
Dismiss the phone sheet with its handle, backdrop, or Escape; desktop also
closes with Escape. Explicit panel toggles animate unless reduced motion is enabled;
returning to the call mounts the stage and default-open panel in place without animation.
The desktop sidebar stays anchored to the right edge and closes to the right,
without crossing the call area. Closing returns focus to the footer button.
Switching tabs, closing, and resizing preserve the message draft and scroll
position. Tab changes keep keyboard focus on the selected tab instead of moving
it into the composer; reopening retains the existing autofocus behavior.
Message hover actions stay within the chat's scroll viewport. The toolbar wraps
its action groups when the sidebar is narrow, keeping the final actions inside
the visible surface. Check the first and last visible messages while scrolling,
with every action available. Check both signed-in and guest calls.

In the macOS desktop app, Screen share opens Macro's own **Share your screen**
picker (screens first, the main display preselected, then open windows), since
its Chromium has no system picker. Share publishes the chosen source; Cancel
leaves sharing off. Without macOS Screen Recording access the picker says so
and macOS shows its prompt; the user reopens Macro after allowing it. A refused
or failed capture shows its reason under the call controls. Browsers
and older desktop builds keep the browser's own picker. Verify on a Mac by
sharing a display and a window, stopping, and cancelling the picker.

### Programs in calls

An agent account joins with its own API key through the SDK. Starting a channel
call uses `POST /call/{channel_id}`; joining an existing call uses
`POST /call/record/{call_id}/join`, which never starts one. Meeting joins use
`POST /call/meetings/join/{token}`. When only programs have remained in a call
for 60 seconds, the call ends automatically.

### Pinning call tiles on desktop

Hover or keyboard-focus a participant, your own view, or a shared screen to reveal Pin. Clicking the tile also pins it. The pinned tile takes the stage, with everyone else, including your own view, and active shares in the strip. A share normally occupies the stage when nobody is pinned. Hover the pinned tile for Unpin, or click it again. Switching directly to another tile replaces the pin. Pinning uses Speaker placement unless Sidebar is selected and never changes the saved Layout choice. If the pinned person leaves or the shared screen ends, the pin clears and does not return on reconnection. Pin actions record `call.pin` interactions. On phones, hold a tile for the anchored Pin/Unpin menu; plain taps do not pin. The selected tile lifts above a dimmed stage. A pinned person fills the top, with everyone else including you in one row below. The Unpin pill stays visible on phones. Moving the touch cancels the hold; Escape or touching outside dismisses the menu.

On supported desktop browsers, hover or focus a remote person's tile for Volume,
beside Pin. The same control is available in the call roster and floating player.
The slider changes only that person's microphone playback for you, from 0–100%.
Drag up to increase volume, click the track to jump, or use the wheel and arrow
keys for one-percent steps. The narrow popover has no visible heading.
The small avatar above the slider is the viewer; its tooltip and
the slider label explain that only this device changes. The thumb uses the
shared white switch appearance. It survives track resubscription and leaving the call view, but resets
in the next call. Your own tile, agents, phones and native mobile apps do not show
it; screen-share audio is unchanged. Only an explicit 0% choice marks a person as
muted for you; an unset SDK gain never does. At 0%, the speaker control and that person's
tile/avatar show a muted-speaker badge labelled **Muted for you**, distinct from
their microphone status. Their own muted microphone keeps a crossed-out microphone
with a **Microphone off** tooltip. When both states apply, both indicators remain
visible on tiles, avatars and in the player and roster. Raising volume clears only
the personal-mute badge across call views.

### Work in a call

Behind `enable-agent-work`, the call panel gains a **Work** tab, after Chat and
Participants, while any other participant has registered work you can open.
Chat stays the default tab. Each participant with work gets a section; rows keep
their order, and clicking one opens the session in a new split so the call stays
live. Registering is SDK-only (`session.registerAsWork()`).

A dot marks the Work tab while you're elsewhere and the panel button while the
panel is closed. A **View active work** prompt with the participants' pictures
appears above your video tile when someone's work first shows, for eight seconds
or until dismissed; clicking it opens the tab. It belongs to the call rather than
the toast system.

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
device lists and effects. `call.media.screen_share` records which picker ran
(`native` or `browser`), Screen Recording access, the source count and kind,
and whether the user cancelled; failures add the underlying
`call.media.screen_share.error_type`. A completed join/setup does not imply every device
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

A channel call's **Share** dialog has a `Team access` control (None or View) for the
same canonical team share. Saved-call Details keeps an always-visible **Share
with team** card below metadata.
While a call is live, the controls bar instead has a **Call sharing** dropdown with
**Team sharing** and **Private** options. Each option explains the resulting team
access under its name; choosing the current option does not save again. Controls
are disabled while connecting or saving. Team sharing is canonical **view** access
(the same `Team access` model documents and AI chats use), enabled by default for
channel calls. Any participant with edit access can change it, and other
participants see it update live. When the call ends, **Team sharing** lets the
creator's team open the recorded call, read the transcript and AI summary, and find
it under Calls and in search; **Private** grants no automatic team access.
Afterwards only the call's **creator** can change it; everyone else sees the
current sharing state and an explanation naming the starter, without a switch.
Team sharing is independent of channel access and of link sharing.

Standalone instant and scheduled calls are excluded from team memory. They have no
team-sharing or `Team access` controls during the call or on the saved recording.
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
reopens the drawer. Leaving the channel does not end the call. While ringing,
a locked phone opens a full-screen incoming-call screen when permitted, with
caller initials/name, channel context and large Answer/Decline controls. Back
hides this screen and leaves the call available in its notification. Incoming calls
also expose Answer/Decline in the **Calls** notification channel, including while
locked/backgrounded. When full-screen access is unavailable, the notification
remains usable; Answer opens the call screen directly for microphone permission
and retry errors. Verify allowed/denied full-screen access, missing microphone
permission, cancellation/expiry and stale notification actions after a replacement
call arrives. While Android 14+ blocks full-screen notifications, a toast
offers **Allow** (system setting) or **Not now**; returning to Macro with access
granted removes it. PiP is a native, device-dependent
flow. Browser-only tests cannot validate Telecom, FCM wakeup or background media;
follow the hardware matrix in [Android development](../development/android.md#native-calling).

Synthetic emulator captures: [incoming screen](media/calls/android-incoming-call.png),
[notification fallback](media/calls/android-call-notification.png), and
[microphone permission after Answer](media/calls/android-call-microphone-permission.png).

### Microphone permission in the mobile apps

Calls ask for the microphone when the user starts, joins or answers one, before
the join request: Android through `prepare_join` and the call screen's Answer,
iOS through `request_microphone_permission`. iOS shows its prompt once and
Android stops showing it after repeated denials, so a denial points to Settings:

- Android native calls can't connect without the microphone. A denied join
  says so instead of blaming the connection and shows a **Microphone access is
  off** toast with **Open Settings**; the call screen shows **Open settings**
  after a denied Answer or camera request.
- iOS native calls join muted. Whenever the call tries to unmute (on connect,
  from the drawer, or from CallKit), the native session shows a **Microphone
  access is off** alert with **Open Settings**.
- Calls in the browser engine (meeting links, and builds without native calls)
  join muted; the join and each failed unmute show the same toast, with **Open
  Settings** only in the iOS and Android apps.

Verify by denying the prompt, then joining again after access is off in
Settings. `call.microphone_permission.request` and
`call.microphone_access.open_settings` spans record the outcomes.

Native Android call spans use service `android-calls` and the opaque `call.id`.
The existing telemetry gate also controls cold calls. W3C context connects the
push producer, notification/activity, permission and answer phases, and status
HTTP requests; connection and cancellation outcomes end the incoming trace.
For local collector verification and the exporter fixture, see
[native call tracing](../development/android.md#native-call-tracing).
