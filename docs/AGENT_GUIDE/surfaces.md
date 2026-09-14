# Other Surfaces

## Live updates in flat Soup lists

With browser GraphQL caching enabled, locally supported flat lists reconcile their
loaded server pages with matching cached entities. Complete matching updates can
appear without a list refetch; confirmed non-matches and explicit deletions disappear.
Rows whose current predicate facts are unknown retain their previous server membership
and sort evidence until hydration or a network refresh resolves them. Unrelated
notification-only cache records do not block other rows' updates. While recomputation
is pending, the last rendered result for the same query and cache generation stays
visible; local results do not trigger the tab-loading bar. A fresh server response
still replaces that result, and initial loads without usable data retain normal loading
indicators.

This is a best-effort display, not proof that every matching entity is cached. Outside
the supported cached-Mail slice below, loading more follows the original server cursors
and preserves already loaded pages.
Newly loaded server rows join the retained display immediately, without duplicates or
waiting for local recomputation to succeed. Removing pages from the server baseline
invalidates overlays built from those pages.
Changing filters or resetting the cache discards prior reconciliation evidence. Grouped
lists, unsupported filters/sorts, and native/non-cache transports keep their existing
network behavior.

For Documents (including Tasks), Projects, and Chats, exact `UNSEEN`/`SEEN`
notification filters also reconcile locally with created/updated timestamp sorts.
Marking a notification done removes only that notification's contribution immediately;
other active notifications can keep the entity in the list. Seen/reopen operations
update filter membership on the authoritative reply, not from a guessed optimistic
state. Rollback restores only the failed operation's contribution. `DONE` predicates,
other entity partitions, and notified-at sorting still use the network path.

Notification facts use the existing active-only GraphQL edge and primary entity
association. Missing/partial or over-budget snapshots remain incomplete, never an
empty notification set; display metadata decoding omissions remain a best-effort
limitation. The v4 projection tracks individual notification IDs, bounded by the
shared 256-fact per-entity budget. This cache-format upgrade resets old cached data
and pending cache mutations, and the bumped backfill checkpoint rebuilds projections.

Realtime Soup batches coalesce repeated entity IDs (including entity type), keeping
that entity's last operation in the batch. Emitted `SoupUpdated` items are non-null.
If viewer-scoped hydration finds no item, the backend logs and omits that update;
it does not imply deletion. Only explicit `GraphqlCacheDeletion` events remove records.

## Notifications — `/app/component/inbox`

Unified triage list (emails, channel messages, task assignments, doc mentions, agent
results). Tabs are `Signal` (default, AI-filtered "needs attention") and `Noise`, with a
Filter menu. On desktop, selecting a row renders its block in the inline preview beside
the notification sidebar. With the `enable-inbox-notified-sort` flag on, both tabs order
rows and date headers by when you were last notified about the item, so a fresh comment
on an old task sits under "Today"; with it off they order by content recency. Keyboard:
`j`/`k` move between rows and update the preview; alternate activation opens a new split.

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

## Tasks — `/app/component/tasks`

Task navigation uses `My Tasks`, `All Tasks`, and `Created by me`. The desktop
sidebar has a full-width `New task` action, a collapsible list of task favorites,
and a collapsible list of tags. Selecting a tag filters the current task view;
selecting it again clears that tag filter. Favorite rows open their tasks.

## Email — `/app/component/mail`

Full email client. Tabs: `Signal` / `Noise` / `Sent` / `Calendar` / `Drafts` / `Shared` /
`All`. Compose via the `Email` button (or `Create` → `Email E`). On a fresh local user it
shows `Connect your email` (Gmail/Google Workspace OAuth) — most functionality needs a
connected account. Search is `Ctrl+F` within the surface.

### Cached Mail filtering

With browser GraphQL caching enabled and the email metadata backfill synchronized,
All, Signal, Noise, Drafts, Sent, Calendar, and Shared support tab changes and new
filter combinations while offline: account selection
(including delegated inboxes), read/unread, and archive-based Done/Not Done. Mail Done
means `inboxVisible = false`; it is **not** notification lifecycle state. Signal/Noise
retain their Inbox scope, so archived mail is found using All + Done.

A `Showing cached mail` notice identifies results over synchronized metadata, not a
claim of complete mailbox coverage. These lists paginate locally beyond the first
page without a server cursor. Filter, revision, or engine-generation changes restart
the local page chain; online server results take over again when available. After
reconnecting, `Load more` follows the same server page chain as the displayed rows,
not a leftover local cursor. Account choices are cached in the viewer-scoped GraphQL catalog. Timestamp ordering and date
headers use the selected Mail view's indexed timestamps, not a preview cached from
another view. Drafts and Sent display their latest eligible message snapshot, even
when a newer normal message is the ALL preview; no message bodies are needed.
Sent also requires a canonical outbound timestamp. Trashed messages cannot supply
any preview. Calendar uses the authoritative thread calendar-attachment flag.

