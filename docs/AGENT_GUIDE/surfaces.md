# Other Surfaces

## Live updates in flat Soup lists

With browser or native Tauri GraphQL caching enabled, locally supported flat lists reconcile their
loaded server pages with matching cached entities. Complete matching updates can
appear without a list refetch; confirmed non-matches and explicit deletions disappear.
Rows whose current predicate facts are unknown retain their previous server membership
and sort evidence until hydration or a network refresh resolves them. Unrelated
notification-only cache records do not block other rows' updates. While recomputation
is pending, the last rendered result for the same query and cache generation stays
visible; local results do not trigger the tab-loading bar. A fresh server response
still replaces that result, and initial loads without usable data retain normal loading
indicators. A transport failure does not hide usable current-query local results,
including empty results; HTTP responses and GraphQL errors still surface.

This is a best-effort display, not proof that every matching entity is cached. Outside
the supported cached-Mail slice below, loading more follows the original server cursors
and preserves already loaded pages.
Newly loaded server rows join the retained display immediately, without duplicates or
waiting for local recomputation to succeed. Removing pages from the server baseline
invalidates overlays built from those pages.
Changing filters or resetting the cache discards prior reconciliation evidence. Grouped
lists, unsupported filters/sorts, and non-cache transports keep their existing
network behavior.

For Documents (including Tasks), Projects, Chats, and participating Channels,
exact `UNSEEN`/`SEEN` notification filters also reconcile locally with
created/updated timestamp sorts.
Marking a notification done removes only that notification's contribution immediately;
other active notifications can keep the entity in the list. Seen/reopen operations
update filter membership on the authoritative reply, not from a guessed optimistic
state. Rollback restores only the failed operation's contribution. `DONE` predicates,
other entity partitions, and notified-at sorting still use the network path.

Channels use the same general Soup reconciliation path, not a separate local page
chain. Channel ID, type, team, organization, importance, and participant-scoped
filters operate over synchronized channel metadata. The default channel scope
requires active participation. Filters that widen to unjoined team channels,
message sender/mentions, and channel threads remain network-only. Missing channel
metadata or notification snapshots are unknown, not empty. The existing core
backfill checkpoint is refreshed to index channel rows; queued work is preserved.

Notification facts use the existing active-only GraphQL edge and primary entity
association. Missing/partial or over-budget snapshots remain incomplete, never an
empty notification set; display metadata decoding omissions remain a best-effort
limitation. The current `soup-flat-v5` projection retains notification IDs and
adds complete select-option/entity-reference property snapshots. Tags, task status,
priority and assignee selections compose with owner and type filters. The shared
256-fact per-entity budget still applies: missing, malformed or over-budget property
snapshots are unknown, never evidence of absence. Property-only mutations update
these postings atomically; rollback does not restore unrelated property values.
Checkpoint v14 rehydrates older projections without wiping normalized records or
queued mutations. General Soup still uses its existing server pagination; filter-only
offline checks use an ungrouped view with a created/updated timestamp sort.

Realtime Soup batches coalesce repeated entity IDs (including entity type), keeping
that entity's last operation in the batch. Emitted `SoupUpdated` items are non-null.
If viewer-scoped hydration finds no item, the backend logs and omits that update;
it does not imply deletion. Only explicit `GraphqlCacheDeletion` events remove records.

## Home — `/app/component/inbox`

With the new app views enabled, Home defaults to a Signal feed merging
notifications with Activity's `touched_by_me` recents, including sent emails and
AI chats. Each entity appears once, ordered by its latest notification or own
action. On desktop, the funnel button to the right of **Home** opens **Filter Home**.
The menu shares the legacy compact submenus: **Status** offers **Unread**, **Read**,
and **All**, and **Type** contains the entity checkboxes. Status closes the menu
after selection; type selections leave it open. Press **f** to open the menu.
Entity type checkboxes start checked. Unchecking **Email** hides received
and sent mail. **Channels** controls
both channels and reply threads; **Chats** and **Agents** have separate toggles.
Unchecking every type shows an empty feed. **Reset filters** shows every type and
both read states again. A badge counts hidden types plus an active status filter.
Read status and type selections persist. The mobile drawer offers the same
Status choices and type checkboxes.
There are no desktop Signal/Noise tabs. A **Home** heading
labels the top left of the block, matching the **Email**, **Tasks**, **Chat**, and
**Agents** sidebar headings. The full-width **New chat** plus pill below the heading clears the preview and returns to the Home
starting pane; it does not create a chat. Email and Tasks have matching top pills
for **New email** and **New task**.

