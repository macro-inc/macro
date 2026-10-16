# Home

## Home (desktop) / Notifications (mobile) — `/app/home`

Touch devices render the Inbox as **Notifications**: a floating Signal/Noise
pill strip with a leading filter drawer (Status and Type), pull-to-refresh,
and swipe-left to mark done. On touch, Signal is a pure notification feed — the viewer's own
touched-by-me recents are not merged in; that merge is desktop Home's Signal
only, so sent mail and AI chats without notifications appear only on desktop.

On a cold launch, notification transport follows the GraphQL Soup flag reactively:
if the flag arrives after REST starts, the GraphQL notification query must actually
start too. Verify a reload with delayed flags retains non-email notifications once
loading settles, including when the list itself uses REST (notified-at sorting).
Email alone is not sufficient verification: its inbox membership does not require
the global notification feed.

Check live Home recency with two accounts: leave the recipient on Home without
opening the conversation, then send a DM from the other account. The row should
move into **Last few minutes** and show unread without reloading, including when
notifications use GraphQL but Home's notified-at list uses REST. Read the DM,
return to Home, and repeat; also check a row previously marked done and a thread
reply. Delay the Home list response while allowing single-entity hydration to
finish: hydration must not cancel the list refresh or leave an old notification
timestamp. Older in-flight snapshots must not move the delivered row backward.
Also test a stale response that entirely omits a just-restored, previously done
row: the row must stay visible. Marking it done again must override that restore,
and other filter scopes must not inherit the retained membership.

GraphQL-attached notification rows share the global feed's local seen/done
overrides: Mark Done and Undo reflect local intent without waiting for an older
cached notification snapshot to be replaced. These display overrides do not turn
incomplete predicate-index facts into authoritative membership evidence.

On desktop with the new app views enabled, Home defaults to a Signal feed merging
notifications with Activity's `touched_by_me` recents, including sent emails and
AI chats. Recent emails must be classified as Signal by the server; touching a
Noise email must not bring it into Home, including through local search. Verify
that a recently viewed Noise email stays absent while a Signal email and recent
chat remain visible, and that loading older rows still works through pages of
Noise-only email activity. Each entity appears once, ordered by its latest
notification or own action. On desktop, the funnel button to the right of **Home**
opens **Filter Home**.

With the GraphQL Soup flag on, desktop Signal reads
the server work feed (`user.workFeed` plus the `workFeedUpdates` subscription)
instead of merging sources in the browser; Noise, search, and touch devices keep
the merged feed. Verify these against a backend that serves the work feed: a
document you edited with no notifications appears read and offers no **Mark Done**.
**Mark Done** clears a row's notifications (and archives an inbox email): a row
that is only notifications leaves and stays gone after a reload, while a row you
also worked on stays, read, at the time of your own work. **Undo** brings a done
row back in place. A new comment on a months-old document appears at the top. With
two sessions of the same account, marking a row done in one removes it from the
other without reloading. A channel thread and its channel remain separate rows, and
completing the channel leaves the thread.
The menu shares the legacy compact submenus: **Status** offers **Unread**, **Read**,
and **All** as single-select radio items with a checkmark on the right of the selected
option, and **Type** contains the entity checkboxes. Status closes the menu
after selection; type selections leave it open. Press **f** to open the menu.
Entity type checkboxes start checked. Unchecking **Email** hides received
and sent mail. **Channels** controls
both channels and reply threads; **Chats** and **Agents** have separate toggles.
Unchecking every type shows an empty feed. **Reset filters** shows every type and
both read states again. A badge counts hidden types plus an active status filter.
Read status and type selections persist.
There are no desktop Signal/Noise tabs. A **Home** heading
labels the top left of the block, matching the **Email**, **Tasks**, **Chat**, and
**Agents** sidebar headings. The full-width **New chat** plus pill below the heading clears the preview and returns to the Home
starting pane; it does not create a chat. Email and Tasks have matching top pills
for **New email** and **New task**.

The Home provider honors an explicit initial tab, search, grouping, and facet
selection. Filters persist per user across reloads and fresh Home navigation;
split history restores that entry's filter selection. An explicit facet selection
overrides saved filters. Returning through split history resets navigation to Signal.

