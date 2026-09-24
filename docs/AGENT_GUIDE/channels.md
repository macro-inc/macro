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

## Agent session entities

The Agents list includes owned and shared sessions. Rows show the shared agent
icon and session title; opening one navigates to `/app/agent/<id>`. The session title
menu uses the shared entity actions: Favorite/Unfavorite and Copy link, plus
Rename and Delete for the owner. Rename uses the shared rename dialog, not a
session-specific modal. Folder moves, duplication, and property/tag editing are
not offered because those APIs do not support sessions. Runtime controls remain
session-specific.

A session transcript shows each tool call as a collapsible row (consecutive calls
fold into a `Called N tools` group; click it to see the rows). A tool reached over
an MCP server - Macro's own (`ReadContent · macro`) from a Cursor, Claude, or
Codex session, or a third-party server (`ask_question · deepwiki`) - is titled by
the tool's name with the server as its subtitle, never by the harness's dispatcher
(`mcp`). Clicking the row expands the exchange: a `Request` section with the
tool's own arguments and a `Response` section with what it returned, both as
syntax-lit, pretty-printed JSON (prose results show as text), each with a copy
button that copies the whole section; a call that failed is faded, shows the
error as its subtitle, and adds an `Error` section. Rows for a call still running
show whatever has arrived so far.

## Reading channel attachments through MCP

When an agent reads a channel through Macro MCP, `ReadChannelMessages`,
`ReadChannelThread`, and `ReadChannelMessageContext` include download URLs for
image and video attachments, including attachments in replies and previews.
Up to eight distinct images per response are also returned as inline images.
Videos are linked for inspection with a video-capable tool. If an image cannot
be loaded or exceeds the inline limit, its URL remains available. To check this,
ask the agent to inspect an image on a channel message and a video on a reply;
verify that its tool response includes the matching attachment URLs.

## Message composer

Channel messages and thread replies have a microphone next to Send, including
the collapsed composer. It uses the same OpenAI Whisper dictation and scrolling
volume timeline as AI chat. **Use dictation** appends text to the draft without
sending; **Cancel dictation** or Escape preserves the existing draft. Sending
is blocked during dictation, including keyboard and external send actions.
When local recognition is unavailable, confirming uploads the in-memory audio
to Whisper. This fallback is available on all plans without consuming chat credits.
Browsers without microphone recording show a disabled button.
The first click downloads a language pack when needed; click again to record.

Composer and conversation body text use `text-base` (15px at the default root
size) on desktop and mobile. The shared scale uses 14px for `text-sm` and 12px
for `text-xs`, with accessibility text scaling preserved.

Desktop message text uses a 16px horizontal inset and a compact gap above the
toolbar, consistent at narrow and wide composer widths.

The new-message compose screen and channel message/reply inputs use the same
attachment and send controls on mobile and desktop, with no format toggle.
iOS uses the native media attachment picker.
Short top-level drafts place attachment, message text, and send on one row on
both mobile and desktop. Text that wraps onto a second line, explicit line
breaks, non-paragraph blocks (lists, blockquotes, headings, etc.), and attachments
expand the composer with its actions below the editor. Even a short or empty
non-paragraph block uses the expanded layout; converting it back to a single
short paragraph restores the compact layout. A restored block draft that becomes a
wrapping paragraph should stay expanded without briefly collapsing; check this
after reopening the channel with a draft already saved. Open reply composers always place the editor
above the action row, including for empty and single-line drafts, so the
attachment, delete-reply, and send controls have their own space.
Attachment controls use a paperclip in both expanded and collapsed composers,
including the iOS media picker. Input action and formatting buttons show the
app tooltip without a second native browser tooltip.
When checking this transition, type a long draft without pressing Enter, then
shorten it and resize the pane. It should expand when the text no longer fits
beside the buttons and collapse when it fits again, without flickering between
layouts. Also add and remove a line break or attachment and
confirm the draft and caret position survive. The attachment and send controls
should remain usable in both layouts. Existing message and reply edit inputs show
only the send control, with no format or discard button; Escape cancels the edit.
The iOS share sheet keeps its editor above the attachment and formatting controls.
Check this arrangement at both phone and tablet widths.

