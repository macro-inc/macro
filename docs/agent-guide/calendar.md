# Calendar

## Meeting notes

Meeting notes require `enable-calendar-meeting-notes`. It is on automatically in
dev; production uses PostHog, enabled for `@macro.com` users. `VITE_ENABLE_CALENDAR_MEETING_NOTES=true` or `false` overrides it locally.
With the flag off, event notes and document Share meeting-link controls do not
mount or request note data, on desktop or phone. The flag does not revoke saved
meeting/team grants or change API permissions.

Open a live meeting's details and choose **Create** beside **Meeting notes**.
This creates a Markdown document named after the meeting, links it with meeting
viewer access, and opens it immediately. Team access starts off. A meeting can
have multiple notes; **Create** and **Link** remain on the section title row
so you can keep creating notes or linking existing documents.
Both actions are available while notes load. Reopening a recently viewed event
uses cached notes immediately while stale data refreshes in the background.
The picker can open while existing links load, but submission waits for that
check so selecting an already-linked note cannot change its sharing.

Choose **Link** to search the titles of Markdown documents you own, select one, review
the sharing explanation, and optionally include your existing team before
**Link note**. Team access starts off for each note. Recurring meetings link only
the displayed occurrence. Notes on a
one-time meeting follow it when its date or time changes.
Existing document editors and other sharing keep their access.
Notes use the event details' existing row layout and controls. Team choices come
from current Macro team memberships; they do not introduce departments or subteams.

Linked meetings also appear in the note’s side-panel **References** section.
Only readers with meeting-detail access see those references; owners retain safe
unavailable-meeting entries.
Click a meeting reference to reopen that exact occurrence. If the calendar
backend has not yet deployed embedded reference previews, the dialog reports
that meeting details are temporarily unavailable and offers **Retry**. Missing
fields must not be described as removed meeting access.

Open the linked title to read the original document. On desktop it opens in a
new split; on mobile it replaces the calendar pane and closes event details.
Opening a note leaves focus available to the document as it mounts; dismissing
desktop details normally returns focus to the calendar event.
Meeting access and occurrence scope are explained in the linking dialog;
each note shows any additional team audience. **Options → Share** opens the same
document Share dialog as the note toolbar. Its **Meeting links** section lets the
owner change each link’s optional team access. **Options → Unlink from meeting**
removes this meeting’s grants without deleting the document. Keep the labeled
Options button visible beside long titles; truncate the title without widening
the event details. Labeled note controls do not need extra hover tooltips.
The linking dialog uses a wider desktop layout and a phone sheet. Only the
document results scroll. The picker starts with owned Markdown matches from
Quick Access's local cache, then adds the calendar notes endpoint's title
results (up to 30 per query), not full-text search. Matching results stay visible
while typing and searches are cached across opens. The meeting context,
sharing controls, and action buttons stay visible, including in a short viewport.
A former team’s grant can be removed in Share while the meeting is still visible;
unlinking remains available even if the meeting is no longer accessible.
Failed saves retain the selection and audience for retry; dismissing starts fresh.
If creation succeeds but linking fails, **Retry linking** reuses the saved document;
**Open saved note** lets you continue editing before the link is confirmed. Closing
details never deletes that document; it remains in Drive. Changing the selected
meeting or account prevents a late creation result from navigating away from the
new selection.

Owners can also open the markdown document's **Share** panel and find **Meeting
links** (inside **Link** on mobile). Every saved link remains removable here even
if the meeting was cancelled, fell outside the sync window, or stopped being
shared with the owner. **Unlink** asks before removing its meeting/team grants.
Unavailable meetings use a safe label rather than revealing private details.
Checking **Also share with Macro** also updates **Team access** to **View via
meeting** when there is no direct team grant. The dropdown's **Use meeting
access** option removes only additional direct sharing; uncheck the meeting's
checkbox to remove its team grant. Unlink stays in place while a team save runs.

Full-detail team events expose the same note controls; provider actions such as
editing the event or RSVPing stay unavailable. Busy-only team entries and
imported snapshots have no meeting-note controls.
Inherited access follows current meeting details and requires a synced live
occurrence. If the provider hides its guest list, some guests need a direct
document share. Independent team sharing lasts until the link is removed or the
viewer leaves that team; it does not make the calendar event visible to that team.

Verify on desktop and phone: create and open notes, add a second note, retry a failed
link without duplicating the new document, link an existing note with team unchecked,
add/remove a team in Share, and unlink while keeping the document. Link a long
title and verify its Options menu opens without horizontal scrolling. The
backend-free browser suite mounts the real event popover and mobile drawer with
sample data and preview service adapters. It previews the real meeting-access
controls inside a sample Share shell; verify the full Share dialog in the app
as well. It is
`apps/web/src/features/calendar-notes/browser-test/playwright.config.ts`.
API permission cases are covered in `crates/calendar_events/src/outbound/pg/test/notes.rs`.
The fixture accepts `?notes=off` to check the event details without notes.
Use `?team=details` or `?team=busy` to check team visibility boundaries.

Browser fixture screenshots: [desktop](media/calendar-notes/desktop.png) ·
[phone](media/calendar-notes/phone.png) ·
[desktop picker](media/calendar-notes/link-desktop.png) ·
[phone picker](media/calendar-notes/link-phone.png).

## Calendar — `/app/calendar/<month-or-week-or-day>`

Microsoft calendars use the same editor and calendar views after calendar consent.
Conference choices follow the selected calendar's capabilities: Microsoft Teams
where supported and Google Meet for Google calendars. Selecting a calendar that
cannot create a requested conference shows an error until the request is resolved;
editing an existing meeting preserves its conference. Email reminders are sent to
the connected calendar mailbox. Outlook out-of-office automatic replies show an
uncertainty notice if a provider response cannot be confirmed; a reconnect must
not resend an already attempted automatic reply.

Google Meet joins from event details, the upcoming-events sidebar, and calendar
search use the displayed occurrence's connected calendar email as `authuser` when
that account is known. Existing parameters such as `hs` are preserved. Copied call
links keep their original URL so they can be shared with other attendees. Verify
desktop and mobile Join with work and personal Google accounts signed in; a work
calendar should open Meet with the work account. Search results without loaded
calendar account metadata and other conferencing providers keep their original URL.

Event composer dropdown triggers and date/time inputs use the theme control
surface, so they blend with the dialog instead of using the darker page fill.
Their menus stay inside the composer's portal scope. Verify that calendar,
recurrence, Guests, conferencing, Location, and Notifications open on the first
click from the title field and accept changes without closing the composer.
Each end is a date button (its calendar closes on a pick) and, unless all day,
a time field: type `3p` or `15:30` and the list jumps there, Enter commits,
Escape restores the old time. Escape dismisses the active menu before the composer.
Moving the start date or time moves the end with it, keeping the event's length
(all-day dates keep their day count), until the end is picked in the same edit;
after that the end stays put, and a start past it shows the end-before-start
error.

The path selects the Month, Week, or Day period, and choosing another period updates
that path. Calendar navigation defaults to Day on phones and Week on desktop; the most
recent choice is remembered locally for navigation that does not specify a period. An
opened event is reflected in the pane-owned `sN.calendar.eventId` search parameter.

Opening a calendar row in Home clears its loaded reminder dots immediately;
failed read writes restore them. Opening event details directly from the grid
also marks the event's notifications read. Verify both on desktop and mobile,
including a delayed read response and a failed write followed by another click.

Period selection updates its label and route immediately. The active grid redraws
on a deferred task; hidden neighboring periods follow on separate tasks. Calendar
grids stay mounted and undimmed while occurrences load. An uncached range never
shows events from the previous range. After a short delay, representative event
skeletons appear without adding synthetic FullCalendar events. Week/Day use sparse
blocks with varied start times and durations, plus separate all-day bars. Month mixes
filled bars for all-day/multi-day-style entries with single subtle text lines for
single-day timed-style entries, without placeholder dots or time chips. Patterns stay
stable for each date and clear the date headers. Skeletons preserve the grid, scroll
position, and navigation.
Quick loads skip the skeletons. Real events lay out underneath during the brief
minimum display, then fade in as the skeletons fade out. Changing period during a
load carries feedback into the new cells without restarting the appearance delay.
Background refreshes retain current events without skeletons or a transient loading
pill. On a cold reload, the first event paint waits for calendar metadata so events
appear in their configured colors. A REST/GraphQL handoff for the same user and
date range keeps the visible events and calendar list while the new reader loads;
changing the user or date range must not retain the old events. Verify both handoff
directions with delayed responses and delay calendar metadata past occurrences.
If metadata fails, events remain usable with the default calendar presentation.
Provider backfill shows a persistent `Syncing your calendar…` banner above the
grid, explaining that events will appear automatically and Macro remains usable.
The banner stays visible as partial results arrive and disappears when sync finishes.
Errors retain the separate retry state. Verify delayed occurrence
responses: switch Month/Week/Day rapidly and navigate without blanking the grid.
Confirm mixed event shapes, stable positions, clean handoff, and an uncovered Retry.
Reduced-motion mode disables pulses and transitions. The page stays busy until the
handoff starts. Hidden pages do not animate. Resize to confirm skeleton alignment.

Imported Google all-day events whose start and end dates match display as one day.
This also applies to recurring instances and moved exceptions. Sync keeps the
original provider dates without editing the Google event; reversed dates remain
invalid. Verify that a calendar containing both such an all-day event and an
ordinary timed event completes sync and shows both.
The [calendar component fixture](media/calendar-import/one-day.png) shows a
normalized one-day occurrence beside a timed event on the same date.

Imported timed events with identical start and end are points: they show a compact
chip with one time and `No duration` in details, and do not block availability.
Future points also appear in Upcoming events, without becoming ongoing meetings.
Grid dragging and resizing are disabled for points. An owned point's metadata,
RSVP, and deletion still work; metadata saves preserve its exact provider time.
Creating an event or changing its time requires positive duration. Shared points
remain read-only and appear only when their details are shared.
An existing Macro call can keep its schedule during point metadata edits; adding
a new Macro call requires giving the event a duration first.

Calendar reads come from the local GraphQL cache when both `enable-graphql-soup`
and `enable-graphql-calendar` are on (PostHog in production, on by default in dev
for the calendar flag; set `VITE_ENABLE_GRAPHQL_CALENDAR=false` to test the REST
path). A range the cache has covered renders with no occurrence request, and a far
jump fetches only the uncovered weeks. Cached records survive deploys, so an
occurrence cached by an older build can lack a field the current one selects;
a covered range with such occurrences refetches once instead of rendering
without them (span `calendar.refetch_unreadable_occurrences`). A
`refresh_calendar` poke, reconnecting, coming online, or returning to the tab
runs one `CalendarChanges` delta that
applies edits made elsewhere. RSVPs, edits, deletions, and creates show at once
through the durable mutation queue: a rejected write rolls back with the usual
error, and a write made offline stays visible and replays on reconnect. Native
apps whose engine lacks the calendar cache commands keep the REST path. Until the
cache answers its first calendar read, viewports wait at most a second and then
read from REST, and writes use REST, so a cache that is slow to start or fails
("Local cache unavailable") never leaves the calendar on skeletons. Writes in
that window behave as on the REST path: offline, they roll back with an error
instead of replaying.

A single period arrow retains its slide. Rapid arrow clicks and period hotkeys
accumulate against the requested date and interrupt unfinished slides, without
waiting for event responses or hidden-page redraws. Verify repeated forward clicks
and mixed directions reach the cumulative date while events are still loading.
Touch swipes retain their page-readiness gates.