Shared requires a last-known thread grant through the viewer, a team, or an active
channel, plus the existing Mail UI rule excluding viewer-owned threads. Merely
having a different owner or a delegated inbox does not qualify. Shared metadata has
its own full-scan backfill before body hydration. A successful complete scan marks
old entries it did not return incomplete (not deleted); a failed or cancelled scan
preserves last-known evidence. If concurrent cache changes invalidate the prior
membership snapshot, hydration continues but that scan cannot revoke old evidence.
Interrupted Shared scans restart at the beginning so
scope reconciliation never mistakes a suffix for a full scan. Offline access is
necessarily evaluated from the last synchronized grants.

The lightweight metadata backfill runs before body hydration. Its refreshes scan all
metadata: message-time watermarks alone miss archive/read changes on old threads.
Filter availability therefore does not guarantee that opening every message body works offline. Missing
projection proof is unknown, never false. Sender/recipient, attachment chips,
property/tag refinements and non-created/updated sorts remain network-only or
existing client refinements; durable offline sending/archiving is not added by this slice. No cache-format wipe is required: Mail uses a separate versioned profile
and a new backfill checkpoint, preserving existing queued work. Deploy the backend
schema additions before the client: it selects canonical message eligibility/recency
fields, body-free canonical preview references, and viewer-relative share facts.
The `soup-mail-v2` profile and new backfill checkpoint rebuild Mail proof without
changing the persisted mutation queue format.

Threads open at `/app/email/<thread-id>`. Click a message header to expand or
collapse it; `Show N hidden messages` reveals the collapsed middle of a longer
conversation. A link with `?email_message_id=<message-id>` reveals that message.
Collapsed thread cards use a compact text snippet; expanding mounts the message
body and its attachments. On phones, messages form flat rows with horizontal
separators and 16px side gutters; collapsed previews show one line. Desktop
keeps the framed cards.
Replies appear inline on desktop and in a composer drawer on touch devices.
`R` and `Alt+R` (`Option+R` on macOS) open reply-all for the selected message,
or the latest message when none is selected. `F` opens a forward and focuses To.
While an editable field is focused, Escape is handled by that field before the
close-reply shortcut.
An edited reply remains a draft when navigating away and returning. Standalone
compose also flushes pending edits when leaving through app navigation. During
send or discard, its sender and scheduling controls cannot change the operation.
Attachments that can be opened are buttons named by their filename; Tab to one
and press Enter or Space. Removal is a separate button named `Remove <filename>`.
Removing a forwarded file keeps the received original.
AI email tool drafts persist body-only edits; changing recipients or the subject
is not required to save the body.
The three-dot button beneath a body reveals quoted content and a trimmed
signature. Plaintext and Macro Markdown use the existing Markdown renderer;
Macro Markdown messages retain document mentions. Ordinary HTML bodies use an
open shadow root: Playwright text locators can reach them, but a card's ordinary
`innerText` or `querySelector` does not traverse that root.

After a successful send, the `Email sent` notice offers `Undo`. Undo restores the
sent envelope and editable content, including when the reply used another inbox;
a slow background refresh must not keep the restored editor disabled. A rejected
send reports failure and restores its original reply editor if it is still mounted.
A failure from an older, unmounted editor must not overwrite a newer edited reply.
A presentation or refresh error after successful delivery is not a reason to send
again.

While a schedule change is pending, immediate send and further schedule changes
are disabled. Reply recipients cannot be edited or dragged during scheduling,
sending, or discarding. A failed schedule or unschedule keeps the last confirmed time.
If scheduling succeeds but marking the thread done fails, the email remains
scheduled and a notice explains the separate failure. Check the confirmed time
before retrying; do not treat that notice as a failed schedule.

With the new app views enabled, mobile and tablet Email use a floating, horizontally
scrolling row of those tabs, with `Open email filters` at the left. The rest of the
view is the email list, which scrolls beneath the header and supports pull to refresh
and swiping left to mark emails done in Signal and Noise. The filter button opens a
bottom drawer for status, done, attachment, calendar and tag filters, plus an `Inbox`
section when the user can pick one: `All inboxes` or a single address, never several.
`Clear all` resets those filters and the inbox selection. Desktop keeps its sidebar,
search field, filter menu and preview control. The sidebar lists the inboxes above the
tabs as plain rows; clicking one shows only that inbox, and the `+` beside
`All inboxes` (`Connect another account`) starts the add-inbox flow. Sidebar rows,
`New`, and the panel's back, forward and close controls act on primary-button
mousedown, so the selection changes before the click completes; a normal click
still works. The sidebar ends with a collapsible `Tags` section (every personal and
team tag, plus a `New tag` button): clicking a tag opens the `All` tab filtered to
threads carrying it, clicking it again clears it, and choosing any tab clears it like
the other filters.

