# Native iPhone client

`apps/ios/MacroNative.xcodeproj` builds **Macro Native**, a standalone SwiftUI/UIKit
client for iPhone. It is separate from the Tauri app and uses the same Macro
account and backend. Build and installation commands are in
[the iOS README](../../apps/ios/README.md).

## Choose the right environment

A normal launch reads and writes the signed-in account's real data. The sign-in
screen offers production and development; hosted development data is also real.
Opening a conversation can mark it read. Sending messages or email, submitting
agent prompts, changing calendar events, and changing account settings have real
effects. Use the user's authorized scope for live actions; do not create test
messages, invites, events, or uploads in an existing account just to verify UI.

Debug builds provide isolated fixtures. `--demo` opens the fixture workspace;
`--ui-testing` starts on Channels and `--ui-testing --workspace-testing` starts
on Notifications. Fixture messaging, email, calendar, workspace, and agent actions
stay in process. Web editors and account integrations need a real sign-in and are
not authenticated by fixture mode. Tests must not depend on a signed-in browser
or a cached production session.

## Navigation and layout

The floating bottom dock switches between Notifications, Calendar, Email,
Channels, Files, and Agents as space allows. **More views** contains remaining
views, including Tasks and Calls, plus Settings. The adjacent magnifying glass
opens workspace search. The **New** action follows the selected surface; on the
home surface it offers a creation menu. **Ask AI** is an inline native composer: focusing, dictation, and attachments keep the current view open. Only an explicit Send creates a Macro AI chat through Cognition and opens its native transcript. Its unsent text and attachments survive switching views.

The home **New** menu unfolds glass pills over the blurred current screen. **More**
opens the complete creation drawer. Document, snippet, canvas, spreadsheet, code,
and folder actions create their production blank defaults, then open the matching
editor. Automation and Reminder have native schedule forms; entering instructions,
choosing days, or closing a form does not submit it. Automation drafts persist until
explicit Create. Call opens the existing `/meet/new` web flow without starting a call.

Each view retains its native navigation stack while switching tabs. Tapping the
selected dock item returns that view to its root. Native Back and the leading-edge
swipe return from details. The dock floats above scrolling content; the last row,
reader actions, and composers must be able to move clear of it. With the keyboard
open, the composer remains visible above the keyboard and the dock is hidden.
The dock keeps white filled active icons and moves a gray glass selection surface between
tabs without haptic feedback. Reduce Motion disables that movement.

Top-left controls expose each view's filters. Notifications separates Signal and
Noise; Files, Email, and Channels have their own scope controls. Server
filters apply before pagination. Done and Undo operate on inbox state; reading an
item should not itself remove it from Signal.

Tapping a notification, email, file, channel, or Search result highlights the
entire row through both gutters. That square selection stays visible while the
destination opens, without a spinner replacing the row, and clears when returning
to the list or reopening Search.

## Channels and threads

Channel history and multiline input are native controls. Sending inserts a row
immediately, clears only that draft, and retains keyboard focus. Incoming updates
and HTTP acknowledgements reconcile with that row. Failed sends stay visible and
retry with the same ID. Native channel and thread drafts survive navigation;
channel caches are scoped to the signed-in account.
Channels opened from Notifications or workspace search use the same native
conversation, including channels outside the recent Channels page. Notification and search routes resolve the exact message or thread target before marking the item seen, then expand and position that target in the native timeline.

Type `@` for the native mention picker. Cached people and channels appear
immediately; recent entities and workspace search add documents, tasks, email,
folders, agents, calls, calendar events, and other supported references. Date
suggestions and `@here` are also supported. Selecting a result keeps the keyboard
open and inserts a styled token. Editing a token's text turns it into plain text;
backspace removes an intact token as a unit. Draft restoration and sent messages
must retain the real Macro reference without exposing its wire markup.

Use the attachment button for native file selection, upload, or an existing Macro
item. Do not send until the selected attachments are ready. Long-press a message
for the native bottom drawer: quick reactions, searchable emoji, Reply, Copy
message text, Copy link, Create task, and applicable Edit/Delete actions. Owned
messages can be edited; owned messages and channel bot messages can be deleted.
Swipe a message left or choose Reply to open the inline reply composer beneath its
thread. Collapsed threads show their first three replies and a control for the
remaining replies. Expanding or replying reveals the full thread and remembers
that expansion for this account across navigation and restarts. New replies and
refreshes retain the full cached thread even while it is collapsed. Reply drafts,
attachments, pending sends, and retries are independent of the main channel
composer. An explicit access denial removes cached channel/thread content and
drafts; a temporary network error retains pending work.