Quick-call creation, incoming invitations, Live lists, Macro meeting links, and
the `/app/meet/*` routes require the PostHog flag `enable-quick-calls`. While the
flag loads or is off, those controls stay hidden and meeting routes do not mount
call setup. Existing channel calls and the upcoming-events list remain available.
For local verification, set `VITE_ENABLE_QUICK_CALLS=true` or `false` explicitly.

During a quick or scheduled call, signed-in participants can open **Call chat**
from its separate button at the far right of the bottom toolbar. Messages persist
with that call session and are visible in its recording page after it ends.
Guests can open the same call discussion and read and send text while connected;
their messages show their name with **(Guest)**. The signed-in composer’s `@` menu includes Macro and available agents;
mentioning one invokes it in the call thread. Reply on any live message, including
your own, quotes it in the bottom composer. Verify the reply preserves a draft,
an agent reply appears, and messages remain in the saved history; starting a
new session from the same meeting link must start a separate chat thread.


Calendar event creation and editing open in a bottom sheet on touch devices,
with scrollable content above the keyboard. `Create event` or `Save` sits at
the top right of the sheet's pinned chrome, below the handle, so it stays in
reach while the form scrolls. The title and description come first, then
`Event` and `Out of office` as selectable labels. A section of rows holds
All-day (switch on the right), Starts and Ends (date and time), and Repeat; a
second has one row each for Calendar, Guests, Call, Location, and Reminders
(Declines and Message for out-of-office events). Location is a text field in
its row, so the sheet scrolls it above the keyboard. Guest permissions follow, one
per row. Guests opens its own sheet over the composer, as tall as the event
sheet, with Cancel, the `Guests` title, and Done; its list fills the sheet.
Picks apply only on Done, and Cancel, the backdrop, or Escape drop them; the
guest sheet has no handle and does not drag, since a drag there also reached
the event sheet beneath. Picking a guest keeps the keyboard up. The title
sits directly below the pinned chrome. The sheet has no Cancel: drag, the
backdrop, or Escape dismiss it.
`This event`/`All events` sits at the bottom when editing a recurring event.
Desktop retains the centered dialog with inline dates, wrapping pills, and its
Cancel footer; both layouts compose `EventFormParts` (`MobileEventForm` and
`EventForm`), and the range rows compose `DateTimeRange` parts.
Dismissing a changed event by swipe, backdrop tap or Escape still asks before
discarding the draft; Keep editing returns to the sheet with the edits intact,
and the prompt stays away until the next attempt to close. An event created
from Home's **+ New** → Event opens the calendar on it once it saves, with its
details showing; events created inside the calendar stay where they were made.

On phones, event details use inset round action buttons and a transparent RSVP
footer. Answering a recurring invitation opens a rounded glass sheet: choose
`This event` or `All events`, then `Save response`. Cancel or Close returns to
the event details without sending a response.

While an event response saves, a small spinner appears beside `Going?` within
the RSVP footer on desktop and mobile; the row and buttons stay in place.
Failures appear below the buttons inside the padded footer and allow retrying.

Calendar scheduling is on by default in dev. Production uses the PostHog flag
`enable-calendar-scheduling` and stays off unless enabled remotely. Set
`VITE_ENABLE_CALENDAR_SCHEDULING=false` to test the disabled state locally.
While off, the Scheduling workspace and calendar booking shortcuts are hidden;
public booking and receipt links show an unavailable page without fetching
scheduling data. When enabling a production rollout, include anonymous visitors
so invitees can open those links. A public booking link stays available when
the flag request gets no answer, for example when a browser blocks it.

Calendar connections live in **Settings → Calendar** (`/app/settings/calendar`).
Connected calendars offers Connect account (pick Gmail or Outlook / Microsoft 365,
then consent), Connect calendar for accounts missing calendar permission (consent
again for that account at its own provider with its address preselected, as
Settings → Email's Enable calendar does), and Disconnect with confirmation. When
the only linked account lacks calendar permission, the Calendar accounts row
shows just a filled Connect button for it, with no account list or
visibility note. Disconnect removes calendar access/data, not the Gmail connection.
Settings → Calendar lists only the viewer's own inboxes. The **Enable calendar**
toast (behind `enable-calendar-prompt-web` and `enable-calendar-prompt-mobile`)
follows the same rule: it asks once per own inbox missing calendar permission,
never for an inbox another Macro user delegated to the viewer (a **Shared** row
in Settings → Email, whose per-inbox Enable calendar button stays available).
The calendar view's setup prompt decides and acts on own inboxes alone too: a
delegate with no inbox of their own sees **Connect your calendar**, the Calendar
is off vs Enable calendar wording counts only own inboxes, and Grant access, Turn
on and Reconnect only start consent for one of them. It covers the grid only in a
week without events and with no working calendar the viewer can see; a working
calendar shared with them keeps it to the bottom-right pill, so a delegate whose
only working calendar is shared sees the pill in every week.
Account checkboxes show/hide all child calendars; partial selection is shown as
mixed. Individual calendars can also be shown/hidden. The account color is the
default for its calendars; a child color overrides it. Click a color dot to open
the theme-matched picker: drag the color field and hue slider, choose a named
swatch, or enter a three- or six-digit hex value. Arrow keys adjust the focused
color field (Shift makes larger steps). **Reset to default** clears the override.
Visibility and colors share the calendar sidebar's browser-local preferences,
survive reload, and do not change the Google calendar or booking conflict checks.

The **Sidebar** section's **Next meeting countdown** switch (on by default, saved in
the same browser-local preferences) controls the app rail's Calendar badge:
`Now` during a meeting, or minutes until one under an hour away. Turning it off
hides the badge and stops its upcoming-events fetch. The row previews the
Calendar button beside the switch, with a sample `23m` pill only while it is on.

The calendar header has a `Booking links` dropdown. Select an active link to
copy it. The `Manage booking links` footer opens the Scheduling workspace, even
while links load or when none are active. At narrow desktop pane widths, the
dropdown moves from the header into the calendar sidebar above `Upcoming events`
and its menu matches the trigger's width. Phones retain the header dropdown
because they do not expose that sidebar. The calendar automatically sets up a
default personal link for a new profile. Public
`/app/book/:profile/:slug?` pages accept bookings without Macro sign-in. Guests
choose an event on the profile landing page, then choose their timezone, date,
and time before entering attendee details. Date & time and Your details steps
show progress; the event summary and selected time stay visible. Choose another
time preserves attendee input. Event booking pages do not show an All meetings
link back to the profile chooser.
The private confirmation shows the meeting, date, timezone, location, and guest.
In the native iOS and Android apps, standalone booking and receipt pages keep a
sticky **Back to Macro** button below the device's top safe-area inset. It returns to
the app through the router without reloading, including while the page is loading
or unavailable. Browser pages and embedded booking dialogs omit this button.