The shared `@` menu also offers `Recent agent sessions` after Channels and
before Companies (the latest 500 accessible sessions, searchable by title or
persona). These inline chips show the shared
agent icon and an underlined session name, and open the existing session when clicked.
They are references, not bot invocations: selecting a session does not start a new
agent run. Sending or editing a message that references a session you own grants
that channel/DM edit access to it. Non-owner references do not create grants.
Access follows active membership; deleting the reference does not revoke the
grant. Inaccessible sessions render a private/deleted label. Chips omit persona
avatars and status; previews refresh periodically while the browser tab is active
to update titles and access.

Placeholder `Type @ to share with #<name>`. Click it, `type_text`, press Enter to send.
The message renders immediately with avatar, email, timestamp. Composer extras: `Attach
files` and the `Send message` button. Replies also include a close-reply control.

Hover a message for its action menu. `Reply` on a top-level message opens that thread. On
an existing thread reply, it inserts a one-line reply-target reference into the composer;
clicking the reference navigates back to that reply. References to the current
channel navigate in place, including inside the preview panel, without opening
another split. If text in the message is
browser-selected before `Reply` is clicked, the reference previews only the selected text.
Clicking `Reply` again for a message already referenced anywhere in the draft keeps
the existing reference and draft unchanged, even if a different text selection is used.
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
bot asks before scheduling a specific clock time. `@macro-new` / `@coder` / `@cursor` / `@codex` / `@claude` open
an agent session; follow-up
`@` mentions of that bot in the same thread route to it.
A follow-up sent while that session is still working stops the current turn,
posts a new Magic Chip on the follow-up message, and steers the agent with
that text — the chip appears at the follow-up, not after the cancelled turn
finishes.
The reply renders a Magic Chip: a rounded card of constant height that is present
from the moment the session boots. Its header names the persona (`Macro Agent`,
`Cursor Agent`), the model, and what the turn is doing (`Booting agent`, `Running
command · cargo test`, `Waiting for you`, `Done`); clicking the header or its arrow
(`Open in session`) opens the agent session. The area under the header holds the agent's
latest passage: a pulsing star while the agent is busy before it writes, the passage as it
streams, and the final passage once the turn ends - the last text the agent wrote, not the
whole turn, and a finished turn with nothing said leaves the area empty. The area is
cropped at the chip's height with a fade at its foot; clicking it expands it in place, and
clicking again collapses it. Before anything is there to expand, clicking the area also
opens the session.

`@codex` and `@claude` are offered to every user before account setup. The built-in
`@cursor` entry requires the `enable-cursor-agents` rollout flag (local override:
`VITE_ENABLE_CURSOR_AGENTS`). Custom agents keep their channel visibility rules
regardless of which harness they use.
A mention without a connected account creates no session and replies in the thread
with a **Connect Cursor**, **Connect Codex**, or **Connect Claude** chip. Each chip
opens Settings → Harness, where all three connection cards are visible. The same
chip reads **connected** after setup; mention the bot again to start a session.
Codex also prompts for a cloud environment when ChatGPT is connected but no
environment has been saved. New sessions use that environment on
`main`; there is no automatic repository selection. Follow-up mentions continue the same agent session. When
the provider URL arrives, the session header offers **Open in Codex**. Codex
assistant text appears as complete messages while tool activity and thinking
can continue updating during the turn. Mention
eligibility is covered by component/query tests; the channel interaction requires
a configured backend for end-to-end verification.

Within the Cursor rollout, `@cursor` is offered whether connected or not. A mention from someone with
no Cursor API key opens no session: the Cursor bot replies in the thread that
`@cursor` runs on their own account and is not connected yet, followed by a
**Connect Cursor** chip. Clicking the chip opens Settings → Harness; once a key
is saved the same chip reads **Cursor connected** and stops navigating. The
original mention is not replayed - mention `@cursor` again after connecting.

Cursor sessions choose a repository from the mentioning user's linked GitHub App
installations on their first prompt. A session without a repository can still use
Macro and connected MCP tools, but cannot use the Git proxy. For a PR smoke test,
link the GitHub account and App installation in the same environment first, then
name the repository explicitly in a new session's prompt.

PR status in an open Magic Chip updates from connection-gateway events after
webhook sync. Reconnecting refreshes active PR lookups to recover missed updates.
A late webhook does not require reloading the page.

When the agent requests permission, the Magic Chip replaces its loading state
with the action and `Allow once`, `Deny`, and `More options` controls. Permission
requests and questions share the chip's pending-interaction state and apply only
to its anchored turn. Session editors and owners can answer directly in the chip;
viewers and commenters see a waiting notice. Answering clears the request in both
the chip and the open session, and the chip follows the agent's next activity.