The Inbox provider honors an explicit initial tab, search, grouping, and facet
selection. Filters persist per user across reloads and fresh Home navigation;
split history restores that entry's filter selection. An explicit facet selection
overrides saved filters. Returning through split history resets navigation to Signal.

Channel thread replies remain separate Home entries from their parent channel,
using single-line rows and a reply arrow icon on desktop and touch devices, labeled
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
There are no title tooltips, and timestamps are
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
are restored, including before a chat-limit paywall opens. The input stays 32px above the vertical center as suggestions load. Up to three cached AI
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
the composer with its preview. Mobile continues to show the activity list alone.

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
alone is not yet attributed by Activity; Home reflects the actions the existing
Activity system records.

On mobile, Signal/Noise tabs and filters float above the full-height scrolling list. On iOS, rows
fade underneath the filters and status bar using the shared top edge gradient.

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
Normal row and favorite activation replaces the list with the editable task
document; its originating-tab breadcrumb returns to the list and its
header exposes Share and the task Details/Properties panel. Shift-click opens
the task in a new split instead. While the list is visible, `J` and `K` move
focus without opening a task until activation. In an open task detail, they
replace it with the next or previous task in the same filtered order.

The desktop `Create` → `Task` modal uses the standard dialog panel, circular
icon controls, and a pill-shaped `Create Task` button with 16px outer padding.
The mobile task drawer retains its existing layout.

## Email — `/app/component/mail`

Email's Tags sidebar uses the same [nested tag tree as Tasks](tasks.md#nested-sidebar-tags).
Carets and folder-only parents expand branches; actual tags select their exact ID
and switch the mailbox to All. Parent selection does not include descendant tags.

Full email client. Tabs: `Signal` / `Noise` / `Sent` / `Calendar` / `Drafts` / `Shared` /
`All`. Compose via the `Email` button (or `Create` → `Email E`). On a fresh local user it
shows `Connect your email` (Gmail/Google Workspace OAuth) — most functionality needs a
connected account. Search is `Ctrl+F` within the surface.

The new views reuse the legacy filter option rows and searchable submenus.
Their triggers are icon-only buttons matching the surrounding view controls;
Clear/Reset filters and the mobile Clear all action use destructive text styling.
Both layouts show a small accent dot beside categories with active refinements;
default All selections are not marked.
Email Status and Done are single choices that close the menu; attachment filters
stay open for multiple selections. Tags supports search, pins selected tags first
on opening, and is omitted when no tags exist. **f** opens the filter menu.

### Cached Mail filtering

With GraphQL caching enabled (browser or native Tauri) and the email metadata backfill synchronized,
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
projection proof is unknown, never false. Tag selections use cached property postings;
attachment chips refine the cached rows on the client. Sender/recipient filters and
non-created/updated sorts remain outside this local profile. Grouping and sort-selector
coverage are separate from the filter-selection matrix. No cache-format wipe is required: Mail uses a separate versioned profile
and a new backfill checkpoint, preserving existing queued work. Deploy the backend
schema additions before the client: it selects canonical message eligibility/recency
fields, body-free canonical preview references, and viewer-relative share facts.
The `soup-mail-v3` property-aware profile and new backfill checkpoint rebuild Mail proof without
changing the persisted mutation queue format. Native Tauri maintains the same
predicate projections and revision-bound local page contract as the browser.
Checkpoint v14 restarts older scans to populate property-aware indexes without wiping
queued work. A background network failure does not hide a usable current-query
cached Mail page; server-reported GraphQL errors still surface.