The website can frame the booking page and receipt without duplicate Macro
branding. A completed booking notifies the same-origin parent page; other sites
cannot frame these routes.
Uncertain calendar writes retain the booking and show its private receipt while automatic recovery runs.
After a network response cannot be verified, `Check booking status` retries the original request;
do not create a replacement booking. Receipt pages poll while the calendar update is pending. The private
`/app/booking/:id#token` receipt supports cancellation and rescheduling; preserve
that private link. Rescheduling defaults to the browser's time zone; `Your time
zone` controls both the selected calendar date and the displayed times. Changing
the zone clears the date and times and discards outstanding availability results.
Calendar provider failures show an error; they never report a
confirmed booking. Current integrations check hosts' connected calendars and
write invitations/Google Meet through the existing calendar service.

The standalone Calendar view has a left navigation sidebar. The `New` menu
above the mini calendar offers `Event`, feature-gated `Call`, and feature-gated
`Reminder`. An icon-only shortcut in the `Upcoming events` header opens the
availability dialog. Start/end time selectors and a weekend switch sit above
copy ranges that wrap on narrow screens. The dialog checks all ranges using one
calendar-occurrence query; ranges without free time are disabled, show an X
instead of the copy icon, and retain a reason tooltip that can receive keyboard
focus.
Copying rechecks the occurrences and current time, so changes since opening do
not enter the copied text. The option keeps its width while a left spinner and
`Copying…` crossfade to `Copied` with a green check icon; the button keeps its
neutral styling. Reduced-motion preferences skip the crossfade and spin.
Collapsible `Upcoming events` and `Calendars` sections follow; calendar
account rows use Drive-style trailing disclosure buttons and animated nested
branches. Their 14px visibility checkboxes precede the swatch and label, with
separate account and individual-calendar visibility controls. `Team out of office`
is feature-gated and lists teammates with 24px avatars; its header has the same
14px checkbox before the title, which shows or hides the grid overlay and is saved
with the calendar visibility preferences. The teammate rows have no checkboxes and
stay listed while the overlay is hidden. Clicking a teammate's row navigates to that
date, opens read-only event details, and marks the row active. With the overlay shown,
the details wait for the event's chip and open on it, scrolled into view, the way a
search result or notification opens; if the chip has not rendered after two seconds
they open beside the row instead. With the overlay hidden they open beside the row.
A card opened beside a row stays there when the event's chip mounts later. The left-aligned
`Settings` control with a gear icon fills the sidebar footer; booking management
lives in the `Booking links` dropdown rather than a separate footer shortcut.
An account checkbox toggles its calendars together in one update. The checkbox
responds immediately; the upcoming list and each grid page refresh on deferred
tasks rather than re-rendering all pages during the click.
The sidebar can be resized or collapsed on desktop; in narrow desktop panes
it opens over the grid. Phones do not show the sidebar or its navigation drawer.
The mobile split header places a month selector and Today in its left island;
selecting the month opens the date-selection drawer. The right island keeps
full-sized Availability, Search, and Settings actions. The New menu
beside the bottom AI input offers Event, feature-gated Call, and feature-gated
Reminder. Inline Calendar previews retain their host's chrome without adding
another sidebar; their left header island has a compact New menu because the
bottom New action follows the foreground host view.

With `enable-calendar-team-sharing` enabled, **Settings → Calendar** also has
**Team sharing**: one `Share with teammates` row whose select offers
`Busy blocks` (the default), `Event details`, and `Nothing`, with a one-line
description of the current choice under the label. A new choice shows at once
and saves in the background; a failed save restores the previous choice and
shows a toast. Neither settings section returns to a loading state after a
change, including when the server's `team_sharing_changed` push arrives.
These are Macro read permissions. They do not change Google Calendar ACLs,
invite teammates to meetings, or let teammates edit, RSVP, or manage reminders.
The sharing choice covers every currently authorized calendar synced to Macro.
Private/confidential events only expose generic time blocks.

**Calendars that count as busy** reuses the sidebar's `Calendars` list: each
connected account is a folded row with a checkbox, color swatch, and disclosure
button that expands to its calendars. An account checkbox includes or excludes
all of its calendars at once. These choices decide which calendars represent the
user's personal schedule. Primary calendars count by default; other calendars
require explicit inclusion. Meetings the user attends also contribute, except
declined meetings. Following a coworker's calendar does not automatically make
that coworker's events occupy the user's time. The section is hidden when the
user has no calendars to list.

Teammates' shared events do not render on the grid; `Team out of office` is the
only teammate overlay. Replacing a login session clears team data and open
teammate details before the new identity loads. Legacy out-of-office rows are
read-only status displays and do not claim that every absence blocks availability.

The `GetTeamAvailability` AI tool checks the requester together with the selected
teammates. It reports confirmed free windows only when every participant has
complete availability coverage. Hidden, disconnected, stale, or incomplete
calendars are reported as unknown, never free. Busy blocks contain no event
titles or private event metadata.

The in-view desktop Calendar header uses one responsive top bar. The viewed
month and year stay on the left in a heading that scales from 16px in narrow
splits to a maximum of 24px, with a compact `New` menu at the right end of the controls.
An outlined `Search events` icon button sits before the other controls. All
desktop controls are 32px tall and use the shared button surface: Today and the
previous/next arrows share a navigation group, the period selector has its own
view group, and Booking links and New have separate outlined buttons. Adjacent
controls and groups have a uniform 8px gap, with matching text-button padding.
Click Search or press Cmd/Ctrl+F to expand and focus the wider inline search field.
The field slides out with a short width transition and focuses immediately.
The results popup stays hidden until the field contains non-whitespace text,
then fades and slides in once expansion is nearly complete. Clearing the field
hides the popup without collapsing search. Reduced-motion preferences skip
both transitions.
Close search, Escape, selecting a result, or clicking outside collapses it back
to the icon without clearing the query. Activating a period control also
collapses search after the action runs. Escape and Close restore focus to the
Search button. The expanded field exposes Filters and, after typing, the
icon-only Exact-match toggle. The filter button stays before Close. The filter
menu opens below the button, aligned to its right edge: Search in is
single-select, while Status, Organizer, and Attendee allow multiple values.
Organizer and Attendee virtualize their contact lists; selected contacts stay
in place, while custom email addresses appear first. Adding a valid email clears
the contact search. Filter selections apply immediately, and only these filters
mark the filter button, not Exact mode. Search opens a calendar-search hint
until at least three characters are entered; searches show skeleton rows while
loading. Empty results show an illustrated empty state. Result titles show a calendar-color
swatch when the event is loaded in the visible range, falling back to the
default calendar color otherwise. A result shows its location after the
date/time when available. Each result offers at most one rounded Join action:
matching occurrence content takes precedence over series metadata. Macro links
use a neutral button, Google Meet uses a solid blue button in light mode and a
subtle blue button in dark mode, and other conference links use a neutral button.
All Join buttons use a camera icon. Generated Macro invitation paragraphs are
hidden from event descriptions. Google Meet URLs in an event's location or
description also supply Join actions. Recurring results wait for matching
occurrence details before showing Join. Selecting a result preserves the search
text. Availability lives in the desktop sidebar's Upcoming events section and
in the mobile header.

The period controls move into a separate row below 600px of calendar-pane width.
The shared outlined `New` menu remains at the right end, even with the sidebar
open; the sidebar places its full-width version below the title. With a docked
sidebar, the header stays inline down to 580px. This avoids wrapping
and immediately unwrapping when the sidebar hides. Expanded search does not
force early wrapping; its results popup stays directly below the search field.
Below 1040px, search slides over the month title without moving any controls or
changing the header height. `New` stays outside the search overlay. Resizing the
pane keeps the search field mounted and preserves its query and focus. Today
retains its text label until the controls row runs out of room, then becomes an
icon button. Desktop `New` keeps its label.
Touch devices keep the month selector and header controls without separate
create or call buttons in the right island. Mobile header islands omit Search.
The desktop sidebar's Search icon sits left of collapse and reveals event search
above New. Its mini calendar browses months independently of the main grid:
month arrows, the month picker, and keyboard focus changes do not move the main
calendar. Selecting a day navigates the main calendar without closing the narrow
layout's navigation overlay. Main calendar navigation updates the mini calendar's
selected day and week highlight without resetting the month being browsed.
When browsing from a month's last day to a shorter month, keyboard focus stays
on the shorter month's last day so Tab and arrow-key navigation remain usable.

Active Quick Calls you created, participated in, or were invited to appear above your
next five events (including ones in progress), whether or not they have call links.
The active area is hidden when no calls are active. Upcoming event rows show a
calendar color swatch, the name, and the time; click one to open its details and
highlight the active row.
An event with a call link shows `Join` while it is in progress. Upcoming events
follow today's date even when you browse another week; hidden calendars,
cancelled events, and invitations you declined are omitted.
`New Call` opens `/app/meet/new` without creating a meeting. The `Invite Teammates`
button above `Start call` opens the task assignee picker with name search, profile
pictures and multiple selections, without bots or external contacts. The closed
button shows up to three stacked selected profile pictures and the total teammate
count; hover shows selected names, and reopening keeps the same selections. Selection
stays local until `Start call` creates the Quick Call, connects the creator, and
rings selected teammates. Microphone and camera are not shared before starting.
If invitations fail after connecting, `Retry invites` sends them again without
creating another call. Shared-link join screens do not show the teammate picker.
Incoming invitations appear in a bottom-left notification with the call name,
caller initials/name, and `Decline` and `Join` buttons. This stays visible across
app pages, including call setup, hidden sidebars, narrow splits, and mobile (above
the bottom dock). The card uses the app's menu surface, with semantic success
color for `Join` and danger color for `Decline`. A top bar and seconds counter
show the time remaining before the 30-second dismissal deadline.
`Join` opens call setup; `Decline` stops ringing across the
recipient's tabs. Unanswered invitations disappear and stop ringing after 30 seconds.
Declining or timing out does not remove an invited live call from Channels `Live`.
The list updates as calls end and new calls start. Calls from other conferencing
providers open their own join links. A failed upcoming-list request has a `Retry`
action and does not prevent creating a call.
Working locations (such as `Office` or `Home`) stay on the calendar grid but are
excluded from Upcoming events, including both all-day and hourly locations.
Events require connecting a Google account (`Connect calendar`). The
`Calendar settings` (gear) menu has an `Accounts`
section listing each connected account with a per-account `Enable` (grant calendar),
`Reconnect` (expired Google authorization), or `Turn off` action, plus
`Connect another account` to connect a new Google account
(email + calendar; the item and the `Connect email` dialog both say the email
and calendar connect together). A Google consent that leaves the email
permissions unchecked connects nothing: the callback returns to the calendar
with a persistent `Email access required` prompt whose `Try again` reopens
`Connect email` asking for the same permissions. The auth service also tries
to revoke the partial grant at Google, unless an inbox for that address still
works on it; when the revocation succeeds, Google lists every permission again
on the retry instead of folding the earlier calendar grant into an "already
has some access" notice.

`Turn off` keeps its confirmation open with `Turning off…` until removal finishes;
re-enabling is not offered while the old calendar is still being deleted. Reconnecting
an inbox that used calendar requests email and calendar together, while an explicit
calendar opt-out remains off during an email-only reconnect. Per-inbox actions
preselect that Google account. The consent callback explains that it is finishing
the connection, provides `Back to app`, and restores the previous layout on completion.
It applies the grant even if the old inbox list is still loading.

An AI event draft defaults to the primary inbox's primary calendar. If that calendar
is disconnected or still syncing, the draft offers reconnection or an explicit
calendar choice and disables submission until a usable calendar is selected. It
does not silently send the invitation from another connected inbox.
Failed calendar or account queries show `Could not load your calendars.` with
`Try again`, rather than offering consent or presenting the failure as backfill.

`New event` opens the compact composer with All day in the date/time fields.
The meeting-link selector lists `Macro call`, `Google Meet`, then `No meeting link`
for new events, defaulting to `Macro call` when quick calls are enabled. Keeping
that selection creates the Macro call together with the event in one save, so the
invitation attendees receive already carries the link; if the call cannot be
created, nothing is saved and Save retries the whole create. Selecting
`Google Meet` or `No meeting link` skips the Macro call. Out-of-office entries do
not create calls. There is no separate call toggle or Scheduled Call menu option.
All-day events get an untimed call link, so setup does not display a misleading midnight time.
Adding a call to an existing event attaches it after the update; a failed
attachment keeps the composer open with a retry message, and Save reuses the same
call instead of creating duplicates. The invitation includes
the call link in its description and, when no location was entered, its location.
Event details show a plain icon row with a standard gray `Join Macro call` button
and `Copy call link`, without an enclosing border or the full URL.
Editing or rescheduling an owned event retains and updates its selected Macro call.
Selecting `Macro call` on an owned editable event without one adds a call on save;
choosing another option removes its generated Macro link from the invitation.
Removing the link or deleting the calendar event does not revoke the reusable call.
The AI's `CreateCalendarEvent` composer (chat, agent sessions, channel review cards)
offers the same selector under the same quick-calls flag; `Macro call` there maps to
the tool's `addMacroCall`, and the call is created when the tool executes, before the
event is written, so the single invitation already carries the link. The MCP server
and channel bot accept `addMacroCall` directly. `addMacroCall` and `addGoogleMeet`
are mutually exclusive, and out-of-office entries accept neither.

The sidebar's `Calendars` section folds each connected account into a collapsible
group: a caret plus the account address header with a checkbox that shows or hides all of
that account's calendars at once, and the account's calendars listed beneath it (color dot,
name, per-calendar checkbox). Accounts start collapsed. Subscribed system calendars
(Google holidays, birthdays) carry a small RSS icon. A calendar whose sync has been failing persistently carries a small
warning icon whose tooltip shows the provider error; the account keeps syncing its other
calendars and the badge clears on its own once that calendar syncs again.

On desktop, clicking or dragging empty grid time opens the event composer.
While an event's details are open, a press on empty grid time closes them and
does not start a new event; the next press creates one. Clicking another event
switches the open details.
Desktop event details stay inside the visible calendar grid, including Home
previews and narrow splits. They overlap wide Day-view events when needed and
shrink to fit the pane; long details scroll while the RSVP row stays visible.
As in Google Calendar, the popover opens beside the event, aligned with its top,
and switches only between the right and left side; when it doesn't fit below,
it slides up to stay in the window instead of opening above the event. Sections
that load after it opens (join requests, meeting notes) therefore never move it
from below the event to above it. Check placement with an event low in a tall
window, a short window, and a pending join request; the backend-free regression
is `apps/web/src/features/calendar-view/browser-test/playwright.config.ts`.
The `Add guests` and `Forward invitation` editors in the attendees header open
below their button, right-aligned with it, and move above it when they don't
fit below, including when the picker's suggestions arrive after the editor
opens; when neither side has room they slide over the button to stay in the
window. The picker, the people chosen and the send button stay visible at every
event position and window height. The same regression covers both editors in a
tall and a short window (`?guests=add` or `?guests=forward`, with
`?contacts=late` delivering the picker's contacts on
`window.calendarPreview.deliverContacts()`) and their phone sheets.

The `New event` composer (also opened by dragging a range on the grid) has an `Event kind`
pill choosing between `Event` and `Out of office`. Picking `Out of office` hides the guests,
conferencing, and location pills and the description field (Google rejects them on this
type), forces a timed (not all-day) range, restricts the calendar
pill to primary calendars, and shows a `Decline meetings` pill (`Don't decline meetings` /
`Decline new meetings` / `Decline all meetings`) plus, when declining, an optional
`Decline message` pill; a warning note discloses the away/auto-decline effect before saving.
When editing an existing event the kind is read-only (Google treats it as immutable), and an
out-of-office event's decline settings can still be changed — they read as unset because the
provider does not report the stored ones. Timed and all-day events use solid calendar-color
blocks with dark text on desktop and mobile. Unanswered and tentative invitations have
lighter fills; declined events are desaturated and struck through. Month-view timed events
keep their compact dot treatment. Out-of-office details show an `Out of office` line under
the schedule. The details' calendar row names the calendar the event is on. A primary
calendar reads as its inbox address, as in the calendar pickers, because Outlook names an
account's default calendar `Calendar`. Other calendars show their name.
An event that Google carries on several of an account's calendars (a shared calendar's
re-import of a member's own event, for example) renders as one chip, not one per calendar:
the details popover's color square shows its calendars. The chip shows the title, color, and
editability of the first shown copy in primary-first order — hiding the primary calendar
switches the chip to the shared copy, hiding every one of its calendars hides the chip.
Reminders, guests, and conferencing always show and follow the primary copy, since that is
the copy Macro's alerts fire from and whose guest list and join link Macro records, and the
editor only lets them be changed there. Answering an invitation likewise addresses the
primary copy. The details popover and the editor act on the displayed copy, so editing or
deleting it targets that calendar's event at Google.
When changing only a reminder in the event editor, choose `All events` to apply it
to the recurring series or `This event` for one occurrence. Saving preserves the
existing dates, time zone, title, location, description, and repeat rule unless those controls
changed. To verify, open a later occurrence of an event you were invited to,
change the reminder, and inspect the PATCH: it should include only `reminders`
plus the calendar and scope identifiers. Also verify that intentional edits to
the start, end, all-day setting, title, location, description, or repeat rule are still sent
by the organizer or a guest the organizer lets modify the event.
Test reminder removal as well as changing its time, including a series whose stored
rule contains `INTERVAL=1`, `WKST`, differently ordered weekdays, or a precise `UNTIL`:
an untouched rule must not be reformatted and included in a reminder-only PATCH.
A weekly rule without `BYDAY` repeats on the start's weekday: plain `FREQ=WEEKLY` opens on the
`Weekly on <day>` preset, and one with an end (such as `COUNT=3`) opens `Custom` with that day
selected, since the presets never end. Either is saved as written while untouched; moving the
start to another weekday keeps a custom rule on the day the editor shows. Event details (desktop
popover and phone drawer) and Forward by email's summary name the day too (`Weekly on Saturday ·
3 occurrences`), read from the occurrence's original slot in the event's own time zone.
As in Google Calendar, the guests row of the details popover (a bottom sheet on phones)
carries `Copy guest emails` and `Email guests` icon buttons, both hidden when you are the
only guest (always so on a snapshot). Copying puts every guest's address on the clipboard,
comma-separated; it is hidden too while the organizer hides the guest list, which your copy
does not hold. Emailing opens a new email addressed to every guest but you, with the event
title as its subject (as `Forward by email` fills it in) — in a split
beside the calendar on desktop, as the full-screen composer on touch devices, in its own
composer even when another one is open. Deleting an event asks first, and says guests will be
notified only when someone besides you is on it.
With the `enable-calendar-guest-invites` flag on, a third icon button, `Add guests`, shows
whenever the event's `viewerCan.inviteGuests` allows it, including for a guest whose
organizer lets guests invite. It opens an editor anchored to the button (on phones, a bottom
sheet stacked over the dimmed event details, showing one bright handle; a tap on the dimmed details closes only this sheet and presses nothing under it): the current guests are listed under `Invited` without a remove control, the picker
adds people, each new guest has an `Optional` checkbox, a recurring event offers `This
event` / `All events` (`All events` by default, like the editor's recurring edits), and
`Send invitations` (or Cmd/Ctrl+Enter) sends them; Escape closes. The new guests appear at
once as unanswered and a toast confirms the invitation once the provider accepts it. A
guest who may not invite gets no button; instead the guest list opens with `Only the
organizer can invite guests.`, and the same happens after the
provider refuses an invitation. In the event editor, the organizer edits guests as before,
while a guest who may invite gets an add-only guests pill whose additions are sent as an
invitation on save (other edits are saved first); a guest who may not invite keeps a
read-only pill that explains why. A guest on an event whose organizer hides the guest list
may not invite either (`viewerCan.inviteGuests` is false; the route answers 403
`guest_list_hidden`), since that guest's copy lists only themselves and perhaps the organizer:
the guests row reads `Guest list hidden` instead of a count (so does the editor's read-only
guests pill), and when the organizer does let guests invite, the explanation reads `Guests
cannot be added while the organizer hides the guest list.` instead. To check the refusal
states without a Google account, answer `POST /events/{id}/guests` with HTTP 403 and code
`guests_cannot_invite` or `guest_list_hidden`; each switches the guest list to its own
explanation and toast.
In each of those cases (inviting off, a hidden guest list, an Outlook guest copy, and after
a refusal), the `enable-calendar-invitation-forward` flag (on in dev, with no PostHog flag
yet, so off in production) puts `Forward invitation` (a paper-plane icon) where `Add guests`
would be, whether or not guest invites are on, and the explanation goes on: `You can forward the invitation instead. The people
you send it to get the event by email but won't be on the guest list.` It opens
the same add-only editor (current guests under `Invited`, the picker adds people listed as
`Forward to`), says `They'll get the event by email but won't appear in the guest list.`,
and `Forward` (or Cmd/Ctrl+Enter) sends; there is no Optional box or occurrence
choice, since the forward always carries the whole series. It posts
`POST /email/calendar-events/{event_id}/forward` with the recipients and `Forward by
email`'s summary as the body; email-service sends it from the inbox holding the copy, and
the server decides what it is from the stored copy, ending the body with the matching note:
- Google's private copy (`privateCopy` in the stored Google payload) of an invitation whose
  organizer is outside Google, such as Exchange (Google stores every such invitation that
  way and reports it as `guestsCanInviteOthers: false`): a real invitation, as Google's own
  Add guests sends there. The message's calendar body is `METHOD:REQUEST` with the original
  organizer and the recipients (only them) as attendees, an `invite.ics` copy is attached,
  and the email goes to the recipients and the organizer, as Google addresses its own.
  Recipients get Yes / Maybe / No in Gmail and Outlook and their answers go to the
  organizer; the forwarder's own copy and answer are untouched. The note reads `This
  invitation was forwarded to you. Your answer goes to the organizer.`
- Anything else, notably a Google organizer who turned inviting off, and whenever the
  evidence is missing (an Outlook copy, a snapshot, a private copy whose UID ends in
  `@google.com`, which is an imported Google meeting, an organizer Macro cannot name, or a
  source synced before Macro kept Google's whole payload): the event's `.ics`
  (`METHOD:PUBLISH`, no guests) attached, so recipients can add the event to their calendar
  and nothing reaches the organizer or the guest list. The note reads `This invitation was
  forwarded to you. Add the event to your calendar from the attached file. You won't be on
  the organizer's guest list.`