Coding agents use `macro_internal.set_pull_request` to register an existing or
new GitHub PR with their session. Macro Internal MCP is hosted by the harness
service at `/mcp/internal` on its egress listener, separately from workspace MCP.
Cursor, sandbox, and macrod sessions receive session-scoped credentials; the
model supplies only the URL. The tool records the link, not the GitHub PR itself.
The shared Macro system instructions ask agents to register PRs when
`macro_internal.set_pull_request` is available. Macro Internal MCP also advertises
this guidance in its server instructions. It is not prepended to individual user
messages. Cursor
enables automatic PR creation when a repository is selected. Its returned URL
is also recorded because
automatic creation can finish after the agent stops. Repeated registration is
idempotent. The PR URL is stored on the session row, independently of conversation
history. Registration sends a session-update gateway notification so mounted
chips reload the current link; reconnecting also refreshes it. Multiple chips
for the same session share its metadata, and loading it leaves the surrounding
editor visible.

When Cursor or Codex reports a pull request, the chip header shows its GitHub
link. Codex links can arrive after the assistant finishes; a session-update event
refreshes mounted chips without a new conversation message. Codex checks provider
PR metadata every 20 seconds while attached. Viewing a disconnected Codex session
reads saved history; sending a message reattaches the runtime. Refresh requires its original
ChatGPT connection to remain connected. The link remains
usable while the webhook mapping is loading or absent, then becomes a Macro PR
entity link once synced. On narrow chips, long PR names truncate with an
ellipsis; hover the link to inspect the full title. Codex delayed-link discovery,
duplicate and changed metadata updates, and opening the exact PR URL were verified
in Chromium with mocked session snapshots and realtime invalidation. This UI check
does not prove live provider discovery; backend tests separately cover delayed
provider metadata.

When the agent stops to ask a question the question takes the area in the passage's
place, cropped and expandable the same way: the prompt, then what is asked - a form's
fields (choice rows with an accent box, an `Other` row when the agent allows a free-text
answer, text and number inputs, a yes/no), a URL request's host and address, or a Macro
user tool's draft (`SendEmail`, `CreateCalendarEvent`) in the tool's own composer - the
same email compose or calendar event form the session shows, editable in place; expand
the area to reach its `Send`/`Create`, which answers with the edited draft. A row at the
bottom of the area carries the other decisions, refusal first: `Dismiss · Open in session`
for a tool draft, `Decline · Submit · Open in session` (or `Open` for a URL) for a question.
Only the session's owner can act; other viewers see the question read-only and the header
names who is being waited on. Once answered, the area shows the agent's passage again.
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

On Safari and iOS, open or navigate near the oldest loaded messages and allow the
history buffer to fill, then flick into older history. Loading should stop once
roughly six screens are available above the viewport and resume as you approach
that buffer. Check that pagination retains the visible message, and that latest
stays pinned when messages arrive, images load, or the composer resizes. Verify
message/reply navigation, restoration, and the custom scrollbar after pagination.
Very long flings or slow responses can still exhaust the available scroll range.

Inline document mentions should show their stored title before entering the viewport
and while preview requests are pending. With a slow preview response, check that a
long, unchanged title retains its line wrapping as the preview loads; a renamed
document should update to its fetched title afterward.

Message and reply links reveal the target inside its thread. Keyboard message
navigation scrolls only when the selected message is outside the usable viewport.
With a message selected, `E` edits your own message and does nothing on someone
else's message. Check both root messages and thread replies from a Home split:
an incoming selection must not mark the Home item done or edit the thread root.
Press `Escape` to clear selection; the parent Home shortcut is then available
again. Typing `e` in the composer or inline editor should still enter text.
Returning through split navigation restores the saved message position and expanded
threads. Switching channel tabs currently opens Messages at latest. The `Scroll to bottom` control appears when scrolling down through history;
it returns to the latest page even after opening a link into old history.
The jump waits for that page to reach the rendered list.
A newer message navigation cancels a pending jump to latest. Scrolling manually
or choosing another destination also cancels the initial target's delayed fallback.
A touch tap leaves pending navigation intact; a vertical finger drag cancels it.

The `[data-channel-scroll]` element is the scroll surface. Its virtualized rows are
keyed by message ID; offscreen rows are normally absent from the DOM.