## Search

Sidebar `Search` button → `/app/.../component/search` with a focused query box. Results
(including a `Featured Results` group) filter live as you type; no Enter needed. `Ctrl+K` is
usually faster for jump-to-entity; `/` opens workspace search when no editor is focused.

Agent-session results use the robot icon and show a highlighted transcript snippet.
`Show more [N]` expands additional matches, labeled **User / Agent · Turn N**.
Click a snippet to open `/app/agent/<uuid>` at that folded message; a plain row click
opens the first content match, or opens the session normally for a title-only hit. These are
ACP-backed sessions, distinct from legacy chat results. Legacy chat rename, delete,
copy, and move-to-folder actions are not offered on agent-session search rows.

## Files — `/app/component/documents`

Tabs `Owned` / `Shared` / `Attachments` / `Folders` / `All`; `New` menu; rows show title,
tags, updated time. Clicking a row opens the doc.

## Calendar — `/app/calendar/view`

Calendars default to Day on phones and Week on desktop. The selected view is
remembered locally on each device.

Calendar event creation and editing open in a bottom sheet on touch devices,
with scrollable content above the keyboard. Desktop retains the centered dialog.
Dismissing a changed event still asks before discarding the draft.

Week view with `New event`, `Choose calendar view` menu, prev/next week, `Search events`,
`Calendar settings`, and a mini month picker in the side panel. Events require connecting a
Google account (`Connect calendar`). The `Calendar settings` (gear) menu has an `Accounts`
section listing each connected account with a per-account `Enable` (grant calendar) or
`Turn off` action, plus `Connect another account` to connect a new Google account
(email + calendar).

The side panel's `Calendars` section folds each connected account into a collapsible
group: a caret plus the account address header with a checkbox that shows or hides all of
that account's calendars at once, and the account's calendars listed beneath it (color dot,
name, per-calendar checkbox). Subscribed system calendars (Google holidays, birthdays)
carry a small RSS icon. A calendar whose sync has been failing persistently carries a small
warning icon whose tooltip shows the provider error; the account keeps syncing its other
calendars and the badge clears on its own once that calendar syncs again.

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

With the `enable-calendar-team-ooo` flag on, teammates' Google Calendar out-of-office events
overlay the grid as read-only chips titled `<name>: <event title>`. The side panel's
`Team out of office` section (shown only when the user belongs to a team with other members)
has a checkbox in its header row toggling the whole overlay on or off — all teammates or
none — and lists the next 90 days of teammate absences; clicking a row navigates the grid to
that date. Coverage depends on each teammate having connected their own calendar and using
Google's out-of-office event type.

## Calls — `/app/component/calls`

Tabs `All` / `Missed` / `Unattended`; `Call` button to start one. Recordings, transcriptions
and summaries appear here; empty state notes "Calls are available to agents."

## Customers (CRM) — `/app/component/companies`

Board/List views, `Company` create button. Requires a team ("Join a team to enable CRM" →
`Open team settings`).

## Activity — `/app/component/activity`