On iOS 26, rightward swipes can begin anywhere in the channel content to move back
interactively; a short, slow swipe cancels and preserves the draft and reading
position. Earlier iOS versions retain edge-swipe navigation. Messages only move
left for Reply, never right independently of the page.

Check repeated open/back, content and edge-swipe navigation, multiline and consecutive
sends, retry, mention selection, attachment-only sends, and incoming messages
while reading older history. Loading earlier messages must preserve the reading
position. Verify slow drags and fast flings through expanded threads, grouped
messages, images, and agent cards; settled screenshots alone cannot expose
transient row overlap. The fixture `--test-channel-motion` records presentation
frames during touch tracking and deceleration, and `--test-scrolling-resize`
updates an older message while the conversation is open. Message cells measure
without screen safe-area padding, media reserves its height before loading, and
cached avatars must not flash back to initials when rows are reused.
A small first drag must remain where the reader leaves it, even within 100 points
of the latest message. Channel and reply keyboards dismiss interactively: start
near the composer and drag downward, checking intermediate keyboard positions and
that the input and latest message move together. The composer follows UIKit's
keyboard layout guide; dismissal begins above the keyboard at the composer's top.
Keep the dock hidden until dismissal finishes. Search retains its own keyboard
behavior. The `ChannelKeyboardUITests` fixture verifies finger tracking, preserved
drafts, and absence of message overlap during dismissal.
Returning to the foreground reconnects and fetches missed history;
there is no background push notification registration in this client yet.

New Message is a full native page with recipients, a message composer, mentions,
and attachments. Leaving preserves the draft. Send creates or reuses the canonical
DM/private group before queueing the optimistic message. New Channel opens its
own glass drawer with a name, optional invitees, and team/auto-join options when
available. Add people opens the native invitation drawer; the title menu's
Participants view stays inside the channel and supports searching members,
opening their DM, copying a private invitation link, and removing eligible members.
Protected owner/self membership cannot be removed there.

The channel title menu's **Ask Macro** opens a full native New Chat page, with the
channel reference in its bottom composer. It preserves an existing draft and does
not summon the keyboard or submit automatically. Existing agent sessions show
native text, inline screenshots, collapsed tool groups, permissions, changes and
pull-request controls, with model selection, attachments, dictation, Send, and Stop.

## Calendar

The initial mobile view is Day; the selected period is remembered. The month
button opens a month selector. Today returns to the current date, horizontal
swipes move one period, and Calendar settings selects Month, Week, or Day. Day and
week use a time grid with separate lanes for overlapping events; month shows event
labels and all-day spans. Dense months scroll vertically rather than hiding their
remaining events behind a summary count.

The header keeps Today, New event, New call, and Calendar settings. New call opens
the Calls web workspace, where the user chooses recipients and starts the call.
Calendar settings uses the production Period, Calendars, Display, Week starts on,
and Time format row groups. Calendar visibility rows show or hide every calendar
for that account; partial selections display a minus. Visibility is remembered
per signed-in account. Global Search can find calendar events. Tap an
event for its floating glass drawer: close/copy/edit/delete actions, schedule,
location, conference link and copy action, reminders, calendar attribution,
attendees, and RSVP. Guest actions copy addresses or open a native email draft.
Recurring-event RSVP asks whether to change this occurrence or the whole series.

The native floating Event drawer creates and edits events, with explicit dates, time zone,
all-day state, guests, recurrence, and recurrence scope. All-day end dates are
exclusive on the API; the editor presents an inclusive end day. Only writable
calendar copies offer edit/delete actions. Calendar connection and provider
account management open the authenticated Integrations page.

## Email, files, tasks, and calls

Email provides Signal, Noise, Sent, Scheduled, Calendar, Drafts, Shared, and All
views, with native account/status/attachment filters. Compose and reply open a full
page with compact To/Cc/Bcc/From/Subject rows and floating Back, Attach, Schedule,
and Send controls. The idle composer retains the shared dock and Ask AI/New row;
focusing its body hides that chrome and keeps the optional signature strip above
the keyboard. The signature comes from the sending inbox and can be previewed or
excluded for this message. Choosing a schedule only edits the draft; Send saves
and schedules delivery explicitly.