On a cold channel open, verify that delayed bot/agent mention requests leave the
messages and composer visible. Expand a thread while its replies are still
loading: existing preview replies should remain visible until the full list
arrives. Repeat after reopening the channel to cover both cold and cached data.

Channel messages, thread replies, reactions, edits, deletions, and typing go
through the shared message API at `GET|POST /dss/messages/channel/<id>` and its
`items`, `threads`, and `typing` subroutes; the `/dss/channels/<id>/message*`
routes are no longer called by the web app. Live updates arrive as one
`message_update` websocket payload per committed change (`posted`, `edited`,
`message_deleted`, `reaction_changed`, `thread_updated`, `typing`); the older
`comms_message`, `comms_reaction`, `comms_attachment`, and `comms_typing`
frames are ignored. Documents share the same client, cache, and components
behind `enable-unified-document-discussions` (see documents.md).

Reopening a channel already loaded this session requests
`GET /dss/messages/channel/<id>?selection=<cursor of the newest cached root, direction newer, limit 50>`
and merges the result into the cached first page. A first open, a message link,
a channel cached away from its latest page, and a delta longer than one page load
the latest page with the default selection. The `channel_messages_load` event
records `path` (`catch_up` or `full`) and `reason`
(`watermark`, `list_ahead`, `no_cache`, `cache_not_at_latest`, `load_around`,
`delta_overflow`, or `catch_up_error`).

## Chat navigation rail

Following a channel mention or browser notification for the conversation already
shown in Chat activates that workspace and jumps to the targeted message or reply. It keeps
the existing preview and does not show a **Content already open** toast. The
same applies to a channel preview in Home; a closed channel opens normally.

The title bar's **Hide navigation** control hides the whole rail. Reopen it with
**Show navigation** (the hamburger) immediately before the conversation title,
or in the Chat header when no conversation is selected. Chat remembers this
choice independently of other workspaces and restores it after reload. Chat uses
the shared 256px default sidebar width and resize limits. In splits narrower than
720px, navigation collapses; the hamburger or `Cmd+.` opens it as a slide-over
with the same full sidebar contents. There is no separate skinny sidebar mode.

On desktop, the Chat rail has `All` and `Recent` tabs. All contains an
optional `Favorites` section and the
independently paginated `Channels` and `DMs` sections. Favorites appears when
the user has channel favorites and only lists channels. Channel favorites open
in the channel preview. Shift-clicking a favorite, channel, or DM opens that
conversation in a new split instead.

### Channel labels

Channel labels require the `enable-channel-tags` feature flag. The flag is off
until explicitly enabled, including in development. For a local frontend,
`VITE_ENABLE_CHANNEL_TAGS=true` enables it and `VITE_ENABLE_CHANNEL_TAGS=false`
forces it off; restart the frontend after changing the environment override.

With the flag off, Channels remains a flat list in its selected sort order.
The heading's `+` creates a channel directly. Label headings, creation dialogs,
channel-menu label actions, and label drag targets are absent, and the app makes
no channel-label list or smart-label preview requests. Existing saved labels
remain unchanged and reappear when the flag is enabled.

Even with the flag enabled, the heading keeps the direct `Create channel`
action while labels are loading or unavailable. It shows the label creation
menu only after the label list loads successfully; it never advertises disabled
`New label` or `New smart label` actions. Changing the rollout flag to off also
removes open label menus and dismisses label dialogs without reloading Chat.

Verify both states after reloading Chat: with the flag off, inspect the heading
action and a channel's context menu, drag between channel rows, and confirm
there are no `/channel-labels` requests. With the flag enabled, verify the `+`
menu offers `New channel`, `New label`, and `New smart label`; open each label
dialog and cancel to check the controls without changing shared data. The
creation, assignment, and persistence checks below require the label backend
and an account where those changes are safe.

Labels group channels inside the `Channels` section. Team members share the
same labels and can create, rename, delete, or move their channels between them.
Users without a team have labels private to their account. The naming and delete
dialogs explain which scope applies. Collapse/expand state is per user.
Every label remains visible, including empty labels; only team channels the
viewer actively participates in are shown inside it. Shared labels accept only
channels belonging to the label's team. Private account labels also accept only
team channels. Public channels, private channels, and direct messages cannot be
labelled. They keep their normal navigation, have no label menu actions, and
cannot be dragged into labels. Existing ineligible assignments no longer group
channels, including non-team channels and other teams' channels in shared labels.
Names are unique within the team or account, case-insensitively.

