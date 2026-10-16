# Calendar

## Calendar — `/app/calendar/<month-or-week-or-day>`

Event composer dropdown triggers and date/time inputs use the theme control
surface, so they blend with the dialog instead of using the darker page fill.
Their menus stay inside the composer's portal scope. Verify that calendar,
recurrence, Guests, conferencing, Location, and Notifications open on the first
click from the title field and accept changes without closing the composer.
Open the start/end date picker and its nested time list; selecting a time keeps
the date picker open. Escape dismisses the active menu before the composer.

The path selects the Month, Week, or Day period, and choosing another period updates
that path. Calendar navigation defaults to Day on phones and Week on desktop; the most
recent choice is remembered locally for navigation that does not specify a period. An
opened event is reflected in the pane-owned `sN.calendar.eventId` search parameter.

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
jump fetches only the uncovered weeks. A `refresh_calendar` poke, reconnecting,
coming online, or returning to the tab runs one `CalendarChanges` delta that
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
Guests do not see chat. The `@` menu includes Macro and available agents;
mentioning one invokes it in the call thread. Reply on any live message, including
your own, quotes it in the bottom composer. Verify the reply preserves a draft,
an agent reply appears, and messages remain in the saved history; starting a
new session from the same meeting link must start a separate chat thread.


Calendar event creation and editing open in a bottom sheet on touch devices,
with scrollable content above the keyboard. Desktop retains the centered dialog.
Dismissing a changed event still asks before discarding the draft.

On phones, event details use inset round action buttons and a transparent RSVP
footer. Answering a recurring invitation opens a rounded glass sheet: choose
`This event` or `All events`, then `Save response`. Cancel or Close returns to
the event details without sending a response.

Calendar scheduling is on by default in dev. Production uses the PostHog flag
`enable-calendar-scheduling` and stays off unless enabled remotely. Set
`VITE_ENABLE_CALENDAR_SCHEDULING=false` to test the disabled state locally.
While off, the Calendar settings tab and calendar booking shortcuts are hidden;
public booking and receipt links show an unavailable page without fetching
scheduling data. When enabling a production rollout, include anonymous visitors
so invitees can open those links. A public booking link stays available when
the flag request gets no answer, for example when a browser blocks it.

Calendar connections live in **Settings → Calendar** (`/app/settings/calendar`).
Scheduling lives in the separate **Settings → Booking links** item
(`/app/settings/booking-links`). Use the owner menu at the top right to choose
**Personal** or **Team · team name**,
then use **Links**, **Availability**, **Booking page**, **Bookings**, or **Insights**.
Every section and creation action applies to that selected owner. The default is
Personal. **Manage teams** in that menu opens team settings. The calendar toolbar’s booking
actions open Booking links; connection shortcuts continue to open Calendar.
**New booking link** and **New schedule** create for the selected owner and open
inline editors. Save changes or Cancel returns to that owner's list.
Connected calendars offers Connect account (the existing Google consent flow),
Connect calendar for accounts missing calendar permission, and Disconnect with
confirmation. Disconnect removes calendar access/data, not the Gmail connection.
Account checkboxes show/hide all child calendars; partial selection is shown as
mixed. Individual calendars can also be shown/hidden. The account color is the
default for its calendars; a child color overrides it. Click a color dot to open
the theme-matched picker: drag the color field and hue slider, choose a named
swatch, or enter a three- or six-digit hex value. Arrow keys adjust the focused
color field (Shift makes larger steps). **Reset to default** clears the override.
Visibility and colors share the calendar sidebar's browser-local preferences,
survive reload, and do not change the Google calendar or booking conflict checks.
Booking status filters use the same segmented control as the CRM sidebar.
In Availability, each weekday has an enable switch, time ranges, an add button,
and a copy-hours menu; select target days and Apply before saving the schedule.
Date overrides and the searchable timezone picker sit below the weekly hours.
The header shows the selected owner; team owners have an explicit **Team** label.
Links and availability use flat rows, with actions beside each item.
Booking pages, bookings, and insights show only the selected owner. Search filters
that owner’s links and clears when switching owners. Any team member can edit
team links. Hosts can cancel or reschedule the meetings they host; team
owners/admins can also manage teammates’ bookings and approve pending ones.
`Links` creates, edits, pauses,
duplicates, previews, and copies booking links. Event settings include a
video choice. New links default to a Macro call, which is created when
someone books and attached to the calendar invitation. Google Meet and no
video link remain available. Event settings also include
weekly availability, collective/all-host or round-robin/one-host assignment,
notice, buffers, booking horizon, daily limits, and custom questions. New event
types stay paused until `Accept bookings` is selected and changes are saved.
`Availability` manages named weekly schedules and date overrides in an IANA time
zone. Set a default schedule for new event types; a schedule cannot be deleted
until its event types use another one. Collective and round-robin team meetings
respect each host’s personal default hours when configured, plus busy calendars.
**Manage teams** opens team settings, where the member roster lives. Choose hosts
for a team booking link inside its editor.
`Booking page` edits the public name and description. `Bookings` shows
upcoming, unconfirmed, past, and cancelled meetings; admins can confirm requests,
reschedule, or cancel them. Choose From/Through dates to load bookings (initially 30 days before and after today), then search by guest/title/email and filter by event type. Dates use your browser time zone; shorten the range if more than 5,000 bookings match.
Cancellation asks for confirmation. After a confirmed meeting ends, an assigned
host or team admin can mark attendance or a host/guest no-show. Pending requests
from older configurations appear under Unconfirmed. New approval-only links are disabled;
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