Native filter evaluation requires a full native app update, not just an OTA
frontend update. Older binaries retain their previous unsupported-filter fallback
while Shared Mail network backfill continues. The temporary compatibility guard
can be removed once a full native release includes the filter command and OTA
delivery excludes older binaries.

For Linux desktop automation, see the [native E2E guide](../../apps/web/tests/native/README.md).
The first scenario covers Signal → Noise → All after disconnecting both native
HTTP and WebSockets. iOS shares the native cache code but is not yet covered by
that driver.

In the new Email view, ordinary row activation opens the thread inside
`/app/component/mail`; the Email breadcrumb returns to the filtered list.
Shift-click opens a standalone split at `/app/email/<thread-id>`, which remains
the destination for direct links and legacy surfaces. Click a message header to
expand or collapse it; `Show N hidden messages` reveals the collapsed middle of
a longer conversation. A standalone link with
`?email_message_id=<message-id>` reveals that message.
Collapsed thread cards use a compact text snippet; expanding mounts the message
body and its attachments. On phones, messages form flat rows with horizontal
separators and 16px side gutters; collapsed previews show one line. Desktop
keeps rounded cards matching the chat composer: soft shadows in light mode,
the same subtle 3D rim in dark mode, and a faint hover tint. Desktop selection
does not add an accent-colored ring; keyboard focus has a neutral outline.
Replies appear inline on desktop and in a composer drawer on touch devices.
Desktop draft bodies and app-controlled message text use 15px, matching channels.
HTML messages with preserved sender typography retain their explicit sizes.
Desktop reply actions sit together at the bottom right: discard, attach, schedule,
then Send, with circular hover backgrounds inside the card's 16px padding.
Standalone compose uses one right-aligned row inside its 16px content padding:
delete, attach, format, schedule, and send. Touch compose uses its header toolbar.
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
glass bottom sheet for status, done, attachment, calendar and tag filters, plus an `Inbox`
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
Rows have trailing selection checkmarks; Close filters dismisses the sheet
without resetting its selections.

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

Shared always excludes files owned by you. Selecting **Created by → Me** therefore
returns no files; selecting Me together with another creator returns only that
other creator's shared files. Clearing the creator selection restores all Shared
results. This applies to restored filters and flat/grouped list requests—not
just client-side row filtering. Cached inserts enforce the same rule before a
refetch, including expanded groups and inactive cached Shared queries. Until
viewer identity is available, document inserts into Shared are rejected.

On touch devices (phones and tablets), Files keeps the original tabbed view and
mobile navigation even when `enable-new-app-views` is enabled.

On desktop, with `enable-new-app-views` enabled, Files opens **Drive** using the
same shell as Tasks. The sidebar contains `New file or folder`, `My Files`, `Recent`,
`Shared with me`, collapsible Favorites, and a searchable folder hierarchy.
Drive omits split-history back/forward buttons in both wide and narrow layouts;
the split close button remains available when multiple splits are open.
Files opened in place from Drive show a return link labeled with their originating
subview (such as `My Files`, `Recent`, or `Shared with me`) or folder name. The text-only
label's font weight matches the file title. The link
restores the originating Drive view.
The `Drive` folder row opens the folder overview. Click a folder name to browse
its contents in the main pane; its separate expand/collapse button reveals child
folders without navigating. The top bar keeps the full folder and file detail
path in one breadcrumb trail. Folder containment uses `/` separators, while the
transition to a file detail and nested detail navigation use the default `>`
separator. Choosing a folder breadcrumb returns to that folder and clears newer
file details. Empty folders show `This folder is empty` and a `Back to Drive`
action that returns to the folder overview. Folder search retains matching
descendants' ancestors and reveals their branches.