Layout: labels come first in creation order, each showing its visible channels
A→Z, followed by ungrouped channels in the section's selected sort order. A label
row has an unread count, a `···` menu (`Rename`, `Mark all as read`, `Delete label`), and a disclosure caret.
Clicking the row or pressing Enter toggles it; `h` / `l` on a label or one of its
channels collapses or expands that label. `[` / `]` jump between section headings.

Creating: use the `Channels` heading's `+` → `New label`, including when the
account has no team. The name field receives focus on opening and reopening.
Enter or `Create label` saves; Escape or Cancel dismisses without saving.
The dialog stays open while saving and shows a failure inline, preserving the
name for a retry. A successful empty label appears immediately and survives
reload. Rename uses the same dialog prefilled. Delete asks for confirmation;
its button says `Delete for everyone` for shared labels and `Delete label` for
private ones. Channels remain accessible after deleting their label.

Moving: right-click a team channel for `Add to label` / `Move to label`, including a
`New label…` option, or use `Ungroup from “<label>”`. Drag a channel onto a label
heading or one of its channels to move in. Drag a grouped channel onto a plain
team channel, the Channels heading, or empty space below the list to ungroup it.
Dragging one ungrouped team channel onto another opens a name dialog; saving creates
the label with both channels atomically. A failed save changes neither channel.
Dropping on the source channel or its current label does nothing; Escape from
the naming dialog leaves both channels unchanged.

For drag verification, start from the channel name and from different horizontal
positions in a row, then move across row boundaries and scroll the list. The
highlight follows the visible target under the pointer, with a whole group
highlighted when moving into it. A drag must not open a preview or reorder the
source. Check moves into collapsed and empty labels, ungrouping, cancellation,
and persistence after reload. Grouping in one Chat rail must not trigger a
second dialog in another rail. If the label service cannot be reached, the
UI reports the failure instead of claiming the group was saved.

Smart labels: use `Channels` → `+` → `New smart label`. Enter a label name and a
`Name contains` pattern. Matching ignores capitalization and treats punctuation
literally; it does not use wildcards or regular expressions. The creation dialog
shows up to five matching channels as you type, followed by `+N more channels
matched` for overflow. Empty patterns cannot be saved; a valid pattern with no
current matches can be saved for future channels. Only team channels you
participate in are matched; shared labels match channels from their own team.
Public channels, private channels, and direct messages are excluded from both
the preview and saved results.

Group headings have no icon in the sidebar; smart label creation uses a filter
icon. Channels appear in every matching smart label and keep any manual label
assignment. A channel in any smart label is excluded
from the ungrouped list, even when its matching labels are collapsed. Membership
follows channel names automatically. Existing matches update with live name
changes; new shared-label matches and unloaded channels refresh periodically.
Use the heading's `···` →
`Edit smart label` to change the name or pattern and preview the new matches.
Smart labels cannot be drag targets or manually assigned through `Move to label`.
Deleting a smart label preserves channels, other labels, and manual assignments.

Verify overlapping rules, collapsed labels, no matches, overflow, and quickly
changing patterns (an older response must not replace the latest preview).
Check public and private channels with matching names: they stay in the normal
list, have no label actions, and cannot be dragged into labels or used as a
second channel when grouping by drop. Team channels still support these actions.
Open the same matched channel from two labels and verify keyboard focus remains
on the chosen row. Check rule edits and persistence after reload.

If a restored Chat selection is already open in another view, its preview stays
closed but the saved selection is retained. Close the other view, then select
the conversation again or reopen Chat to restore its preview. Verify that an
unrelated rail preference change while blocked does not erase the saved selection.
While reading older history or composing in the preview, incoming notifications
(including ones for other channels) must not jump to latest, blank/refetch the
messages, or revoke composer focus. To check this, leave an unsent draft in a
preview scrolled into older history and deliver a notification. Selecting another
conversation or explicitly navigating to a message must still work.
The search action beside the tabs opens a search field below them and replaces
the active tab contents with matching channels and direct messages from one
activity-ordered source. Search results use compact rows on `All` and
conversation cards on `Recent`. Switching tabs preserves the active search and
query, then scrolls the results to the selected channel when present or to the
start. Closing search restores the active tab and applies the same scroll
behavior to its lists. An empty result uses the standard search empty state
artwork and wraps long queries.
Collapsing a section does not discard its loaded pages. Recent has its own
pagination cursor. Each list is virtualized, so offscreen conversations may not
exist in the DOM.
Channels and DMs each have a sort action before their create action. They can be
sorted by last viewed, last updated, or date created, and each choice persists
independently as a user preference.
Compact channel and DM rows in All have the same height. Section headings place
their caret immediately after the title and reveal it on hover or while the
section is collapsed; hovering only undims the heading text, while
keyboard-focusing the heading with Arrow keys or `j` / `k` gives it a background.
Clicking a section heading toggles it without moving the keyboard highlight;
keyboard activation still toggles the highlighted section.