The calendar header includes `Copy booking link` and `Open calendar scheduling
settings`. Copy opens settings when no active personal link exists. Public
`/app/book/:profile/:slug?` pages accept bookings without Macro sign-in. The website
opens them in its own dialog; framed there, a booking page and its receipt drop their
Macro heading and footer, and the booking page tells the website when a booking is
made. Only macro.com can frame them. Uncertain
calendar writes retain the booking and show its private receipt while automatic recovery runs.
After a network response cannot be verified, `Check booking status` retries the original request;
do not create a replacement booking. Receipt pages poll while the calendar update is pending. Visitors
choose their time zone, date, time, and required details. The private
`/app/booking/:id#token` receipt supports cancellation and rescheduling; preserve
that private link. Rescheduling dates are labelled in the availability schedule's
time zone. Calendar provider failures show an error; they never report a
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
date, opens read-only event details, and marks the row active. The icon-only
`Calendar settings` control fills the sidebar footer.
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
that coworker's events occupy the user's time.

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
splits to a maximum of 24px, with a compact `New` menu when the sidebar is closed.
An icon-only ghost `Search events` button sits on the right, before a slightly
larger gap and the `Today`, period selector, and previous/next controls.
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

The period controls move into a separate row below 600px of calendar-pane width,
with `New` on the left and navigation on the right. With a docked sidebar, the
header needs fewer controls and stays inline down to 480px. This avoids wrapping
and immediately unwrapping when the sidebar hides. Expanded search does not
force early wrapping; its results popup stays directly below the search field.
Below 1040px, search slides over the month title without moving any controls or
changing the header height. `New` stays outside the search overlay. Resizing the
pane keeps the search field mounted and preserves its query and focus. Today
and New retain their text labels until the controls row runs out of room, then
become icon buttons.
Touch devices keep the month selector and header controls without separate
create or call buttons in the right island. Mobile header islands omit Search.
The desktop sidebar's mini calendar remains navigable by date and month.

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
(email + calendar).

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
that selection creates and attaches a Macro call after the event saves. Selecting
`Google Meet` or `No meeting link` skips the Macro call. Out-of-office entries do
not create calls. There is no separate call toggle or Scheduled Call menu option.
All-day events get an untimed call link, so setup does not display a misleading midnight time.
A failed link attachment keeps the composer open with a retry message; Save reuses
the saved event and call instead of creating duplicates. The invitation includes
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
the schedule.
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
the start, end, all-day setting, title, location, description, or repeat rule are still sent.
Test reminder removal as well as changing its time, including a series whose stored
rule contains `INTERVAL=1`, `WKST`, differently ordered weekdays, or a precise `UNTIL`:
an untouched rule must not be reformatted and included in a reminder-only PATCH.
As in Google Calendar, the guests row of the details popover (a bottom sheet on phones)
carries `Copy guest emails` and `Email guests` icon buttons. Copying puts every guest's
address on the clipboard, comma-separated. Emailing opens a new email addressed to every
guest but you — in a split beside the calendar on desktop, as the full-screen composer on
touch devices — and is hidden when you are the only guest.

With the `enable-calendar-team-ooo` flag on, teammates' Google Calendar out-of-office events
overlay the grid as read-only chips titled `<name>: <event title>`. The sidebar's
`Team out of office` section (shown only when the user belongs to a team with other members)
is a collapsible list of the next 90 days of teammate absences. The checkbox in its header
shows or hides the overlay (the list itself always shows); clicking a row navigates the grid
to that date. Coverage depends on each teammate having connected their own calendar and using
Google's out-of-office event type.

Routine sync notifications that explicitly exclude OOO changes refresh this list
in the background without returning to its skeleton. OOO changes, sharing changes,
and notifications without that guarantee still clear cached rows and close open
OOO details immediately before refetching.

A calendar event mentioned in a channel message opens the calendar focused on the viewer's
own copy of the meeting. When a person holds the event on their own calendar and posts the
mention, it is shared read-only with the channel's current members: a member without a copy of
their own sees the mention's title and time, and its hover card adds a `Shared with you · not on
your calendar` line with no open action. Clicking such a mention shows that hover card
instead of opening the calendar. A classic `@Macro` reply that mentions an event does not share
it by posting the chip. It asks whether to share with the channel, and a yes in that thread
writes the same channel grant. Private and confidential events are never shared this way.
Every calendar mention's hover card shows the schedule, location, organizer and attendee
count, plus the first lines of the event description (its links open), and no last-updated
byline.

## Calendar invitations in email

In `/app/component/mail`, open an invitation message; the same card appears in
`/app/email/:threadId`. Saved details appear below the sender without waiting for calendar
sync. Expand guests and descriptions with their explicit controls. `View original email`
is an accessible disclosure that starts closed; attachments remain below it.
ICS attachments show a calendar icon in the attachment pill and file headers on
desktop and mobile, including when the email uses `application/ics` or a
parameterized `text/calendar` MIME type. Opening the attachment still shows the
generic file viewer with download and share actions; the invitation card above
is the event preview.
Related recurring components are grouped behind their own disclosure. Only mail synced
after the feature shipped gets a card; older invitations render as plain email.
A newly arrived scheduling update shows RSVP and Join only once its calendar state has
been checked. A series invitation shows its current or next live occurrence.

Descriptions render sanitized rich text, including emphasis, links, and lists.
Plain-text line breaks and literal angle brackets (such as `<bob@example.com>`)
remain readable. Use `Show more` / `Show less` to expand or collapse the description;
description links use the host's normal link-opening behavior.

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

`Open in calendar` focuses the current occurrence, even if its date changed.
`View your day` opens a compact agenda without changing the active split; Close returns
focus to its trigger. Busy overlapping events are labeled, while cancelled, declined,
and free events do not count as conflicts. Calendar 12/24-hour preferences apply to
already-open invitation cards as well as the calendar view.