Both carry the join link, unlike `Download .ics` and channel shares: a Macro call's
`Join Macro call` line and location stay, and the copy's Meet, Teams or Zoom link is added as
a `Join with Google Meet: <url>` (or `Join the Microsoft Teams meeting`, `Join the meeting`)
line unless the description already shows it, plus `CONFERENCE` (and, for Meet,
`X-GOOGLE-CONFERENCE`). The toast reads `Invitation forwarded to <name>` (or `to N
people`) once the send is accepted; a failure reads `Could not forward the invitation`, with
`Retry` unless the server refused the recipients (400 `invalid_recipients`, whose reason
shows instead). The editor offers the same `Forward invitation` beside its read-only guests
pill, whose tooltip carries the longer explanation. Event details stay open while the
forward editor is, as they do for `Add guests`. Snapshots, cancelled events, read-only
copies and team projections offer nothing. To check the toasts without sending mail, answer
the route with 202 `{messageId, threadId}`, or with 502 `send_failed` or 400
`invalid_recipients`.
An event that reached several connected inboxes shows one chip per inbox (overlapping;
tell them apart by calendar color), and each copy answers only for its own inbox: a
guest copy stays a guest copy, marked `(you)` on that inbox's row alone, even when
another connected inbox organizes the event. An Outlook guest copy never offers `Add
guests` (Outlook lets only the organizer change a meeting) and shows the same
explanation; an Outlook organizer adds guests like a Google one. The organizer's row on an
Outlook event shows `Accepted`, as on Google, although Microsoft lists the organizer as not
having answered. Microsoft refuses an organizer's answer, so an Outlook organizer gets no
`Going?` footer (`viewerCan.rsvp` is false), while a Google organizer listed as a guest does.
A guest the organizer does not let modify the event (`viewerCan.editDetails` false while
`viewerCan.rsvp` is true) opens an editor whose date/time, all-day, title, description,
repeat, conferencing and location controls are disabled, each with the tooltip `Only the
organizer can change this event.`; the same line shows under the pills, which is all a
touch device shows. The event kind and calendar pills, which on any other edit open their one
value as a list, are disabled too. Disabled pills, the date and time pills included, are
dimmed and show no hover; the All day switch is dimmed too. Notifications stay editable and Save sends only `reminders` (plus any
invitation). An editor already open when the organizer turns modifying off follows the
guest's copy once it syncs: the same fields lock, return to the event's own (keeping
notification and guest changes) and a toast shows the line. That guest cannot drag or resize
the event on the grid either. Someone
neither organizing nor invited, such as a delegate on a shared calendar, keeps what their
calendar access allows. The update refuses a detail change from such a guest with 403
`guests_cannot_modify` (fields resent at their stored value are ignored, so the agent can
pass them); the editor then shows the line in a toast, locks its details and returns them to
the event's own (title, time, repeat, location and description, keeping notification and guest
changes), so it never holds a change it cannot save, and a refused drag snaps back with the same
toast. A locked description refuses typing, like the other locked fields. The refusal covers a stale `viewerCan`, an event the
viewer still sees as editable after the organizer turned modifying off, so check it without a
Google account on an event whose `viewerCan.editDetails` is still true, the only case where
the editor sends a detail change at all: answer `PATCH /events/{id}` with HTTP 403 and code
`guests_cannot_modify`, or the GraphQL `updateCalendarEvent` mutation with an error whose
`extensions.code` is `guests_cannot_modify`.
With the `enable-calendar-guest-invites` flag on, the organizer sets what guests may do in the
composer's `Guest permissions` row, under the pills on desktop and phones alike:
`Modify event`, `Invite others` and `See guest list`, in Google Calendar's order, with Google's
defaults (invite others and see the guest list) preselected on a new event and the stored
`guestPolicy` on an edit. As in Google, checking `Modify event` also checks `Invite others` and
locks it. The row shows on a new event and on an edit whose `viewerCan.setGuestPolicy` is true,
on Google calendars only (the calendar's `capabilities.guestPolicy`); Outlook calendars and
out-of-office events have none. While a recurring edit targets `This event`, the Repeats pill
opens its list read-only and says why, as a tooltip and under the pills (`The repeat rule
applies to all events. Choose All events to change it.`). Like the repeat rule, the row is
disabled while a recurring edit
targets `This event`, since the policy belongs to the whole series, and says so after the
switches (`Guest permissions apply to all events. Choose All events to change them.`);
choosing `This event` returns it to the stored values. Save sends `guestPolicy` only when it
changed. Guests whose copies Macro holds follow at once, since the organizer's stored copy
hands its policy to theirs; others follow once Google syncs their copies. Turning `Invite others`
off replaces a guest's `Add guests` with `Only the organizer can invite guests.` (and, with
the forward flag on, `Forward invitation`). The update
refuses a policy change from anyone but the organizer with 403 `not_organizer`, and on an
Outlook event with
`provider_rejected`. `viewerCan.organize` marks the organizer of the displayed copy, including
on Outlook, where `setGuestPolicy` is false.
Google names the calendar an event was made on as its organizer, so an event on a secondary
calendar shows `Organizer` with that calendar's name, and its organizer email is the calendar's
id (`…@group.calendar.google.com`). Whoever can write that calendar organizes the event, as in
Google: details, guests, guest permissions and Delete work as on their primary calendar, on
every copy. A new event on a calendar other than the primary lists its creator as a guest only
when it has other guests, as Google's own client does, so an event of one's own shows as one
block in Google. With guests, Google also invites the creator's primary calendar; Macro shows
both copies as one event, sends the organizer's changes and Delete through the copy on the
secondary calendar, and keeps reminders and answers on the invitation. Google takes 15 to 30
seconds to carry the organizer's changes to that invitation; Macro shows them at once and never
falls back to the old title, description or guests meanwhile. To verify, create an event on a
secondary calendar with no guests and another with a guest, open each (no `Only the organizer
can change this event.`), change the title, add a guest, and watch the chip and details for 40
seconds (the new values must stay), then delete it, and check Google: the first shows once, and
both disappear from every calendar after the delete.
The details header's `Download .ics` icon button, beside `Copy event`, saves the event as an
iCalendar file named after its title, so it can be passed on or added to another calendar. The
file holds the series (its repeat rule, in the event's original time zone), title, description
as plain text, location and organizer, never the guest list or join link. A Macro call's
`Join Macro call` line and a location that is only its link are left out too, as event details
leave them out. Like `Copy event`, it
is absent from teammates' out-of-office chips. Its endpoint, document storage's
`GET /calendar-events/{event_id}/ics`, also exports an event shared with a channel the viewer
belongs to.
Beside it, `Forward by email` (shown under the same rule) passes the event on the way Gmail
forwards an invitation: it closes the details, fetches the same file, and opens a new email
where `Email guests` does, with no recipients, the title as subject, a plain-text summary in
the body (title, when in the viewer's zone, the repeat rule in words, location, organizer and
description, never guests or a join link) and the `.ics` attached as a picked file would be.
Nothing is saved as a draft until you edit something. The file is `METHOD:PUBLISH`, so
recipients get a copy to add to their calendar, not an invitation they can answer; in Macro the
received email shows it as a shared event (see [Calendar invitations in
email](#calendar-invitations-in-email)). If the file
cannot be fetched, no composer opens and a `Failed to forward event` toast shows; to check it,
answer the `.ics` route with an error.
On desktop, every icon button in the details header (`Copy event`, `Download .ics`, `Forward
by email`, `Edit event`, `Delete event`, `Close event details`) and in the guests row shows its
name as a tooltip on hover, as does the close button of the recurring RSVP dialog. Touch
devices show no tooltips; the phone drawer's buttons keep the same accessible names.

With the `enable-calendar-team-ooo` flag on, teammates' Google Calendar out-of-office events
overlay the grid as read-only chips titled `<name>: <event title>`. The sidebar's
`Team out of office` section (shown only when the user belongs to a team with other members)
is a collapsible list of the next 90 days of teammate absences. The checkbox in its header
shows or hides the overlay (the list itself always shows); clicking a row navigates the grid
to that date. The list shows ten rows and a `+N more` button that expands it to every row,
scrolling inside a bounded height, with `Show less` to collapse it again. The choice survives
the poll and count changes; when ten or fewer rows remain, the button hides. Reopening the
narrow-pane overlay sidebar starts collapsed, as its section toggles do. Coverage depends on
each teammate having connected their own calendar and using Google's out-of-office event type.

The grid's pages and the list read the overlay from shared fixed 91-day windows,
each fetched once and refreshed by one 30-second poll while the tab is focused, so
an open calendar typically makes two out-of-office requests per poll. Routine sync
notifications that explicitly exclude OOO changes refresh this list
in the background without returning to its skeleton. OOO changes, sharing changes,
and notifications without that guarantee still clear cached rows and close open
OOO details immediately before refetching.

To mention an event, press `Copy event` in its details and paste, or type `@` and at least
three characters of its title in a composer that offers event mentions (message, comment and
document composers; spreadsheet and database cells and typed reference fields do not): where calendar search is on
(`enable-calendar-search-ui`), the menu lists matches under `Calendar events` (all of them in
one list on phones), one row per event with when it starts, and picking one inserts the same
chip a paste does, pinned to the found instance of a repeating event. Events someone shared
with a channel you belong to, and that are on none of your calendars, follow your own events
in that list without a marker, as documents shared that way sit beside your own; their chip
names the shared event, so it opens for whoever can already see it. Posting it elsewhere does
not share it on (only someone holding the event on their own calendar can), so people without
access see `No Access`, like any other mention they cannot open; clicking it (a tap on a phone,
which opens a sheet) shows `You don't have access to this event`.
A calendar event mentioned in a channel message opens the calendar focused on the viewer's
own copy of the meeting. When a person holds the event on their own calendar and posts the
mention, it is shared read-only with the channel's current members: a member without a copy of
their own sees the mention's title and time, and its hover card adds a `Shared with you · not on
your calendar` line with no open action. Clicking such a mention shows that hover card
instead of opening the calendar; on a touch device, tapping it opens the same card as a bottom
sheet. That card also offers `Add to calendar` (behind the `enable-calendar-add-shared-event`
flag, on in dev only until a real Google import has passed there), which imports a snapshot of
the meeting onto the viewer's only writable Google calendar, or onto one they pick from a menu
when they have several; Outlook calendars are not offered, since Microsoft cannot keep the
meeting's iCalendar UID. Google imports an event only for its organizer or an attendee, so the
snapshot keeps the real organizer and lists the viewer, already accepted, as its only guest: the
meeting's other guests and join link stay out and nobody is notified. If Google refuses anyway,
the card says Google won't add the event to that calendar and points to `Download .ics`. The agent
adds the same snapshot with `AddSharedCalendarEvent` while the server switch
`ENABLE_CALENDAR_ADD_SHARED_EVENT` is on (off unless set): it uses the one calendar the card would
offer, asks which one when there are several, and meets the same refusals. The
mention then opens the snapshot, whose details say `Your copy of a shared event. It doesn't
update when the organizer changes it.` and offer no RSVP, `Add guests` or `Only the organizer can
invite guests.` line, since none of it would reach the meeting. It offers no `Edit event` on
desktop or in the phone drawer, and the grid does not move or resize it: its details are the
organizer's, and a composer that could change only its notifications would read as editing the
meeting. Its delete button is `Delete your copy`, whose dialog says the shared event stays as it
is. If the organizer later invites the viewer (for example by accepting their request to join),
Google's invitation lands on the same calendar event. Once Google's copy shows it (another guest,
which every Google meeting with guests has in its organizer, or a request for the viewer's
answer) the copy becomes an ordinary guest seat: the note goes away, and RSVP and `Edit event`
follow the organizer's guest permissions. A meeting that lists only the viewer, answered in
Google before Macro synced the invitation, still reads as a snapshot. If Google already holds the meeting on that calendar (an invitation Macro has
not synced yet), nothing is imported, a sync is scheduled and the card reports that it is
already on their calendar. `Download .ics` saves the event as an iCalendar file and is not
flagged. `Ask to join` asks the person who shared the event to add the viewer as a guest; it
shows only when that person's copy lets them add guests (they organize it, or it is a Google
copy whose organizer lets guests invite others and shows the guest list), and otherwise the card
reads `The person who shared this event can't add guests to it.` The card then shows
`Requested`, and `Invited` once accepted, and stops offering `Add to calendar` until the request
is declined: the sharer's answer is an invitation to the meeting, and a snapshot added meanwhile
would take that invitation in and stay a snapshot. The server refuses the copy in the same cases
(`join_request_open`, from the API, the SDK and the agent alike); a card that had not caught up
says `You've asked to join this event` and refreshes to `Requested` or `Invited`. The sharer gets a `calendar_event_join_request`
notification (Settings → Notifications → Calendar → Requests to join), which Home lists as
`<requester> asked to join <event>` with a person-plus glyph, like a comment row. It opens the event,
whose details list each request with `Add as guest` and `Decline` on desktop and in the phone
drawer. Adding writes the guest through the same invite path as `Add guests`, so Google or
Outlook sends the invitation and the mention then opens the viewer's own copy. Declining sends
the requester nothing, but their card then reads `Declined` and `The person who shared this event
declined your request to join.` with no `Ask to join`, and offers `Add to calendar` again. A
declined request stands: the server refuses another ask with 409 `request_declined`, so the
sharer is asked only once. A classic `@Macro` reply that
mentions an event does not share
it by posting the chip. It asks whether to share with the channel, and a yes in that thread
writes the same channel grant. Private and confidential events are never shared this way.
Every calendar mention's hover card shows the schedule, location, organizer and attendee
count, plus the first lines of the event description (its links open), and no last-updated
byline. A mention of a meeting that was deleted or cancelled reads `Deleted`; clicking it (a tap
on a phone, which opens a sheet) shows `This event was deleted or cancelled.`, like a shared
event's card, instead of doing nothing. When the mention names someone else's copy of a meeting the viewer also holds (a shared
event they added or were invited to, or a meeting someone else mentioned), the card says how:
`Your copy is on your calendar` for a snapshot, `You're invited · on your calendar` when the
viewer's copy is a guest's, and `On your calendar` otherwise (the viewer organizes it, or it sits
in a delegated inbox), with an `Open` button that opens the viewer's copy. A mention of the
viewer's own copy shows neither. A shared-event sheet open on a phone stays up when the viewer
adds the event or is invited, and switches to that line and `Open` in place. Opening from the
sheet (`Open`, the title, or Open in New Split) closes it, since the native apps keep the
pane behind the opened one mounted. When Calendar opens on an event its loaded week doesn't
have yet, such as a copy added a moment ago while Calendar was closed, it syncs once and then
shows the event's details. The agent reads a mentioned event, including one only shared with
the viewer, with `ReadCalendarEvent`: the same fields, plus how the viewer holds it (their own,
invited, a snapshot, or only shared with them) and their join request.

## Scheduling — `/app/scheduling`

Booking management has a dedicated **More → Scheduling** workspace at
`/app/scheduling`. Its sidebar is titled **Scheduling** and separates
Booking links, Availability, Bookings, Insights, and Booking page without a
Calendar/Booking links switcher. The sidebar lists **Personal** first, then each team by
name as vertical, single-selection rows matching Email's inbox list. The active
row has a checkmark; the list scrolls when more teams are present. Selecting
a row switches the owner for the entire workspace; ownership badges appear only
in the top header, not on cards or tab content. Owner changes discard link/schedule drafts and stay disabled during saves.
Each tab's heading appears in the main topbar, with its description available
through an info tooltip rather than a separate large header. Desktop Booking links
uses one header row: title and owner, a grouped **Create with agent** icon,
outlined **New**, and expandable Search. Command-F expands and focuses the
search field; Close or Escape clears it and returns to the icon. New opens the
manual editor. On touch devices, the header has separate
sparkle and plus buttons for agent and manual creation. Create with agent opens an editable,
unsent request in an agent conversation and carries the selected Personal/team
owner privately. The agent reads current settings and asks for approval before
saving; opening the conversation does not create a link. If a booking-page draft
is still unsaved, resolve its Save/Discard prompt first. Keep editing cancels
the launch without creating an agent session. Successful create/edit
tool results refresh the matching profile when its cached revision is older.
Read-only owners do
not offer creation actions. Link rows use the full pane width with the same rounded
list-hover treatment as Drive and Email: acceptance switch, link icon, name,
description, then larger task-style URL-path, duration, and scheduling-type pills
with matching surfaces. Scheduling type reflects the saved link mode: Individual,
Collective, or Round robin, with a corresponding icon. Pills wrap on narrow panes
and align with the title on touch devices. Row content has no hover tooltips.
Paused links appear dimmed but remain editable. The URL pill offers Copy link and
Open in new tab. Desktop More and right-click menus share Copy link, Preview,
Edit, Duplicate, and Delete. Touch rows hide More; hold a row to open the shared
mobile action-drawer style, headed by the link title and a circular close button.
The action list scrolls independently while its heading remains visible.
Focus the title and press Shift+F10 or the Menu key for keyboard access to the same
actions. Escape restores title focus; choosing Edit or Duplicate closes the
action surface before opening the editor. Editing actions remain available to every team member.
Open the URL-pill dropdown with a pointer. Enter/Space opening currently loops in
nested scroll containers; avoid keyboard opening for that dropdown.
Clicking a link's name or description opens **Booking link details**, a summary-only
dialog that reuses the create/edit Review contents. Title and Description are
stacked labeled values, followed by a Link field with the copy action beside its
URL. Active links offer Copy; the footer contains only Edit for authorized owners.
On touch devices, details use a content-sized drawer capped at 80% of the viewport.
Only the summary scrolls; the heading, circular close control, and Edit footer
stay visible. Opening Edit first dismisses the details drawer.
Close details with the header close button, Escape, or outside dismissal.
Paused links still show their details. Legacy links requiring confirmation show
Paused without Copy because they cannot accept bookings. Read-only viewers can view details
without an Edit action or status toggle. Team members can choose **Edit
booking link** in the dialog footer or Edit in either row menu. Closing details
restores focus to the row; editing opens the unchanged five-step flow, including
Review. Viewing details does not save changes or fetch another copy of the profile.
Narrow panes wrap properties below the link text.
Booking date filters remain below the topbar. Tab content aligns with the left
content gutter instead of using automatic horizontal margins. The selected tab and
owner survive reload through route search state (`tab` and `owner` in the
`scheduling` namespace). Desktop tab and owner navigation stays in the sidebar.
On touch devices, Scheduling uses the same horizontally scrollable pill strip as
Drive. The leading island contains the Personal/team owner selector and the New
plus button when permitted, followed by the separate Booking links, Availability,
Bookings, Insights, and Booking page pills. Booking links also retains its
Create with agent action in the leading island. The owner drawer restores focus
to its trigger after selection, Escape, or outside dismissal. Long owner names
truncate while the control's accessible label retains the full name.
The main Scheduling view has no header Back button. During schedule editing,
a separate **Back to availability** pill sits beside the editor-title pill, while
owner and creation controls hide. Back or the editor footer's Cancel returns without saving.
The content and editor footer clear the floating
header and bottom dock. Calendar's booking actions open this workspace.
Date fields in Availability, Bookings filters, custom Insights ranges, and rescheduling
open a shared mini-calendar instead of the browser's native picker. Use the month
heading or arrows to navigate, then select a day; arrow keys move the focused day.
**Today** selects the current local date. Optional fields also offer **Clear**.
Date limits disable out-of-range days. Escape closes only the mini-calendar and
returns focus to the date field, preserving the surrounding draft.
**Booking page** is a full-width, height-filling public-page canvas, with no
centered workspace width cap or separate details panel. **Edit** and **Preview**
mode tabs float at the top-left of the canvas; the accent **Save** action floats
at the top-right in Edit mode only. **Revert** appears beside Save when the name or
introduction differs from the saved page, and restores both saved values. Both
controls are disabled while saving. The controls overlay the canvas without a
separate header bar, divider, or reserved header height.
Edit mode places outlined Display name and Introduction inputs where guests see
the heading and description.
The outlines sit four pixels outside the text boxes, adding visual padding without
changing text positions or moving the meeting cards. Introduction grows with its
text and uses the preview's typography. Preview mode removes the inputs, outlines,
and Save/Revert actions, showing the draft with the real public-page layout.
Switching modes keeps edits; return to Edit to save. Switching workspace tabs or
owners with edits opens **Save booking page changes?**: **Save** persists before
continuing, **Discard** restores saved values, and **Keep editing** cancels the
navigation. A failed save keeps the draft and displays the error for retry. The
split-router leave guard protects navigation away and closing the split. Browser
refresh/close uses the browser's native unsaved-changes warning. Browser Back and
Forward also show the same prompt when they change the Scheduling tab or owner.
The canvas scrolls
behind the floating controls. Its branding, published meeting cards, and empty
state reuse the public page's components. Meeting cards are
display-only, so editing cannot start a real booking. Above the canvas, **Copy
link** copies the saved page URL without displaying it or opening the guest page.
After copying, the icon briefly fades to a green check without shifting the
button, then returns. Failed copies keep the copy icon and report the error.
Feedback respects reduced motion. Sharing remains disabled until the page is saved.
There is no extra owner badge above the canvas,
but the workspace topbar still identifies Personal or the selected team.
Fields stay disabled while saving or for read-only viewers. Every team member
can edit a team's page. Drafts remain separate for each owner, saving
updates only the selected owner, and failed saves retain edits for retry. There
is no separate Booking settings shortcut or Settings → Booking links page.
Public booking URLs remain unchanged. Calendar connections and integration
shortcuts continue to open Settings → Calendar.
On desktop, Bookings puts its title, filter island, status tabs, and expandable Search in one top row. Booking-page Edit/Preview tabs and Save/Revert actions use the same rounded control surfaces. Touch layouts retain their existing controls.
In Availability, the topbar reads **Availability** and shows the selected owner.
The same desktop header row contains **New** (**New schedule**) and an expandable
**Search schedules** icon (name or time zone); on touch devices, New moves into
the header island and search keeps its existing full field.
Schedule cards show the default badge, time zone, a Monday-first
week preview, grouped hours, and booking-link/date-exception counts. **Preview**
uses an eye icon and opens all weekly hours and date exceptions without editing,
including for read-only users. Empty weekly hours say **Not set**; empty date
exceptions say **Unavailable**. Unsaved time-off annotations appear in the draft
only. The actions menu offers **Set as default**, **Copy schedule**, and
**Delete**. On touch devices, hold a schedule card to open these actions in a
drawer; the desktop More button is hidden. Shift+F10 or the Menu key on the
schedule name opens the same actions. The drawer uses the schedule name as its
heading, with a circular close button and an independently scrolling action list.
Closing restores focus to the card; Copy schedule and Delete wait for the drawer
to close before opening the editor or confirmation.
Delete opens the shared confirmation dialog; schedules used by booking
links instead explain that those links must move first. Cancelling restores focus
without changing the schedule. While a delete is saving, focus returns to the
schedule list rather than a disabled action. Returning from a copied-schedule
editor restores focus to the card's name on touch or its desktop action button.
Long names/hours have tooltips and remain contained at narrow widths.

**New schedule** opens **Create schedule**; the title or **Edit schedule** opens
**Edit schedule**. Both hide the list toolbar and show the editor title with
**Back to availability**. The editor follows the stored schedule model rather than
treating the calendar as a drawing surface: **Schedule details**,
**Weekly hours**, and **Date exceptions** remain visible. Weekly rules open inline;
date exceptions open in a shared dialog over the calendar. The large transparent
schedule title is directly editable. The aligned time-zone field and browser-local
**12h / 24h** display preference sit beneath it. Changing the time format does not
change stored hours.

**Weekly hours** lists all seven weekdays with their available hours, explicit time
off, or **Not set**. Each row's Add/Edit action opens that weekday's complete hours
inline. **Add hours** starts at the last row's end and extends one hour; the first
range starts at 09:00. The inline hours list has its own bounded scroll area;
Add hours and Apply/Cancel remain outside it. Adding scrolls only the list to the
new range. Each range has an **Available / Unavailable** choice, exact
start/end times, **All day**, and removal. All day sits beside the time inputs when
space allows. It disables the inputs and displays the saved **00:00–23:59** bounds;
turning it off restores the previously entered times. Add hours scrolls the new
range into view. It is disabled while any range is all-day, while the last range
is invalid, or when a full hour cannot fit before midnight. For breaks, turn off
All day and use separate time ranges. **Apply weekly hours** replaces that
weekday's two interval sets without changing other weekdays or date exceptions.
Removing a range moves focus to a surviving range or Add hours, not
another Remove action.

The **Calendar preview** stays on the right at wide sizes; narrow layouts stack it
below weekly hours. It has square date cells, month navigation, and a current-date
highlight without a Today label. Available hours use accent bars and draft time
off uses gray bars. Only available windows persist; all other times are non-bookable.
The weekday headings open weekly hours. Clicking a date or any of its bars opens that date's
complete hours in the date-exception dialog without expanding the calendar layout.
Dragging across dates selects an inclusive range. Keyboard users focus a date and
press Enter or Space; focus moves into the dialog and returns on Apply, Cancel, or
Escape. Escape closes a nested date picker before the exception dialog. Dragging
at the viewport edge scrolls the calendar or its surrounding content. Release,
Escape, and pointer cancellation stop scrolling.

**Add exception** opens the same dialog with a shared date picker.
Changing its date while unchanged loads that date's existing effective hours. A
multi-date selection shows natural-language dates instead of a date picker. Shared
hours prefill the range list; different hours never copy the first date's values or
invent defaults. Only the range list scrolls; the dialog heading, date controls,
**Add hours**, and action footer stay fixed. The footer uses larger action buttons:
**Clear selected hours** on the left and **Cancel** / **Apply** on the right
(wrapping on narrow screens). Add hours explicitly sets
a replacement for every selected date, or choose an individual date with
**Dates to edit**. **Apply exception** / **Apply to N dates** replaces the complete
day's draft hours atomically. Invalid times, overnight ranges, overlapping
available/time-off ranges, and excessive intervals
or dates are rejected before changing the draft schedule.

Date exceptions replace weekly hours, rather than adding to them. **Clear selected
hours** creates an empty exception: that date remains non-bookable and does not
inherit weekly hours. Exception rows spell out the date and saved available hours.
Their Remove action removes the entire exception and restores weekly inheritance.
Saving sends only available windows using the existing backend contract. Time-off
annotations are local to the draft and disappear after saving/reloading; unset and
explicit time off are not stored as separate states. Timed exceptions show only
their stored available hours in the editor; empty exceptions show all-day unavailability.
There is no separate stamp mode or single-range conflict-replacement flow; edit
whole-day rules directly instead.

Changed editor fields protect the draft from date selection, month navigation,
and switching weekday rows until Apply or Cancel. An unchanged exception dialog
can dismiss on an outside click; changed exception drafts require Apply, Cancel,
or Escape. Reverting to the original values unlocks navigation. Opening an editor
alone does not change the schedule. Apply updates the local schedule draft, never
the server. Finish or cancel the editor before **Save schedule**, which is the only
persistence action. **Clear schedule** beside the title clears all weekly hours,
date exceptions, and pending editor work while preserving the name and time zone.
**Back to availability** or the footer's **Cancel** discards the entire draft. All action buttons use shared Button.
Schedule-card **Copy schedule** still opens a new draft without changing the
original. Leave the editor to discard verification drafts instead of modifying
hosted data.
The selected Personal or Team owner appears in the workspace header, not on link or schedule cards.
Search booking links by title, description, or slug within the selected owner.
Every team member can edit team links, schedules, and the booking page. The standard
**New booking link** action opens a dialog without saving anything, including when no
schedule exists. It grows to 42rem wide and retains an 8px gutter on narrow screens.
Editing steps stay at 36rem when space permits. Review can grow with its content.
Both are capped for the viewport, safe areas, and virtual keyboard. The header and
footer stay fixed; content scrolls when it reaches the height limit.
Header, content, and footer use matching 24px horizontal padding on wider screens.
The fixed header has no bottom divider. The active step heading sits on the left,
with a compact continuous progress bar on the right. Its accent fill extends
through the current step. The current step number sits before the heading and
matches its typography and color, without a visible button frame. Click it to open
a dropdown listing all five steps, with the current step checked.
Earlier steps open directly; forward jumps validate all earlier steps and focus
the first invalid field if needed. The step menu supports keyboard navigation
and locks while saving. Footer and section dividers use contrast-aware border tokens
in light and dark themes. Field and section subheadings use smaller,
normal-weight, muted text, while entered values retain their normal contrast.
The footer keeps Cancel at the far left; Back sits beside Next and is absent on
the first step. Step content has no separate tabs. Inputs use consistent styling
and rounded pill presets whose selected accent or unselected muted text stays
unchanged on hover.
The screen-reader-only title identifies New personal booking link, New team booking
link, or Edit booking link. It has five steps:
Details, Location & availability, Questions, Booking rules, and Review.
Details contains title, description, and duration.
Next validates required values without saving; Back preserves the draft and
control state and returns to the preceding step even if external schedule changes
invalidate earlier values. Next and Back move between steps and focus the active
content. Step content uses compact top padding below the header.
Review sections have no dividers and share a fixed left icon column. Headings and
all section content align in an indented content column. Title and Description
are stacked label/value fields, followed by the Link URL and its copy-link icon.
There are no Review Edit actions; use Back to change values. Icons appear beside
section headings, not individual values. Values sit closely below their plain
labels. For saved links, the Link field shows and copies the persisted booking URL
without saving pending edits. New and duplicated links show their draft URL and
have no copy action until saved. Meeting buffers combines nonzero before/after values and shows
No buffers when both are zero.
On Review, the warning-triangle action sits closely beside Questions and opens a bounded help popover
explaining that name and email are always collected. The note stays hidden until opened.
Existing links show an Enabled section with a power icon after Booking rules.
Only the switch appears below the heading; its accessible label is Enabled.
Pausing or reactivating changes only the draft until Save changes. The control disables while
saving. New links retain their active default; duplicates retain their paused default.
Use automatic confirmation updates a legacy link's draft without saving or leaving
Review. Reset team settings restores the default hosts and scheduling type in the
draft and stays on Location & availability.
The footer primary action is Next until Review, then Create link (Save changes
for existing links), with a plus icon for Create link. Save draft is not available.
Cancel, Escape, and clicking outside request closing. If saved values differ from
the initial draft, a Discard changes? confirmation offers Keep editing or Discard
changes. Keeping the draft restores focus. Discard waits for confirmation teardown
before closing the editor and returning focus to its booking-list opener, without
saving. Unchanged or reverted drafts, step navigation, and empty question
placeholders do not prompt.
Validation errors return to the relevant step, outline affected controls, and appear
immediately beneath those controls. Correcting a field clears its error without
another Next click.
Submitting with Enter or Next focuses the first invalid control and scrolls its
message into view. Live edits clear errors without moving focus to another control.
Save failures appear beneath the action that attempted the write, not in a banner.
The progress indicator exposes Step X of 5 and the active heading to assistive
technology. It updates on each step. Stepper animates the body
while retaining controls. Back and Next remain text-only. Saving disables
navigation and editor actions.
Description sits below the title/link area. Neither description nor duration has
an info icon. Duration always shows a slider with numeric hours/minutes fields
sharing a compact frame on the right. Both parts stay visible, including `0 hours`
and `0 mins`; the unit labels are fixed, with no selector, presets, or minus/plus
buttons. Excess minutes normalize into hours on blur. Errors appear below the
slider and say “Duration must be between 5 mins and 8 hours.” Min/max labels appear
above both ends. The slider uses 15-minute adjustments with a 5-minute lower limit;
Ctrl enables one-minute pointer or keyboard adjustments. The shared Tooltip component
shows each slider's current value on hover, focus, and drag, anchored to its thumb.
Duration tooltips show hours and minutes for longer durations.
Pressing a thumb without moving it preserves exact values, including values beyond
the displayed scale. Duration dragging reaches the full 480-minute maximum.
Saved exact values stay unchanged until an explicit input or slider movement.
The pencil icon beside the URL opens an optional custom-link popover. A blank
custom link uses a unique automatic URL based on the meeting title. New title-based
links receive a suffix when another link already uses that URL. Renaming a saved
link preserves its URL; only explicit custom-link edits or Reset to title change it.
Only entered custom links validate their format; Reset to title generates a unique
URL for the current title.
Escape closes the popover without closing the editor and returns focus to the pencil
icon.
Location offers Macro call, Google Meet, and Custom presets. New links default
to Macro call; booking creates a call and adds its join link to the invitation.
The selected option uses a subtle accent tint, accent text, and an accent border.
Custom shows an address or URL input; either video option shows joining
instructions. Switching presets preserves the entered location/instructions. Availability keeps its
schedule picker without an extra Availability schedule heading. The selected schedule's
weekly hours and timezone appear directly beneath the picker. This summary does not show
live calendar free/busy or date overrides. First-time links use the default draft schedule
until saved. Calendar busy-time exclusions appear in the help popover beside
Availability. Team links group Scheduling type and Team hosts under Team scheduling
in Location & availability. Collective and Round robin use pill selectors above
Team hosts. The header's icon-only Reset team
settings action restores the default mode and hosts, and is disabled at those defaults.
A warning icon to the right of Team hosts opens the connected-calendar requirement.
Collective requires all selected hosts; Round robin assigns one available host.
Team hosts uses a compact searchable, virtualized multi-select that opens downward
outside the dialog so its bounds do not clip the options, with avatars and selected
checkboxes. Selected hosts appear first when the dropdown opens; toggling hosts
keeps the current row order. Search matches names and emails; selections stay in
the draft until saved. Escape closes only the host dropdown and restores its
trigger focus.
Selected former members remain visible for removal, and validation requires at
least one current host. Personal links remain Individual and omit team controls.
New links show two optional question fields immediately; existing questions keep
their values and Required options. Blank or whitespace-only rows never block
navigation and are omitted from Review and saved configuration. The name/email
explanation appears with a warning triangle above the fixed footer on Questions;
Review puts it in its help
popover. Each question has no inset card or padding, and shows Required and an
icon-only Remove control beside its label, above the input. There is no bulk
Remove questions action. Removing an
individual question focuses the next question, the previous question after removing
the last one, or Add a question if none remain. Booking rules has no outer
disclosure or Remove action.
Booking rules shows a Booking range heading and click-open info popover above one
two-handle slider. The short popover explains how soon a meeting can start after
booking and how many days ahead guests can book. Exact
current-value inputs replace the static scale endpoints above the track: earliest
on the left and latest on the right, including on narrow screens. There are no
visible question labels, unit menus, or section divider lines. Both offsets are
measured from now, not from one another. These rules restrict meeting start times,
not when the link is active. The scale gives hours and days more room, with visible
landmarks at 1 hour, 4 hours, 1 day, 7 days, and 14 days, ending at 30 days.
Values above thirty days remain at the right edge without changing their exact
stored value; the latest input accepts up to 365 days. At that edge, increase keys
and End preserve the exact value; a decrease key moves back below the displayed
limit. Moving one handle changes only that endpoint. Earliest gestures use
15-minute steps below 2 hours,
30-minute steps below 4 hours, hourly steps below 1 day, and daily steps beyond.
Ctrl enables minute-level pointer/arrow adjustments, including stationary clicks;
latest arrows step in days. Earliest PageDown at one day returns to 23 hours.
Horizontal arrows follow the reading direction. Slider
gestures keep the endpoints ordered; exact inputs preserve equal/reversed values
and show existing cross-field validation instead of silently changing the other end.
Earliest supports 0–10,080 minutes; latest supports 1–365 days. Latest must extend
beyond earliest. Invalid ranges block Next/save and focus the affected input.
Time-slot interval uses preset pills for 5, 10, 15, 20, 30, 45, and 60 mins,
plus Custom. Custom reveals a compact exact input supporting 5–480 minutes.
Daily booking limit uses No limit, 1, 3, 5, 10, and 20 preset pills, plus Custom.
Its exact input supports 0–100 bookings; zero saves as null. Both pill rows wrap
on narrow screens. Selecting Custom focuses its input without changing the value.
Typing a preset value manually keeps Custom selected. Selecting a preset hides the
exact input. The frequency controls have no sliders.
Time between meetings appears last, with separate before/after number inputs and no
sliders. Booking range, time-slot interval, daily booking limit, and Time between
meetings have 32px vertical gaps between sections.
Other sliders display min/max labels above their ends; Booking range displays
editable current values instead.
Enter in any exact input never advances the step or saves the link. Validation,
field bounds, unit conversion, draft retention, save, and discard behavior remain
unchanged. Errors stay below controls; stored fractions stay visible until corrected.
Booking range displays earliest as whole hours and minutes, such as `1 h 30 m`;
its thumb tooltip uses the same format. The earliest textbox accepts `1 h 30 m`,
`1h 30m`, or `90 m`; a bare number means minutes. Partial text stays local until
it parses, and blur restores the last valid draft in hours/minutes format. The
latest input and tooltip use days only, never weeks. Neither endpoint has a unit
menu. Other number/unit controls use NumberUnitInput on Kobalte NumberField and
retain their unit menus. Exact input frames stay visible above, beside, or below
sliders; no slider/input control shows minus/plus buttons. Duration fields accept
whole hours and minutes, preserve exact minute values, and normalize on blur.
Other controls keep booking counts and minute/day units whole.
Parsed out-of-range duration and notice values remain visible in the draft;
validation blocks Next/save with an error until corrected. Blank or non-parsable
time text stays local; blur restores the last parsed draft value. Other number/unit
inputs restore their last valid values after blank or out-of-range input.
Explicit unit choices replace the previous preference. Saved values remain whole
minutes or days. Slider movement never overwrites another endpoint or a clipped
exact value. No limit and zero save as null, preserving the backend contract.
Questions are booking-specific text answers with labels and Required checkboxes,
not forms. Only Create link or Save changes persists the draft.
Configured options remain visible when editing. **Create link** uses shared primary
action styling and activates a fresh link. Closing an edited link requests discard
confirmation. The first link and any default
working-hours schedule are saved together. Existing links can still be edited,
toggled, duplicated, deleted, previewed, and copied. Editing an inactive link does
not activate it. Duplicated links stay paused on Create link; only fresh New
booking link drafts activate by default.
Booking-link card options use the shared Dropdown menu with padded Groups and
standard icon/text items; Delete sits in its own separated group. Immediate activation
switches use the shared accent-colored ToggleSwitch without custom color overrides.
Changing workspace sections or owners, including browser history, dismisses and
clears unsaved link/availability editors instead of reopening stale drafts. UI
navigation stays disabled during saving; hidden owners cannot retain open dialogs.
`Availability` manages named weekly schedules and date overrides in an IANA time
zone. Set a default schedule for new event types; a schedule cannot be deleted
until its event types use another one. Collective and round-robin team meetings
respect each host’s personal default hours when configured, plus busy calendars.
Team membership remains in team settings. Team-host selection and collective
or round-robin assignment live in the link dialog. Booking-page identity is
configured in the Scheduling workspace's Booking page tab. `Bookings` uses the
shared view search bar and redesigned meeting cards grouped by date in the selected
display time zone. Cards span the pane. Their left column stacks status above
weekday, date, and year. The right-hand details group includes a clock icon with
the time range, a timer icon with duration, and host/location metadata. Metadata
items wrap as whole groups before their text wraps; long values wrap only when
wider than the available row.
Time ranges keep each clock value intact and wrap only between endpoints on narrow
cards. A shared timezone stays beside the range when space allows; overnight bookings
show an explicit end date, and daylight-saving changes retain both timezone labels. Borderless
status tabs show Upcoming, Unconfirmed, Past, Cancelled, and Needs attention when
calendar synchronization needs help. The filter button immediately right of
search groups the booking-link filter, display-timezone selector, and date range.
Touch uses the shared circular filter button and mobile filter drawer, with
collapsible **Booking links**, **Time zone**, and **Date range** sections. Options
are selectable rows, longer lists include search, and dates edit inline. The
close button restores focus; Clear all resets the selected booking-link filter.
Desktop uses a popover. Status tabs remain outside the filter surface.
The main card column gives the larger title a text-align-left
icon, followed by the guest name with a person icon and an icon-free email aligned
under the name. The name and email have a compact 4px gap; other detail groups use
consistent 16px gaps, independent of the date column's height. Card status uses
a colored dot and label without a pill outline or padding;
details keep the property-style badge. More sits immediately to the left of
Join meeting or Confirm on desktop, aligned with the metadata row on wide cards.
Actions retain their full size; narrow cards place them below the metadata.
On touch devices, More is hidden; hold a booking card to open its action drawer.
Shift+F10 or the Menu key on the card also opens the actions. The drawer uses the
booking title as its heading and has a circular close button above its scrolling
action list. Closing restores card focus; Details, Reschedule, and Cancel/Decline
first dismiss the drawer before opening their destination.
Cancelled cards are dimmed. Click a
card's main content to open Booking details, including host names,
location, the guest's time zone, and question responses. Status sits beside the meeting
title. Permitted footer actions stay grouped in Cancel/Decline, Reschedule, and
Join meeting (or Confirm for a request) order. Cancel and Decline use destructive styling.
More and right-click menus provide the same permitted actions as the details dialog.
Team owners/admins can confirm requests and manage any booking. Assigned hosts can
reschedule or cancel their own future confirmed bookings without admin access. Cancellation asks for confirmation before releasing the
reserved time. The confirmation appears above the details; Cancel/Decline scrolls it
into view and focuses Keep booking. Keep booking returns focus to Cancel/Decline. After a confirmed meeting ends, an assigned host or team admin can
record attendance or a host/guest no-show in its details.
Open **Filters**, then the date-range control to choose From/Through dates and
Apply dates (initially 30 days before and after today). On touch, Cancel discards
the date draft and closes the filter drawer. Closing without applying keeps the
loaded range. Escape closes an open date picker first, then the filter drawer,
including when a closed date field has focus.
Loading dates use your browser time zone; changing the display
time zone only changes card grouping and displayed times. Shorten the range if more
than 5,000 bookings match.
Pending requests from older configurations appear under Unconfirmed. New approval-only links are disabled;
new links use automatic confirmation and provider calendar invitations. Existing approval
links must switch to automatic confirmation before accepting new bookings.

`Insights` reports the selected personal/team owner with 7/30/90-day or custom
ranges, event/host filters, previous-period comparisons, event trends, meeting
hours, no-shows, popular events, and host counts. Download exports the filtered
bookings to CSV. Metrics use booking start dates in the default schedule’s time
zone; failed/processing requests are excluded. Completed means ended confirmed
bookings excluding recorded no-shows. Rescheduled counts bookings with recorded
reschedule history. Ratings/CSAT are not shown because no survey data is collected.
Oversized result sets return an error instead of silently truncating insights.
The top toolbar places the filter button beside **Download**. Touch uses the
shared circular filter button and mobile filter drawer, with collapsible
**Booking links**, **Hosts**, and **Date range** sections. Selectable rows replace
nested dropdowns, and the date section includes presets and inline custom dates.
Desktop uses a popover with event-type, host, and date-range selectors.
Clear all resets event and host filters. Closing and reopening keeps selected
filters; nested menus and date pickers dismiss before the filter surface.
Closing the drawer restores its trigger.
The desktop host filter uses Tasks' Assignee submenu search header, compact rows, and small
avatars, but selects one host at a time. The selected host has a trailing checkmark,
not a leading checkbox, and stays pinned first on reopening. Its searchable,
virtualized list is capped at 240px tall. Rows show names without email subtitles;
search still matches names and emails. Screen readers announce emails to distinguish
names.
Choices include the signed-in user, team members, booking-link
hosts, and hosts from loaded bookings, without duplicate IDs or a display limit.
Historical hosts absent from the member directory remain available as Former member.
A selected historical host stays selected and visible after date-range changes,
even when the new range has no bookings for that host. Select All hosts to remove
the host filter. On desktop, Custom range opens a submenu with Start date and
End date fields, with Clear on the left and Apply dates on the right. Touch shows
these fields directly in the Date range section. Draft changes do not alter the
report until applied. Clear empties both date fields
and removes validation errors without changing the report; Escape discards drafts.
The Events card includes an outcome donut with one slice per booking outcome:
Completed, Upcoming, Cancelled, Pending approval, Host no-show, or Guest no-show.
Rescheduled remains a separate metric because a rescheduled booking also has an
outcome. The outcome rows show counts by default. Use the # / % buttons above the
rows to switch between counts and percentages. Focus or hover a slice to read
both values. The donut total remains a booking count. Event trends and
Popular booking times use lazily loaded Observable Plot; the donut uses D3.
Popular event types and Bookings by host use simple name/count rows with progress
bars relative to the highest count. Toggle trend series in the legend, or focus
the trend chart and use left/right arrows to read dates. Each Plot chart also
offers a data table. Performance retains separate time and no-show metrics rather
than putting different units on one scale.
Insights fills the available content width. Wide panes stack Popular event types,
Popular booking times, and Bookings by host in a column beside the metrics and
event trend. Narrow panes move the same stack below the metrics and event trend.
Layout responds to the pane width, including split views, rather than only the window width.
Scroll the report to reach every metric, chart, and table; the report owns its
vertical scrolling without clipping the lower sections.

## Calendar invitations in email

In `/app/component/mail`, open an invitation message; the same card appears in
`/app/email/:threadId`. Saved details appear below the sender without waiting for calendar
sync. Expand guests and descriptions with their explicit controls. `View original email`
is an accessible disclosure that starts closed and stays open across unchanged
permission refreshes and window refocus on desktop and mobile; attachments remain below it.
ICS attachments show a calendar icon in the attachment pill and file headers on
desktop and mobile, including when the email uses `application/ics` or a
parameterized `text/calendar` MIME type. Opening the attachment of a message that shows a
card opens a dialog (a drawer on phones) with the same card, so its RSVP or `Add to calendar`
works there, and `Download .ics`, which saves the file without adding it to Drive. When an
invitation's card falls back to the saved invitation (the event matches nothing on your
calendars), its status line reads `Saved invitation.` in the dialog; the card in the email
adds that the original email or invitation attachment has more options. A shared event shown
without a calendar check reads `Shared event.` in the dialog the same way, while the card in
the email points at the original email or event attachment. The card stays put while the
thread refreshes. Close, Escape, or dismissing the phone drawer returns focus to the
attachment chip; `Open in calendar` closes the dialog before the calendar opens, including
when Calendar is already open in another split, without pulling focus back to the email. A
calendar file with
no card (nothing Macro could read) downloads directly, and an Outlook cloud-reference `.ics`
opens its Outlook page like any other reference attachment.
Related recurring components are grouped behind their own disclosure. Only mail synced
after the feature shipped gets a card; older invitations render as plain email.
A newly arrived scheduling update shows RSVP and Join only once its calendar state has
been checked. A series invitation shows its current or next live occurrence.

Descriptions render sanitized rich text, including emphasis, links, and lists.
Plain-text line breaks and literal angle brackets (such as `<bob@example.com>`)
remain readable. Use `Show more` / `Show less` to expand or collapse the description;
description links use the host's normal link-opening behavior.

A published event file (`METHOD:PUBLISH`, what `Forward by email` and, for a Google
organizer, `Forward invitation` attach) is a shared
event, not an invitation: the card reads `Shared event organized by <organizer>` and never
shows Yes / Maybe / No, a last response, or a waiting-for-sync line. When the viewer already
holds the meeting it says `On your calendar.` with `Open in calendar` and `View your day`;
when the meeting is on more than one of the viewer's accounts it says
`This event matches multiple accounts. Open your calendar to choose.`, as an invitation does.
When the calendar check confirms the viewer does not hold it, the card says
`Not on your calendar.` and, behind the `enable-calendar-add-shared-event` flag, offers
`Add to calendar`, which imports the same snapshot as the channel-share card
(the viewer's only writable Google calendar, or one picked from a menu; the real organizer
kept, the viewer as the only guest, nobody notified), except that it keeps the join link the
file carries, through email service's
`POST /email/threads/{thread_id}/messages/{message_id}/calendar-invitations/{invitation_id}/copy`.
The server reads the event from the saved email, never from the request. The card then
resolves to the snapshot. A single occurrence, a cancelled event, a time that cannot be read,
and mail saved before recurrence was recorded on the snapshot get no `Add to calendar`.
Nor does a card whose check is not confirmed: it says `Checking your connected calendar…`
while loading, `Connect a calendar to add this event.` without a calendar, and
`Calendar unavailable. Saved event details are shown.` when the check fails; a failed
refresh after an earlier `Not on your calendar.` keeps that line under the unavailable notice
but withholds the button.

A connected, resolved invitation shows the responding address and Yes / Maybe / No.
Calendars connected through a linked inbox also resolve here, using that inbox's
address for responses. Access is limited to the delegated inbox; another inbox owned
by the same account stays private, and removing the link removes invitation access.
Local verification requires both email and calendar services: email supplies saved
snapshots and resolves them against the synced calendar, while calendar service handles
the RSVP write. With calendar service's `CALENDAR_SYNC_ENABLED` off, its RSVP route is
not mounted, so a response fails with an error. Seeded local accounts have no Google
token, so an RSVP there fails at the provider write and rolls back.
The selected response remains pressed while a save is pending. Recurring invitations ask
for `This event` or `All events`. Failures keep the card in place and report a retryable
error; offline responses are not sent. Cancellation and response/proposal notifications
do not offer RSVP or Join. Disconnected, ambiguous, and syncing states explain why an
action is unavailable.

`Open in calendar` focuses the current occurrence, even if its date changed. It retargets a
Calendar split that is already open; otherwise a click replaces the email with Calendar and a
shift-click opens Calendar in a new split beside it, from the inline card and the `.ics` dialog.
`View your day` opens a compact agenda without changing the active split; Close returns
focus to its trigger. The event appears once, as the viewer's own copy in its time slot,
highlighted and marked `This invitation` (also on a shared event's card after `Add to
calendar`). A `This invitation` line with the email's own time stands above the list
instead while no such row is there: an unreadable time, the calendar unavailable, offline or
syncing, the copy past the first 20 events, or an email whose time differs from the copy
(a proposal, or an update the calendar has not synced yet; the copy stays highlighted). Busy overlapping events are labeled, while
cancelled, declined, and free events do not count as conflicts. Calendar 12/24-hour preferences apply to
already-open invitation cards as well as the calendar view.

For a writable Outlook event you organize, the editor's `Replace event…` action
can reset guest RSVPs or remove its online meeting. Save or discard ordinary edits
first. Choose the entire series or only this occurrence, review the saved event,
and check the cancellation/reinvitation acknowledgement before `Replace event`.
The old invitation is cancelled after the replacement is prepared; guests receive
a new invitation and must respond again. `Check progress` and `Continue replacement`
resume that saved operation after an interrupted response. Recovery continues when
the dialog closes. A conflict offers links to review both copies in Outlook; do
not create another copy while the existing operation is unresolved. Events with
native details that cannot be safely copied are rejected before any invitations.
For an Outlook invitation you attend, `Open in Outlook` below the RSVP controls
opens the actual occurrence so you can clear your own response there.

Calendar's New menus explain Event, Call, and Booking link with icons and muted descriptions. Call and Booking link keep their existing feature gates. Booking link opens the personal Scheduling workspace with an unsaved link editor; canceling creates nothing. The URL request is consumed once after the profile is ready.