GitHub-style actions heatmap (one a11y node per day — makes snapshots huge; prefer saving the
snapshot to a file), then a `Most active` section header (styled like the feed's day headers)
over a wrapping row of pill chips (entity icon, name, action count; click opens the entity,
shift-click opens a new split; the section is absent when there are no entities), then a feed
of "You edited/created X · 17h" entries grouped under day headers, with the compact relative
time (`17h`, `8d`, `1mo`) inline after a middot rather than right-aligned; hovering the time
shows the full date. Each row is a plain action glyph joined to its neighbours by a thin
connector line (the line stops at day headers) and never wraps: a long entity name truncates
with an ellipsis, and the full name is in the mention's hover preview. Consecutive same-actor,
same-entity, same-action events within a day read as one line with a count (`You edited Doc X
5 times · 2h`; property changes read the net change, `changed Status from A to C on Doc X · 3
changes · 2h`), so the row count is lower than the event count (`[data-activity-run-size]`
carries the fold size). The whole page is one virtualized list: only rows near the viewport
are in the DOM, and scrolling near the bottom fetches the next page automatically (a
`Loading…` tail appears while it lands). If a page fails, the tail reads `Couldn't load more.`
with a `Retry` button and automatic paging stops until it is pressed. There is no `Show more`
button.
Once the heatmap card scrolls away, the day header for the topmost visible row stays pinned at
the top of the list (`[data-activity-pinned-day]`, a non-interactive copy), so a snapshot taken
mid-scroll shows that label twice at most. The heatmap always shows the whole year, including
the partial first and current weeks, and spans the card at every width: in a wide pane the
space between week columns opens up, its cells shrink from 14px to 8px as the pane narrows, and
below that (a phone) the week area scrolls sideways with the month letters, opened on the newest
week and with no visible scrollbar. Under ~672px the four stats read as a two-column grid; under
~448px (a phone) the legend drops its `Fewer`/`More` words, each stat stacks its label over its
value, and chips shorten. Rows stay on one line at every width. On touch devices the list rests
below the floating page title and above the bottom toolbar.

## Home — `/app/component/home`

Greeting, getting-started checklist, example prompt buttons (`Draft a document`,
`Draft an email`, `Search & research`), and the ubiquitous `Ask AI` composer.

## Settings — `/app/settings/<section>`

Left nav: General → `Account` (profile, delete account), `API Keys` (create /
list / delete personal keys; the secret is shown only once and is sent as
`x-macro-user-api-key`), `Notifications`, `Billing`,
`Appearance`, `Mobile App`, `Shortcuts` (interactive keyboard visualization, not a list);
Workspace → `Team`, `Tags`, `CRM` (enable/disable; once enabled, a `Deal stages` section
with `Customize stages`, inline rename, reorder by drag handle or arrow keys (up/down
buttons on touch), delete, `Add stage`, `Reset to defaults`, and `Closed stages`
checkboxes, editable by the role set as `edit_stages_role`),
`Connections` (email/tool OAuth), `MCP server`
(setup snippets for Claude Code / Codex CLI / Claude.ai / ChatGPT / IDE), `Agents`, `Bots`, `Harness`;
`Log out`.
`Agents` lists team and private agents with `Create agent` / `Edit <name>` dialogs grouped
Profile, Behavior, Runtime, Connections, Channels, Share. Connections is a radio pair:
`Use my connected apps` (default; the agent gets whatever the person running it has
connected) or `Specific apps`, which reveals a `Search connectors` box over the whole
Pipedream catalog (results are `option` rows; picking one adds it) and a row per picked app
with a connected / not-connected dot for the *current viewer* plus an inline `Connect`
that opens the Pipedream Connect flow inside the dialog. Unconnected picks never block
saving; each teammate connects their own account. An agent session that calls a picked
but unconnected app gets a tool result saying so, and the agent's reply renders a
`Connect <app>` chip that opens Settings → Connections for that app.
`Back to app` returns to the previous surface. Open via user-email button menu or `Ctrl+;`.

`Agents` → `Create agent` (or edit an existing agent) opens runtime selectors.
The model list is loaded live and independently for In-memory, connected Cursor, and every
registered macrod harness. A harness can show `Loading models…`, an unsupported message, or
a retryable error without hiding the other harnesses. Editing preserves a saved model that
is no longer offered and labels it `saved, unavailable`. A macrod with no responding runtime
can remain loading until the 10-second discovery timeout; use Retry after reconnecting it.

`Harness` configures Cursor and paired macrod runtimes. Cursor's default-model picker uses
the same live model discovery and retains its existing save action.

## Notifications

Toast regions are labeled `Notifications (alt+T)`; five empty live regions always exist in
the a11y tree (ignore them when parsing snapshots).

Staff Noise emails still create in-app notification rows, but do not send a new-notification
event over GraphQL or the legacy WebSocket gateway, so they do not trigger browser popups.
Those rows are available on the next fetch/refetch. Signal delivery and the existing
staff/customer eligibility rules are unchanged; no browser eligibility request is needed.

Discussion composers on companies, contacts, documents, tasks, and PRs use the
shared channel/AI glass surface, 22px desktop corners, 15px desktop text, and
a circular neutral Send button. Document comment replies/edits and Edit with AI
use the same composer treatment. Attachment and formatting actions stay available.

On touch devices, an email thread's floating action bar has Previous email and
Next email arrows beside the larger Mark done checkmark. The arrows follow the
source list's filtered order, skip non-email items, and disable at its ends.
They do not wrap; a thread opened without a source list has disabled arrows.
Mark done archives the current thread and opens the next email in that same
filtered list, loading pages until another email is found or the list ends.
On native mobile, stepping replaces the current email while preserving the
filtered list behind it for swipe-back. This works with both the legacy mobile
list and the newer app views. To verify, open the first email from Signal or
Noise, tap Next and then Previous, and swipe back to the same filtered list.
Leaving the email cancels pending
navigation and archiving while a page loads. At the end it opens the previous
email; with no neighboring email it stays on the archived thread. Mark as not done
does not advance. Undo restores the archived email and returns to it.

The mobile reply/forward drawer uses matching circular glass buttons for
discard, attachments, and send, with the dock's button/icon sizing and regular
Phosphor icons. Send remains disabled until the draft is valid and shows a
spinner while sending.