Arrow Down / `j` at the last loaded conversation holds focus while that
section loads its next page. Once loading finishes, the next press advances
into the appended rows. If the section has no next page, navigation proceeds
to the next section. `[` and `]` jump between the visible Favorites,
Channels, and DMs section headers.

On touch layouts, the `Recent`, `Channels`, and `DMs` pill tabs each retain
their own loaded pages and load more as their active list approaches the end.
With `enable-graphql-soup` enabled, open an unread conversation from each tab
and return to the list: its top-level notifications should be read, including
ones older than the global notification feed's loaded page. Notifications for
separate thread stacks remain unread until that thread is opened.

With GraphQL enabled, the app-shell Chat badge uses `ChannelUnreadPresence`: only
channel IDs and at most one unread notification ID/state per channel, with a
500-channel candidate bound and no history, message previews, or metadata. It
shares the channel lists' refreshes after notification patches, mark-read, and
reconnect. Merely rendering that badge, subscribing to realtime notifications,
or applying local read/done overrides must not start the full `SoupNotifications`
feed. Check this with document-mention notifications disabled too (the production
default): mention cleanup must wait until a real data/status reader activates the
feed, then continue cleaning up loaded mentions. Full notification selection and
pagination remain unchanged. Automatic/debounced read markers log failures and
leave failed reads unread; they must not produce unhandled promise rejections or
block the separate email read marker. Cold bulk actions wait for loading
and report failures rather than treating pending data as an empty list. The
Inbox badge still uses its own full Soup query for channel/thread membership.

With GraphQL enabled, channel lists request at most one unread message notification
per channel through an aliased, filtered `notifications` edge. An empty edge means
no unread messages; invites and call notifications do not light the dot. Recent
cards still use the latest-message preview. Full notification edges load only for
an opened unread conversation, so mark-read and message targeting retain their
complete thread-scoped inputs. Reopening a conversation must refresh that full
edge even within 30 seconds; mark-read waits for the refresh rather than using
older cached notifications. Failed lookups and successful lookups with no matching
channel show **Conversation unavailable** with **Retry**, never permanent loading.
Retry rather than marking just the one unread witness. Repeated mobile taps must
open the last selected conversation, not a slower earlier request.

Check cached Home → Chat navigation, All/Recent/search, and unread state after a
read, a new notification, deletion, and reconnect. Cache reads remain asynchronous:
a brief spinner can still appear, but cached rows must not wait for a background
network refresh. Conversely, `cache-and-network` refreshes must start without
waiting for a busy cache worker. Successful foreground query results display
before cache persistence finishes; a delayed acknowledgement must not replay old
rows or overwrite an optimistic update. Check initial and continuation pages with
a slow cache, overlapping refreshes, and leaving/reopening Chat during a write.
A cache write failure must not discard successful network rows. Mutations and
cache-only hydration still wait for their durable/cache-projection work.
A late cache snapshot must not replace newer network rows. Check a cold offline
open too: a cache hit arriving
after the network failure must remain usable without erasing the refresh error.
If more unread notifications
remain, the limited edge must refresh to the next one rather than staying empty.
Refreshing unread indicators while composing must preserve the conversation,
scroll position, and input focus. The backend must support the new edge arguments
before deploying the frontend that requests them.

## Call lifecycle

The channel's call tab and floating call controls share one session. Repeated
Join clicks while connecting should produce one connection; leaving from either
control ends the same call. Navigate away and return while connected to check
that the call and its controls remain usable.

For recovery checks, keep another participant connected and briefly interrupt
the first participant's network. Recovery may rejoin that same live call. It
must not start a replacement call if the original ended, or rejoin after the
user chose Leave. A failed join must restore the Try again control even if
background cleanup is slow.