`Search Drive` searches the current tab or folder overview; search within a folder
is temporarily hidden, including its Cmd+F shortcut. The sidebar's folder-name
search remains available. Right-click any Drive view, the Drive folder overview,
or a folder at any depth for **Open in new split**, **Open in current split**, and
**Open fullscreen** (when multiple splits are open). Folder menus also offer
Favorite/Unfavorite, Move to folder, Copy Link, and owner-only Rename and Delete.
Favorites use the same open actions and **Remove from favorites** menu as Tasks.
The **Filter** menu reuses the
legacy **Type**, searchable **Tags**, and **Created by** submenus alongside **Files**
for Default, All files, and Email attachments. Created by is hidden while My Files
is restricted to your own files. Recent offers only file-scope filtering.
`Sort files` offers modified, created, and viewed dates.
Recent uses the viewer's own interaction order and does not offer a sort override.
The New menu and drag/drop uploads target the selected folder. File rows retain
selection and context menus; ordinary folder clicks and Enter browse inside Drive,
while Markdown, code/CSV, image, video, and unrecognized file clicks and Enter
replace the list with a breadcrumbed detail. Choose the current location
breadcrumb to return to the list; choosing an ancestor file drops newer detail
entries. Opening a list row or sidebar favorite starts a new detail path; only
navigation originating inside a detail appends to that path. Modified clicks and
file types without a dedicated detail, including PDF and canvas, retain existing
split navigation. On narrow layouts, use `Select Drive view` for tabs, favorites,
and folders. Navigation state and expanded folders are restored when returning
from an opened file.

## Calendar — `/app/calendar/view`

Calendars default to Day on phones and Week on desktop. The selected view is
remembered locally on each device.

Calendar event creation and editing open in a bottom sheet on touch devices,
with scrollable content above the keyboard. Desktop retains the centered dialog.
Dismissing a changed event still asks before discarding the draft.

On phones, event details use inset round action buttons and a transparent RSVP
footer. Answering a recurring invitation opens a rounded glass sheet: choose
`This event` or `All events`, then `Save response`. Cancel or Close returns to
the event details without sending a response.

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
As in Google Calendar, the guests row of the details popover (a bottom sheet on phones)
carries `Copy guest emails` and `Email guests` icon buttons. Copying puts every guest's
address on the clipboard, comma-separated. Emailing opens a new email addressed to every
guest but you — in a split beside the calendar on desktop, as the full-screen composer on
touch devices — and is hidden when you are the only guest.

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

On phones, recorded call headers omit the **Call Again** action.

### Sharing a call

A call's **Share** dialog has a `Team access` control (None or View) for the same canonical
team share. The side panel has a `Sharing` section with one `Share with team` checkbox, and the
in-call controls carry the same checkbox while a call is live. It is canonical team sharing (the
same `Team access` model documents and AI chats use), fixed at **view**. While the call is **live**
the checkbox is a pending toggle (on by default) that any participant with edit access can flip;
other participants see it update live. When the call ends it is applied: with the toggle on,
everyone on the creator's team can open the recorded call, read the transcript and AI summary,
and find it under Calls and in search; off means nothing is shared. Afterwards only the call's
**creator** can change it — everyone else sees the checkbox read-only with a note saying so.
Team sharing is independent of channel access and of link sharing.

## Customers (CRM) — `/app/component/companies`

The 216px local sidebar uses the same navigation primitives as Email and Tasks.
Board and List share a horizontal segmented toggle at the top of the sidebar; the
main header has no layout toggle. People is not available. Views include All companies, My companies
(Owner = current user), Needs follow-up (has a stage other than Churned and last
interaction at least 14 days ago),
Recently active (team email activity within 7 days), and Unassigned (no Owner). Existing personal/team
saved views also appear under Views. Stages remain board columns or list properties.
Board/List switches the representation without changing the selected set.
Recently active uses the CRM last-interaction timestamp, advanced by sent and received
email. It does not count company @mentions or chat discussions. Manually created
companies initialize that timestamp to creation time, so newly added companies may
also appear before any email; the sidebar hover tooltip discloses this limitation.
View descriptions appear in sidebar tooltips, not above the main board or list.
The `Search companies` field uses the shared Email/Tasks search bar. Command-F
focuses it, `Clear search` resets it, and Escape leaves the field.