Channel thread replies remain separate Home entries from their parent channel,
using single-line rows and a reply arrow icon on desktop, labeled
with the sender and channel (for example, **Peter in #battlefield**). Channel names
prefer the current channel cache, then a matching thread notification's name,
then **Unknown channel** if neither source has a name. Selecting a
thread opens that thread in the channel preview; Shift-click opens it in a split.

Items in the 256px desktop rail use single-line pills with 16px icons: profile photos for
DMs and model logos for AI chats (Claude sunburst or ChatGPT knot). Other items
use the same glyphs as entity rows elsewhere: document file-type and
task/snippet/skill variants, hashes for channels, read/unread envelopes or
calendar invites for email, sparkles for agents, folders for projects, and alarms
for reminders. Pull requests retain open, merged, and closed status glyphs and
colors; unknown foreign sources use the generic file icon.
New agent-session rows always use a sparkle in the left slot, including while
working. A coding session adds a second line with repository, captured working
branch (when available), and PR number/status. Non-coding sessions stay on one
line. Their timestamps and unread dots stay visible. Missing repository metadata
is omitted.
Once `HIDE_AGENT_DM_SESSIONS` is enabled after the warm-marker rollout, agent
DM contexts stay out of broad Agents/Home lists, including work-feed and
notification-driven candidates. Prior notifications or activity must not bring
them back. The DM remains in Channels/DMs; authorized direct session links and
explicitly saved favorites still open their context. Verify this alongside an
ordinary standalone session, which remains listed.

The Agents workspace uses a single left dot for activity and unread state in
place of the sparkle. Opening a loaded session from Home or Agents marks its
notifications read after the viewing delay, including notifications arriving
while that session remains active.
Other Home items have no title tooltips, and their timestamps are
visible only while hovering the row. An unread
dot remains visible. Click a row to preview it; `j`/`k` navigate and update the
preview; alternate activation and Shift-click open a split.

On desktop, before selecting a row, the main pane shows a centered single-line chat
composer under “What should we get done in Macro?”. Attachment, text, model, and
send controls share one row; longer prompts expand the input as needed.
Home uses the shared app font and composer theme tokens; suggestion text and
hover states use the same semantic colors as other app surfaces.
Type in “Type @ to reference / for skills”, use the attachment button for
attachments and the model menu to choose a model, then press Enter or Send to
create and open an AI chat. If chat creation fails, the submitted text and attachments
are restored, including before a chat-limit paywall opens. With agents disabled,
the input stays 32px above the vertical center as suggestions load. With agents
enabled, the composer uses the same topbar offset and 24/64 padding as the
Agents new-conversation page so the two inputs share a baseline; suggestions
still load below it without moving the input. Up to three cached AI
suggestions appear below the
composer, using the existing fast/smart recommendation projections. Compact rows
use one line: reason — Phosphor icon and item name, followed by Open, all at the same font size. Clicking a
suggestion fills the input and replaces its context attachments without sending;
the Open action opens its source item in a new split, preserving the editor type
for tasks, skills, snippets, and other documents. Suggestion loading/errors
are isolated from the input. If generation stalls for 45 seconds, the shimmer
is replaced with a retry action; a late result still appears automatically.
Generation status updates do not extend that deadline. Retry starts a fresh
45-second wait. Shift+Enter adds a line. Selecting a Home row replaces
the composer with its preview. Home uses the shared 256px sidebar and collapses
navigation below 720px. The hamburger or `Cmd+.` opens the full feed as a
slide-over. Activating a row or **New chat** closes that overlay to show content;
arrow-key browsing keeps it open. Preview headers start with **Home >**. Clicking
**Home** clears the preview and returns to the starting pane without changing
sidebar visibility. Use the hamburger to reopen the feed. Mobile continues to
show the activity list alone.

Document previews opened from Home expose **Share** and **Copy Share Link** before
the details toggle, including tasks, snippets, skills, canvases, PDFs, images,
code, and videos. Share uses the selected item's permissions and updates when
switching items; copied links point to the entity rather than the Home feed.

AI chat, agent, and channel message bodies use 15px text, including thread replies.
Desktop AI chats, agents, and channel composers share Home's rounded composer
surface: a muted dark fill or a white light-mode surface with a soft shadow,
15px input text, and circular controls. Composer geometry is scaled to 15/16
of the original design (48.75px single-line height); the Home composer is at most
720px wide. In narrower desktop splits, the Home heading wraps and the composer
shrinks to the available pane width; suggestion text truncates while Open stays
visible. Plain channel messages use a compact row;
multiline messages, formatting, and attachments retain a full-width editor and
footer. Switching between compact and expanded layouts keeps the same editor and
draft. Mobile composer styling and send behavior are unchanged.

Sections are Last few minutes (under five minutes), Last hour, This evening
(6pm onward), This afternoon (noon–6pm), This morning (6am–noon), Earlier today,
Yesterday, and the existing older-date groups. Sections always follow this order,
with newest rows first and entity identity breaking equal-timestamp ties.
The reference clock uses whole minutes, so refreshing within the same minute
preserves grouping. Rolling five-minute/hour windows continue across midnight;
future timestamps caused by clock skew stay in the newest section, and invalid
dates go last. Calendar sections use local time. The clock is checked every 30
seconds without a new action. Scrolling near the bottom automatically
loads older items. Home buffers older rows until both notification and own-activity
pages have loaded through their timestamp, then advances the shallower feed first.
Fetched rows still advance this boundary when display filters hide them;
older cache-only rows do not.
Rows tied at a page boundary appear together, so loading another page does not
insert older history above already displayed rows. Live actions and refreshes
can still reorder rows. Short or fully filtered pages continue loading until the list
fills or there are no more results. A failed
source shows a retry notice while the other source stays usable. Document typing
starts an Edited activity for that editing session. Human edits
are attributed to the signed-in editor; agent edits retain their agent attribution.

Calendar reminder rows use the reminder delivery time for Home's date section,
including on a cold GraphQL load with notification sorting disabled. Verify that
an older reminder stays in its older section after the event's metadata syncs;
opening its details should show the expected occurrence. A newer reminder or your
own later activity can move the row forward, but a calendar sync alone should not.

On mobile, the dock and search scope use the bell icon and **Notifications**
label; Home is desktop-only. Notifications has no merged own-activity feed or
chat starting pane. Opening a row navigates to its entity. On iOS, rows fade
underneath the filters and status bar using the shared top edge gradient.

Notifications have three lifecycle states: `unseen`, `seen`, and `done`. Active means
unseen or seen. Viewing must not reopen a done notification; undoing done (`Ctrl+Z`
or `⌘Z`) returns it to seen, not unseen. The row returns to the active inbox without
an unread badge. Applying the active Inbox preset preserves read/unread selections:
read (`seen` or `done`) narrows to `seen`, not to all active states. Email read/unread
is separate from notification lifecycle state.

Agent sessions notify through the same inbox. `<bot> finished <session>` goes to the
owner and everyone who has prompted or answered in that session when a turn ends with
nothing queued; `<bot> needs your answer in <session>` goes to the same people when the
agent stops to ask (anyone with edit access may answer); `<user> mentioned you in <session>`
goes to users @-mentioned in a prompt - when the author can edit the session, the mention
grants them edit access first, so the link leads somewhere they can act. All three are
filed under the session itself: the inbox shows an agent-session row (agent icon, session
name, the bot or mentioner as sender, the excerpt or question as the body) and clicking it
opens the session. They are
not retracted automatically yet: answering the question or starting the next turn leaves
the earlier notification until you mark it done. The chip announcement post itself no
longer notifies the thread. Settings → notifications lists them under `AI`.

## Home — `/app/component/home`

Greeting, example prompt buttons (`Draft a document`, `Draft an email`,
`Search & research`), and the ubiquitous `Ask AI` composer. Finishing onboarding
without a deep link lands here. The retired Getting Started page's old
`/app/getting-started` and `/app/component/getting-started` links also open Home.

On phones, shared confirmations (including Remove Member and Cancel Invitation)
use a glass sheet with a title, description, Close confirmation button, and
side-by-side cancel and confirm actions. Pending actions disable both buttons
and prevent dismissal; canceling leaves the underlying data unchanged.