If another call prevents joining, the error should say to leave the current
call first. Trying to join another channel must keep the current call connected,
with its participants and controls intact. A restored live session must clear
any earlier join or recovery error. Failed Join, Call Again, and Leave actions must not produce unhandled
promise rejections.

On iOS, ending a call during connection must leave Join usable. If CallKit
restores or answers another call while an earlier join or leave finishes, the
controls must follow the current native call; finishing the old operation must
not restore the old call or remove the new call's end handler.
An empty native snapshot before the first media update must not cancel a new
join. Once native has reported the session, disconnecting or ending it must
cancel pending connection/recovery and allow a new join.
Cancelling after a token is issued must also remove server membership, even if
media has not connected yet. Repeated end events share that cleanup; a newer
native call must survive while cleanup for the cancelled attempt finishes.
Restore the same channel while transport cleanup is pending and check that no
server leave is sent for the restored session. Join must also accept a retry
during cancellation cleanup. If a server leave was already sent, the retry
shows Connecting and waits for that request before registering again.

## Channel tabs

Radio group at the top of the channel pane: `Messages` / `Attachments` / `Calls` / `Participants`,
plus `Ask Macro` and `Call` buttons. The `Calls` tab lists recordings for that channel
(same rows as the Calls soup view, filtered to this channel). The live `Call` tab
appears while a call is in progress. `Ask Macro` opens a new chat pane with the channel
already @mentioned as context (see ai-chat.md). On mobile it lives in the channel title's
`...` drawer instead. Clicking the radio input can time out — click the adjacent label text
instead.

`Calls` tab: recordings, transcriptions, and summaries for this channel. Click a
row to open the call. The search field above the list matches call names and
transcripts in this channel; queries shorter than 3 characters are not sent.
Empty copy: `No calls in this channel`. No matches: `No results for "…"`.
Shorter queries: `Keep typing to search`.

`Participants` tab:
- `Copy invite link`, participant search box.
- Add: combobox `name@company.com` + `Add Participant` button.
- Each row: `<name> Member|Owner` with a `Remove participant` button (owner shows
  `Cannot remove participant`, disabled).
- Team access: `Team channel` switch (disabled until you belong to a team).
- Bots: `New bot`, `Search existing bots…` combobox, `Invite bot` — webhook-powered channel
  participants.

## Incoming call ringing

For cross-tab ringing checks, sign the recipient into two tabs and start a call
from another account. Both tabs may show the incoming call; only one should play
the chime. Closing the audible tab lets the other take over while the call is
still ringing. Answering or dismissing stops ringing across tabs. An unanswered
call stops ringing after 30 seconds, including after a tab takes over.

## Onboarding channel

New users get `Macro Support x <name>` seeded with a welcome message that @mentions them —
useful as a guaranteed-existing channel in tests.

Locally sent channel messages and thread replies enter with a brief upward slide
and fade, without bubble scaling. Opening history or remounting a row does not
replay the effect. Reduced-motion preferences disable it.
Consecutive messages from the same sender should enter in their grouped layout,
without briefly showing an avatar/header and collapsing after acknowledgement.
Check this with a delayed send response in both the channel and a thread, sending
each follow-up within five minutes of a confirmed message with no replies.
Messages from different senders, including bot messages triggered by different
users, should retain separate headers.

For mobile send regressions, keep the software keyboard open and send several
short and multiline messages consecutively. The keyboard should remain open,
the cleared composer should retain focus, and a pinned chat should remain at the
bottom through composer resizing and server acknowledgement. Check that restoring
the caret after send does not pan the page while the keyboard resizes. Repeat with dictation
and check that sent text does not return. Scroll into history before an incoming
message or acknowledgement and verify that it does not pull you to latest.


## Channel pictures

Channels and group chats can have a custom picture. Any active participant can
`Rename` a named channel from the title menu. Direct messages cannot be renamed.
Only admins and owners also get `Set channel picture` and `Remove channel
picture`. Choose `Set channel picture` to add or replace a picture. Select a PNG, JPG,
WebP, or GIF up to 16 MB. The upload must finish before the picture is saved;
the server accepts only supported images uploaded by the person setting the
picture. An error leaves the previous picture in place. When a picture is set, the menu also offers
`Remove channel picture` to restore the standard channel icon. The picture
beside the title is display-only and also appears in shared channel rows.
Picture changes refresh other participants' open sessions, including after
reconnecting.
Members see the picture without editing controls. One-to-one direct messages
continue to show the other person's user picture.