Clicking a company in Board or List (or pressing Enter on a focused list row)
opens its details inside the CRM workspace, keeping the left navigation visible.
The top breadcrumb reads `<current view or list> > <company>`; click the first
segment to return with the same filters, layout, and list scroll position. Selecting
another sidebar view or switching Board/List closes the company details.
Shift-click still opens the company in a separate split. Direct company links use
the standalone company page.
Clicking a contact in an embedded company's Contacts section appends a third
breadcrumb: `<current view or list> > <company> > <contact>`. The CRM sidebar stays
visible. Click the company breadcrumb or the contact's Company link to return to
the company; click the first breadcrumb to return directly to the originating
view. Shift-click still opens a contact in a separate split. Direct contact links
use the standalone contact page.
Company and contact headers have `Copy link` beside the side-panel toggle.
It copies the record's direct URL and shows a confirmation toast; this is also
available in the embedded company and contact breadcrumb header.

`Collapse CRM sidebar` persists across visits; `Expand CRM sidebar` restores it.
At narrow widths, `Show CRM navigation` opens the same navigation in a menu.
The sidebar's Views and Lists sections can also collapse independently.

CRM lists are currently disabled by `enableCrmLists` (default `false`). The sidebar
Lists section, list editor, and company membership controls only mount when enabled.
Existing list data is preserved; a restored list view returns to All companies while
disabled. Board/List layout and saved filter views remain available.

When enabled, lists are personal, team-scoped collections of explicit company IDs, persisted through
saved-view storage separately from saved filter views. `New list` opens a name and
company picker; `Edit list` changes membership or deletes the collection. An empty list
must not show every company. The picker browses up to 500 recent companies. Canceling
never saves the draft. Saving only closes the dialog after the server succeeds.

Company detail pages show a **Lists** section in the right panel, with current
personal list memberships as chips. **Manage lists** expands a searchable checkbox
picker. Checking or unchecking saves immediately and refreshes the CRM sidebar's
membership counts. Changes are disabled while saving; failures show an inline retry
message and keep the last saved membership. With no lists, create one in the CRM sidebar.

`New company` uses the existing creation dialog. `Import` previews a CSV with `name`
and `domain` columns (1–100 rows, at most 1 MB). The explicit Import button writes the
previewed companies. Partial failures retain only failed rows for retry. Use preview
and cancel for browser checks against hosted dev data. `CRM settings` opens the existing
settings panel. Requires a team with CRM enabled.

`Export` opens options for companies. Choose Current view
(respects filters/search) or All records across views (each visible record once), then
select CSV columns. Company exports include Stage, Owner, Revenue and optional custom
properties. `Prepare export` fetches every page and shows a count and three-row preview;
it does not download. `Download CSV` saves the prepared snapshot using the selected
columns. Changing scope requires preparing again. Cancel stops preparation. CSV uses UTF-8,
quoted fields, original date timestamps and spreadsheet formula escaping.

## Activity — `/app/component/activity`

Requires authentication and the `enable-activity-feed` flag. Direct navigation and
restored splits wait for flags to load; when disabled, they redirect to Home
(`/app/component/inbox`) without loading the activity feed.

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

On phones, shared confirmations (including Remove Member and Cancel Invitation)
use a glass sheet with a title, description, Close confirmation button, and
side-by-side cancel and confirm actions. Pending actions disable both buttons
and prevent dismissal; canceling leaves the underlying data unchanged.

## Settings — `/app/settings/<section>`

On phones, **More views → Settings** opens an inset glass sheet over the current
page. The main page has a profile shortcut and grouped Account, Preferences,
Workspace, and enabled agent/admin sections. Tap a row to open that settings
page inside the sheet; **Back to settings** returns to the grouped list at its
previous scroll position. **Close settings** at the top right, Escape, an
outside tap, or a downward swipe dismisses the sheet. Opening Settings again
starts at the main page; explicit links (for example Connections) open their
section directly. Existing settings URLs open the requested section in the sheet
and restore the underlying app route. The header stays visible while forms
scroll, including with the keyboard open. Desktop settings retain their panel
and split navigation.

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

`Harness` configures Cursor, Codex, and paired macrod runtimes. Cursor's default-model picker uses
the same live model discovery and retains its existing save action.