Type `@` in an email body for the shared native entity picker. Drafts preserve
mention metadata; outgoing mail uses readable plain text and escaped portable
HTML links, never raw mention JSON in the visible body. Closing a changed draft
offers server save, local retention, or discard. Message bodies render inside the
native reader. Verify that links, selection, Reply, and reader navigation remain
reachable above the floating dock. Fixture sends affect only fixture mailboxes.

Workspace Search is a full page with scope pills and its query/Ask AI controls
above the keyboard. Enter three characters to search the server; short queries
filter recent entities locally. Selecting a result opens its native destination
where supported. Ask AI submits the query only when explicitly tapped.

Files and folders use native lists, creation, renaming, favorites, filtering, and
search. File content opens its appropriate authenticated web editor inside the
app. New Task opens a native floating composer with title, description, status,
priority, assignees, due date, tags, and media attachments. Create More submits a
task and clears its title/body while retaining properties for the next task.
Closing retains the unfinished account-scoped draft; Clear Draft resets it.
The expand action creates the current draft and opens its native task details.
Creating a task from a channel message seeds its title and message reference.
Task details expose native completion, status, properties, and rename;
**Open task notes** opens the task editor.

Calls have a native history/details view with participants, summary, transcript,
and recording links when available. Joining or starting a live channel call opens
the existing web call experience. Audio/video calling is not a native media stack.

## Agents and settings

Agent sessions have a native transcript, tool groups, queued/pending prompts,
permission responses, model selection, attachments, and a multiline composer.
Editable sessions allow sending, retry, and stopping a running agent. Read-only
sessions do not expose write controls. Dictation uses iOS microphone/speech
permissions when the user starts it. Structured agent forms open their authenticated web surface. Macro AI chats, including Home/Search Ask AI and the channel Ask Macro action, use the Cognition chat service with its Claude/OpenAI models, streaming text, tool responses, and native transcript. They do not create ACP agent sessions. Choosing **New → More → Agent** remains the explicit ACP agent creation path.

Home and Search create and submit a Cognition chat only after explicit Send.
Channel **Ask Macro** opens a new chat and seeds the channel mention and attachment,
without submitting the prompt. The chosen Claude/OpenAI model is retained between
prompts. Send streams native text and tool results; Stop cancels the active stream.
If a connection ends before delivery is confirmed, refresh/check the conversation
before sending again: the client does not automatically repost an uncertain prompt.
Reopening a completed New Chat action starts a separate conversation; an unfinished
new-chat draft retains its identity so returning to it does not create another chat.
For fixture QA, verify incoming chunks, reconnect replay, model choice, channel/file
context, tool responses, and a response finishing before its HTTP acknowledgement.
Do not submit real prompts solely to validate the integration.

Settings follows the mobile Account, Preferences, and Workspace groups. Profile
names and appearance are edited natively. Profile photos, API keys, billing, team,
tags, and integrations open their corresponding authenticated settings pages.
Settings uses the mobile floating glass drawer with its handle and close control.
Appearance supports System, Light, and Dark; check the drawer and its detail pages
after changing it. Signing out clears the local account's message cache and
credentials.

## Verification

Run the native unit/UI scheme through `apps/ios/scripts/ios.sh test`. Its fixtures
cover API contracts, send/retry races, history reconciliation, calendar date and
recurrence rules, email/workspace actions, and native navigation. Screenshot
attachments are in the Xcode test result bundle under `apps/ios/.build/Logs/Test`.
Separate live sign-in and account audits skip unless explicitly enabled; those
tests use the real account and require the user's authorization for their scope.

Before a visual handoff, compare each native surface to the mobile Tauri reference
at the same device size. Check header hierarchy, filters, event/message density,
keyboard behavior, inline reply expansion and left-swipe gestures, light/dark
appearance, and content passing beneath the floating
dock. A test finding a control is insufficient: it must also be reachable and
unobscured. Document editors, complex integration settings, and live
calls intentionally use web content; the navigation around them stays native.

Simulator builds used for live sign-in must retain Xcode ad-hoc signing (`CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=-`). Disabling signing removes the simulator application identifier and prevents access to the saved Keychain session; fixture-only runs can hide this defect.
