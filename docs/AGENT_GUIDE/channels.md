# Channels and Messaging

## Create a channel

1. `Create` → `Channel G`. Dialog `Create a channel` opens with the `Name` textbox focused.
2. `fill` the name.
3. Invite (optional): click the combobox `To: Macro users or email addresses`, `type_text`
   the email, wait for the live-region text `one option available` (or `N options`), press
   **Enter** to tokenize — the email becomes a chip above the combobox. Skipping the Enter
   leaves raw text that is not submitted.
4. Click `Create Channel`. Navigates to the channel (as a split pane:
   `.../channel/<uuid>`); a system row `Channel <name> created` appears.

Channels are invite-only ("Only people you invite can see this channel"). A DM is just a
channel between two users.

## Message composer

Placeholder `Type @ to share with #<name>`. Click it, `type_text`, press Enter to send.
The message renders immediately with avatar, email, timestamp. Composer extras: `Attach
files`, `Format`, a `Task` switch (turns the message into a task), `Send message` button.

Hover a message for its action menu. `Reply` on a top-level message opens that thread. On
an existing thread reply, it inserts a one-line reply-target reference into the composer;
clicking the reference navigates back to that reply. If text in the message is
browser-selected before `Reply` is clicked, the reference previews only the selected text.
For agent-session messages, the reference previews the resolved answer or current activity
rather than the internal Magic Chip marker.
Agent-session announcements use the same ReplyTarget reference for the prompting channel
message; ordinary Markdown blockquotes remain presentation-only and do not count as replies.
The composer always keeps an editable empty line after a block reference, including after
the user deletes that line, so clicking below the reference can restore the text caret.

`@Macro` answers in the thread (classic bot). Its tool calls execute immediately — there is
no composer or pending-confirmation card in a channel, so asking it to create a calendar
event without attendees creates the event right away (unlike AI chat, where creation waits
for the user to confirm a composer card). For an event with attendees the bot is prompted to
ask for confirmation in the thread first, since Google sends the invitations the moment the
event is created — no invitation goes out from the initial request. It cannot draft or send
email at all. The bot's prompt carries the current date and time in the mentioning user's
own time zone (their primary calendar's), so it resolves relative times ("tomorrow at 4",
"EOD") without asking; when no calendar is connected the prompt falls back to UTC and the
bot asks before scheduling a specific clock time. `@macro-new` / `@coder` / `@cursor` open
an agent session; follow-up
`@` mentions of that bot in the same thread route to it.
The reply renders a Magic Chip: a rounded card of constant height that is present
from the moment the session boots. Its header names the bot as a mention (`@cursor`),
the model when the runtime has reported one, and what the turn is doing (`Booting
agent`, `Running command · cargo test`, `Waiting for you`, `Done`); clicking the header
or its arrow (`Open in session`) opens the agent session. The area under the header
holds the agent's latest passage: a pulsing star while the agent is busy before it
writes, the passage as it streams, and the final passage once the turn ends - the last
text the agent wrote, not the whole turn, and a finished turn with nothing said leaves
the area empty. The passage is clipped to four lines with a fade and a `Show more`
cue: click it to expand in place (`Show less` collapses it). Before an answer exists,
clicking the area also opens the session.
When the agent stops to ask a question the chip keeps its height. A form or URL question
puts its prompt and fields in a pane - beside the passage on the chip's right when the
agent said something first, or as the whole card when it did not - scrolling inside the
chip when long: a form's choices (rows with an accent box, an `Other` row when the agent
allows a free-text answer), text and number inputs, a yes/no; a URL request's host and
address. Its decisions sit in the header before the arrow: `Submit` (or `Open` for a URL)
and `Decline`. A Macro user tool the agent drafted (`SendEmail`, `CreateCalendarEvent`)
is kept simple: the header offers only its go-ahead (`Send email`, `Create event`) and the
arrow into the session, where the draft can be read, edited, or cancelled. Only the
session's owner gets the decisions; other viewers see a form's fields disabled and the
header reads who is being waited on.
Agent replies may contain mention chips (`<m-document-mention>`) that render like any
other channel mention. With GraphQL enabled, document mentions and preview cards load
in bounded batches, including task status/priority/assignees and the viewer's edit
permission. Task badges can appear with the initial preview rather than waiting for
separate properties/document-metadata requests; cached titles may appear first while
those edges load. Ordinary document/task mentions do not wait for the built-in skills
list. Built-in skill mentions retain their non-document behavior.
The Magic Chip that streams the agent's reply stays inside the message column: long
thoughts, file paths, and unbreakable tokens wrap or truncate instead of expanding the
thread past the chat's right edge.

## Message scrolling and navigation

Channels open at the latest message, with short conversations aligned above the
composer. Incoming messages and growing replies stay in view while the channel is
at the bottom. Consecutive sends stay pinned through server acknowledgement and
composer resizing, without bouncing upward between messages.
Scrolling up more than 1px leaves the viewport on the history being read, even
when only slightly above the bottom. Composer and viewport resizing respect the
same boundary. Returning to the bottom resumes following; loading older messages
preserves the reading position.

Message and reply links reveal the target inside its thread. Keyboard message
navigation scrolls only when the selected message is outside the usable viewport.
Returning through split navigation restores the saved message position and expanded
threads. Switching channel tabs currently opens Messages at latest. The `Scroll to bottom` control appears when scrolling down through history;
it returns to the latest page even after opening a link into old history.
The jump waits for that page to reach the rendered list.
A newer message navigation cancels a pending jump to latest. Scrolling manually
or choosing another destination also cancels the initial target's delayed fallback.
A touch tap leaves pending navigation intact; a vertical finger drag cancels it.

The `[data-channel-scroll]` element is the scroll surface. Its virtualized rows are
keyed by message ID; offscreen rows are normally absent from the DOM.

## Channel tabs

Radio group at the top of the channel pane: `Messages` / `Attachments` / `Participants`,
plus a `Call` button. Clicking the radio input can time out — click the adjacent label text
instead.

`Participants` tab:
- `Copy invite link`, participant search box.
- Add: combobox `name@company.com` + `Add Participant` button.
- Each row: `<name> Member|Owner` with a `Remove participant` button (owner shows
  `Cannot remove participant`, disabled).
- Team access: `Team channel` switch (disabled until you belong to a team).
- Bots: `New bot`, `Search existing bots…` combobox, `Invite bot` — webhook-powered channel
  participants.

## Onboarding channel

New users get `Macro Support x <name>` seeded with a welcome message that @mentions them —
useful as a guaranteed-existing channel in tests.