The Codex row uses the OpenAI logo and the same icon, button, and status styling
as Cursor. Under **Codex**, choose **Connect with ChatGPT**, copy the displayed device code,
and use **Continue to ChatGPT** to finish sign-in in the provider tab. The Macro
page displays pending, expired, failed, and retryable error states; **Cancel
sign-in** cancels the attempt. After connecting, choose a **Cloud environment**
and click **Save Codex settings** before using Codex. Options show their
repositories. New sessions always use the `main` branch; there is no branch
picker or automatic repository selection. Changed selections display **Unsaved
changes** until the server confirms them. The save button is disabled until an
environment is selected, and when it matches the saved environment.
These choices apply to new sessions. **Disconnect** in the Codex row (accessible
name **Disconnect ChatGPT**) removes the connection. The UI never asks for an
OAuth token.

The Codex section and its auth/config requests were exercised in Chromium with
mocked backend responses on 2026-09-15. Provider login and a full deployed Macro
session were not exercised by that UI check.

## Notifications

Toast regions are labeled `Notifications (alt+T)`; five empty live regions always exist in
the a11y tree (ignore them when parsing snapshots).

Staff Noise emails still create in-app notification rows, but do not send a new-notification
event over GraphQL or the legacy WebSocket gateway, so they do not trigger browser popups.
Those rows are available on the next fetch/refetch. Signal delivery and the existing
staff/customer eligibility rules are unchanged; no browser eligibility request is needed.

Discussion composers on companies, contacts, documents, tasks, and PRs use the
shared channel/AI composer surface, 26.25px desktop corners, 15px desktop text, and
a circular neutral Send button. Edit with AI uses the same composer treatment.
Inline comments, replies, and their edits use a plain
input without a surface background, rounded frame, or shadow. Attachment and
formatting actions stay available.
On mobile, open documents and tasks put their new-comment composer in the
accessory dock above navigation, using the channel input's compact pill and
expanded surface. Ask AI and New are hidden in these open views only when the
comment composer is available; their list screens keep those controls. Users
without comment permission have no comment composer, so Ask AI remains visible.

On touch devices, an email thread's floating action bar has Previous email and
Next email arrows beside the larger Mark done checkmark. The arrows follow the
source list's filtered order, skip non-email items, and disable at its ends.
`J` and `K` use that same order in the Email view. They do not wrap; a thread
opened without a source list has disabled arrows.
Mark done archives the current thread and opens the next email in that same
filtered list, loading pages until another email is found or the list ends.
On native mobile, stepping replaces the current email while preserving the
filtered list behind it for swipe-back. In the newer Email view it retargets the
view-owned detail stack instead of opening another block. To verify, open the
first email from Signal or Noise, tap Next and then Previous, and return to the
same filtered list.
Leaving the email cancels pending
navigation and archiving while a page loads. At the end it opens the previous
email; with no neighboring email it stays on the archived thread. Mark as not done
does not advance. Undo restores the archived email and returns to it.

The mobile reply/forward drawer uses matching circular glass buttons for
discard, attachments, and send, with the dock's button/icon sizing and regular
Phosphor icons. Send remains disabled until the draft is valid and shows a
spinner while sending.

The mobile new-email composer nests the channel-style Send button inside its
top-right glass toolbar, with an even 5px inset on the top, bottom, and right.
The toolbar is 46px tall; attachment and schedule controls align with Send.

Channel, email, Markdown, and composer body text use `text-base`: 15px at the
default root size. Supporting `text-sm` text is 14px and `text-xs` is 12px.
Desktop and mobile share this scale, with accessibility text scaling preserved.

Desktop channel and AI composers use an `Attach files` paperclip that opens the file picker directly, without a plus menu. Comment composers open the image picker directly. Channels and DMs always open in message mode; create tasks through the task creation dialog. Shift+Enter, including an empty new line, expands channel and AI inputs so text starts above the toolbar at the left inset. Sent AI message bubbles use the ink fill with a contrasting foreground in each theme.
