# Other Surfaces

## Canvas colors

To check the default canvas color, create a rectangle and a text box without
changing the swatch. The rectangle should have a light neutral fill and a dark
outline; the text should be dark and visible. Also check the neutral swatch after
selecting another color. Neutral colors use an OKLCH `none` hue, which must render
as gray rather than transparent.

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

## Home (desktop) / Notifications (mobile) — `/app/component/inbox`

Every form factor waits for new-app-views flag readiness before choosing the
new view or its legacy fallback. With the flag enabled, touch devices render
the new Inbox as **Notifications**: a floating Signal/Noise pill strip with a
leading filter drawer (Status and Type), pull-to-refresh, and swipe-left to
mark done. On touch, Signal is a pure notification feed — the viewer's own
touched-by-me recents are not merged in; that merge is desktop Home's Signal
only, so sent mail and AI chats without notifications appear only on desktop.

On a cold launch, notification transport follows the GraphQL Soup flag reactively:
if the flag arrives after REST starts, the GraphQL notification query must actually
start too. Verify a reload with delayed flags retains non-email notifications once
loading settles, including when the list itself uses REST (notified-at sorting).
Email alone is not sufficient verification: its inbox membership does not require
the global notification feed.

GraphQL-attached notification rows share the global feed's local seen/done
overrides: Mark Done and Undo reflect local intent without waiting for an older
cached notification snapshot to be replaced. These display overrides do not turn
incomplete predicate-index facts into authoritative membership evidence.

On desktop with the new app views enabled, Home defaults to a Signal feed merging
notifications with Activity's `touched_by_me` recents, including sent emails and
AI chats. Each entity appears once, ordered by its latest notification or own
action. On desktop, the funnel button to the right of **Home** opens **Filter Home**.
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

The Inbox provider honors an explicit initial tab, search, grouping, and facet
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
line. Their timestamps and unread dots stay visible; hovering reveals the full
title, activity, and repository/branch. Missing repository metadata is omitted.
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
still load below it without moving the input. Eligible newer accounts (all
accounts in development) see “New to Macro? See the **Getting Started** page.” directly
below the composer, above suggestions. The link opens
`/app/component/getting-started`; **Dismiss Getting Started link** hides it and
remembers the dismissal per user in this browser across reloads. Dismissals update
all open Home panes immediately and stay isolated when switching accounts. This
dismissal is independent of the Getting Started sidebar link. Up to three cached AI
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

Calendar reminder rows use the reminder delivery time for Home's date section,
including on a cold GraphQL load with notification sorting disabled. Verify that
an older reminder stays in its older section after the event's metadata syncs;
opening its details should show the expected occurrence. A newer reminder or your
own later activity can move the row forward, but a calendar sync alone should not.

On mobile, this route always renders the original Notifications soup view,
regardless of the new-app-views flag. The dock and search scope use the bell icon
and **Notifications** label; Home is desktop-only. Notifications uses the existing
Inbox presets, Signal/Noise tabs, notification cards, read/type filters, swipe
actions, and pull-to-refresh, without Home's merged own-activity feed or chat
starting pane. Opening a row navigates to its entity. On iOS, rows fade underneath
the filters and status bar using the shared top edge gradient.

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

When switching email tabs or inboxes, the list shows current-query cached results
or a scoped `Loading email` spinner until they arrive—not the previous tab's rows
under the new heading. Active searches also hide retained results and show loading
while selected tag sets are pending. Background refreshes retain the current list. To check this,
rapidly alternate Signal, Noise, and Sent, then change inboxes; a delayed cache or
network read must not leave the old rows visible or expose their Load more action.

The new views reuse the legacy filter option rows and searchable submenus.
Their triggers are icon-only buttons matching the surrounding view controls;
Clear/Reset filters and the mobile Clear all action use destructive text styling.
Both layouts show a small accent dot beside categories with active refinements;
default All selections are not marked.
Email Status and Done are single choices that close the menu; attachment filters
stay open for multiple selections. Tags supports search, pins selected tags first
on opening, and is omitted when no tags exist. **f** opens the filter menu.

### Read state and trash

With GraphQL Soup enabled, **Mark read/unread** updates the normalized email row
optimistically. Permanent server errors roll it back; retryable transport failures
can leave the action in the durable queue. Mark unread sends only the thread ID;
the server resolves that inbox's UNREAD label and returns the canonical thread
(`__typename`, `id`, `isRead`) to reconcile the cache. The row should flip immediately
even when the client labels cache is missing or stale—no label fetch precedes the
optimistic update. Queued read/unread writes retain revalidation descriptors for
active flat and grouped lists, including loaded continuation pages. Once replay
commits (even after a reload), those queries refresh from the server; they should
not refetch over the optimistic state merely because a write was queued. Trash
and its Undo refresh mounted GraphQL lists after the server operation finishes.
The GraphQL-disabled REST path is unchanged.

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
`?email_message_id=<message-id>` loads older pages as needed, expands the target,
scrolls it into view, and briefly highlights it. For navigation regressions,
exercise both a recent message and one outside the first page. Open another
target while loading or highlighting: the previous request must not scroll the
new thread or clear its highlight. Closing the split cancels pending positioning.
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
When checking draft autosave, edit the body of a draft with uploaded or forwarded
attachments, wait for the save, and reopen it; the attachments should remain visible.
AI email tool drafts persist body-only edits; changing recipients or the subject
is not required to save the body.
The three-dot button beneath a body reveals quoted content and a trimmed
signature. Plaintext and Macro Markdown use the existing Markdown renderer;
Macro Markdown messages retain document mentions. Ordinary HTML bodies use an
open shadow root: Playwright text locators can reach them, but a card's ordinary
`innerText` or `querySelector` does not traverse that root.

Sending a reply from an inbox thread marks that thread done but stays on it;
only the explicit Mark done action opens the next email.
After a successful send, the `Email sent` notice offers `Undo`. Undo restores the
sent envelope and editable content, including when the reply used another inbox;
a slow background refresh must not keep the restored editor disabled. A rejected
send reports failure and restores its original reply editor if it is still mounted.
A failure from an older, unmounted editor must not overwrite a newer edited reply.
A presentation or refresh error after successful delivery is not a reason to send
again.

Send and schedule are refused with a notice while the device is offline, while a
draft is still syncing (its save was accepted locally but not yet confirmed by the
server; retry after a moment), or while an attachment has no completed upload. The
composer keeps its content in each case. Attachments cannot be added while
offline: a blocking notice explains and nothing is attached.
For a new standalone email, a failed REST draft save is best-effort: Send can
still proceed without a draft ID when no save was queued and no attachment is
waiting to upload. A server rejection blocks sending even an existing draft.
An internal draft-save failure, including a failed response read after the save
commits, stays queued and retries with backoff. It must not permanently disable
autosave; Send stays blocked until a save is confirmed. Invalid or unauthorized
writes still stop retrying.
Test this with a previously saved draft as well as a new one: a queued edit must
block Send and scheduling until a save commits. Reopening a cached draft while
offline must retain its uploaded attachments and confirmed scheduled time.

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

With `enable-new-app-views` enabled, Files opens **Drive** using the
same shell as Tasks, on desktop and touch devices alike.

On touch devices (phones and tablets), the Drive header is a scrollable pill
strip — **Recent**, **My Files**, **Shared with me**, and **Folders** — with a
leading filter-drawer button, like Tasks. Touch opens on **Recent** (the first
pill). The drawer holds Sort (hidden on Recent, where the viewer's own
edit order applies) and, on tab locations only, the same filter groups as the
desktop **Filter** menu; active selections show a count badge on the trigger
and a `Clear all` action in the drawer. The in-view `Search Drive` field, the
Sort/Filter dropdowns, and the header New menu are desktop-only — search on
touch uses the global search overlay and creation uses the dock's New button.
The **Folders** pill opens the folder overview and stays highlighted inside
any folder; tapping it from inside a folder returns to the overview, and
selecting another pill leaves the folder tree. The sidebar contains `New file or folder`, `My Files`, `Recent`,
`Shared with me`, collapsible Favorites, a searchable folder hierarchy, and a
collapsible Tags section beneath the folders. Tags lists every tag you can apply,
nested by `/` in the tag name, with a `New tag` action in its header. Choosing a
tag shows only that tag's files within the current tab or folder and exits any
inline file detail; choosing the highlighted tag again clears it, and the same
selection appears under the **Filter** menu's Tags submenu. Navigating to another
tab or folder clears tag filters. A folder with no files matching the active tag
shows the list's no-match state rather than `This folder is empty`.
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
**Open fullscreen** (when multiple splits are open). Opening a location in a new
split clears search and filters in the destination, leaving the original split
unchanged. Folder menus also offer Favorite/Unfavorite, Move to folder, Copy Link,
and owner-only Rename and Delete.
A folder's Share dialog, when the owner belongs to a team, has Team access
(None, View, Comment, or Edit) without a Link sharing card or Link tab.
Favorites use the same open actions and **Remove from favorites** menu as Tasks.
The **Filter** menu uses the same controls as Tasks: **Type**, searchable **Tags**,
and **Created by** submenus alongside **Files** for Default, All files, and Email
attachments. Options within a group match any selected option; different groups
combine to narrow the results. Created by is hidden while My Files
is restricted to your own files. Recent offers only file-scope filtering.
`Sort files` offers modified, created, and viewed dates.
Recent uses the viewer's own interaction order and does not offer a sort override.
The New menu and drag/drop uploads target the selected folder. File rows retain
selection and context menus; ordinary folder clicks and Enter browse inside Drive,
while Markdown, code/CSV, image, video, PDF/DOCX, canvas, and unrecognized file
clicks and Enter replace the list with a breadcrumbed detail. Those detail
menus include Duplicate, Rename, Move to folder, and Delete. Code, CSV, image,
video, canvas, PDF, DOCX, and unrecognized files also include Download. PDF
details include Print, and DOCX files include Download DOCX. Markdown details
use the document menu, which already includes Download. Spreadsheets keep the
editor's Import and export menu for Excel and CSV downloads. Choose the current location
breadcrumb to return to the list; choosing an ancestor file drops newer detail
entries. Opening a list row or sidebar favorite starts a new detail path; only
navigation originating inside a detail appends to that path. Cmd/Ctrl-clicking a
row toggles selection; Shift-clicking a checkbox selects a range, and Shift+Enter
opens the focused row in a new split. Cmd/Ctrl-clicking a row's folder link or
search hit opens a new tab. Short filtered pages load more results automatically;
a failed page shows a retry action instead of silently stopping. On touch, tabs
switch via the header pills; on narrow desktop layouts the header keeps a plain
title and navigation goes through the hamburger overlay. Location, search,
filters, expanded folders, list focus, and scroll position are restored when
returning from an opened file.

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

A channel's `Calls` tab lists that channel's recordings with the same rows, filtered
by the channel id. Its search field matches call names and transcripts in that
channel.

If a recording fails to play, reload the page to obtain a fresh recording link,
or use **Open or download recording**. The playback warning does not assume
that the failure is caused by an unsupported media format.

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

On desktop, the local sidebar uses the same navigation primitives as Email and Tasks.
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

On touch devices, Customers uses the same full-frame list layout as the other
mobile views: floating CRM-navigation and filter buttons with Board/List pills,
List as the fresh default, and the global **+ Company** action above the dock.
The navigation button opens the CRM views and lists; the desktop toolbar and
embedded detail stack stay out of the mobile flow, so selecting a row navigates
in place.

On desktop, clicking a company in Board or List (or pressing Enter on a focused list row)
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

When checking Activity, enable GraphQL Soup as well as the activity flag. Verify
that an initial visit resolves entity names in both the feed and Most active,
then reload and scroll through another page. Preview loading and live name
updates should keep the page responsive without repeatedly fetching previews.

Activity refreshes live after recorded actions. With two pages loaded, make an
action in another tab and verify the feed retains its page-boundary rows while
the action count and heatmap update. An open entity activity panel should also
refresh for actions by another authorized user. After disconnecting and
reconnecting the websocket, verify recovery without requiring another action.
Hidden tabs defer refresh until visible; purges refresh all mounted activity
queries through the normal access checks.

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

## Getting Started — `/app/component/getting-started`

The buttons under **Put Macro's agent to work** create a chat and send their
example prompt on first use. Later clicks reopen that button's saved chat without
sending the prompt again, including after leaving the page or refreshing. Each
button has its own chat, saved per account in this browser's local storage.
Repeated clicks while the same button is creating its chat are ignored; a failed
creation can be retried.

## Home — `/app/component/home`

Greeting, getting-started checklist, example prompt buttons (`Draft a document`,
`Draft an email`, `Search & research`), and the ubiquitous `Ask AI` composer.
Eligible newer accounts (all accounts in development) also see the same
dismissible **Getting Started** link below
the composer, with its dismissal shared with the desktop Home starting pane.

On phones, shared confirmations (including Remove Member and Cancel Invitation)
use a glass sheet with a title, description, Close confirmation button, and
side-by-side cancel and confirm actions. Pending actions disable both buttons
and prevent dismissal; canceling leaves the underlying data unchanged.

## Settings — `/app/settings/<section>`

### Team membership

Team membership has no size cap, including free teams. Invitations and domain
auto-join must keep working beyond five members and the former stage-plan limits.
Free-team joins do not create a paid subscription, bill a seat, or grant premium
roles. Teams with an existing paid subscription retain their per-seat billing;
enterprise teams retain their billing bypass.

Under **Team**, owners/admins can turn **Auto-join on domain** off and can restrict
invitations to admins with **Members can invite**. These controls still apply.
To verify the membership flow, use a local free team with five members: invite
and accept a sixth member, then sign up another user on its enabled auto-join
domain. Both should appear in the team's member list and configured auto-join
channels without an upgrade prompt. Repeat with auto-join disabled to verify a
same-domain signup is not added automatically.

### Navigation

On phones, **More views → Settings** opens an inset glass sheet over the current
page. The main page has a profile shortcut and grouped Account, Preferences,
Workspace, and enabled agent/admin sections. Tap a row to open that settings
page inside the sheet; **Back to settings** returns to the grouped list at its
previous scroll position. **Close settings** at the top right, Escape, an
outside tap, or a downward swipe dismisses the sheet. Opening Settings again
starts at the main page; explicit links (for example Account) open their
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
`Integrations` (personal Gmail/GitHub accounts), `MCP server`
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
`Connect <app>` chip that opens Agents → Connections for that app. MCP integrations
are managed on that page, rather than in Settings.
`Back to app` returns to the previous surface. Open via user-email button menu or `Ctrl+;`.

`Agents` → `Create agent` (or edit an existing agent) opens runtime selectors.
The model list is loaded live and independently for Macro Agent, connected Cursor, and every
registered macrod harness. The selected harness stays selected when the list refreshes.
A paired macrod connects on startup, so models can load before any agents are bound.
A harness can show `Loading models…`, an unsupported message, or
a retryable error without hiding the other harnesses. Editing preserves a saved model that
is no longer offered and labels it `saved, unavailable`. A macrod with no responding runtime
can remain loading until the 10-second discovery timeout; use Retry after reconnecting it.
New macrod sessions use the agent's saved model before sending the first prompt.
Changing that default applies to new sessions; existing sessions keep their selected model.
If the runtime rejects the saved model, the prompt fails instead of using a different model.

`Harness` shows Cursor, Claude, Codex, and paired macrod runtimes to every user.
Connection chips in agent replies open this page, including before any account is connected. Cursor's default-model picker uses
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
# Canvas Next

Open `/app/component/canvas-next`. This local-only component is enabled by
`USE_CANVAS_NEXT` (override with `VITE_USE_CANVAS_NEXT=false`); it lives inside
`block-canvas/canvas-next` and uses the pure graphics core. Reset demo (in the history drawer’s Canvas menu) restores
the disposable seed; reload restores the local debug snapshot.

Saved Canvas documents use the new editor when `enable-canvas-next` is enabled
(local override: `VITE_ENABLE_CANVAS_NEXT=true`). Opening a legacy file migrates
it in memory; the first edit saves version 2 JSON. Reload should preserve edits,
text formatting, labels, groups and connectors. Unsupported legacy content shows
**Open in legacy editor** without saving a migration. Version 2 files require
Canvas Next and cannot be opened by the legacy editor when the flag is off.
Read-only documents show a pan/zoom surface with **Fit canvas** and no drawing
controls. Failed saves show **Retry**. Real documents have neither **Reset demo**
nor the demo's local snapshot. SyncService integration is a follow-up.

Smoke test the rollout with a disposable file: open legacy JSON, edit once,
reload, and verify the edit remains. Disable the flag and reopen the saved file;
it should require Canvas Next. Check read-only access does not save or expose
editing controls. The flag is fixed for each open document until it is reopened.

For implementation status and upcoming checkpoints, see
[Graphics and Canvas parity](../GRAPHICS_PARITY.md). This page describes the current
editor UI. Canvas Next has versioned JSON persistence but no production sync; the separate
graphics peer playground is an in-memory Loro experiment, not this full editor.

The disposable demo saves committed scene changes and the camera in local storage under
`macro.canvas-next.debug.v1`, restoring them on reload. Reset demo replaces the
saved scene; undo history and unfinished gestures are not persisted.
Ctrl/Meta-wheel zooms around the pointer with a gentle continuous response;
100 wheel pixels zooms from 100% to about 122%, and larger individual events are
capped at the same factor. Plain wheel input still pans. Check small trackpad
movements, coarse wheel ticks, and reversing direction without the anchor drifting.

The bottom-center drawing toolbar uses icon buttons with tooltips and sits above
the inspector when they overlap. It also contains Add media, Add document, and Add
embed. Its trailing Toggle history drawer button opens/closes the attached bar above
it, which contains Undo, Redo, and Canvas menu (Show/Hide layers and Reset demo).
The zoom percentage in the Design panel header opens the standard dropdown and
remains visible with or without a selection. Its sections contain Zoom In
and Zoom Out (Cmd+= / Cmd+-, with Zoom In displayed as Cmd++), plus Zoom to fit
(period) in the first group. The next group contains 25/50/100/200% presets, then Toggle
dot grid, then No snapping, Snap to px, and Auto snapping. Group dividers use the
dropdown's single theme-width gap, with no additional separator lines. The preset
checkmark tracks the current zoom. All checked options use a plain ink-colored
check with no checkbox background or border. The grid starts enabled and snapping defaults
to No snapping whenever the editor reopens. Snap to px uses 1 canvas px at any zoom;
Auto uses the smallest grid interval with visible dots, including faint dots.
At 100% Auto uses 16 px, at 200% it uses 4 px, and at 800% it uses 1 px. Hiding the
grid disables Auto snapping until it is shown again; Snap to px stays active.
Choose Auto at 100% and drag a shape: its world-bounds position should land on
multiples of 16, including the preview. Switch to No snapping and check fractional
positions survive dragging and inspector entry. Resize should snap dimensions while retaining Shift
aspect ratio and Alt center constraints. Mixed selections keep their internal
spacing. The layout inspector and its number scrubs use the same unit; rotation
and freehand samples retain their own precision. Bound connector endpoints remain
exactly attached. Undo restores the pre-gesture geometry in one step.
The dot grid reveals powers of four as the camera zooms (1, 4, 16, 64, and
coarser canvas-pixel intervals). Coarse dots remain steady while fine dots fade
in gently; at 800% the 1 px canvas grid is visible at 12.5% opacity. Dots are
always 1 screen pixel wide, with crisp SVG edges even at fractional zoom such
as 738%. Dots disappear once closer than 4 screen pixels apart. Verify pan/zoom
keeps all levels aligned to the same canvas origin and Toggle dot grid hides
all levels. Grid density updates Auto's unit, without changing existing saved geometry.
Fit scene centers the overall scene geometry in the current canvas viewport,
independent of selection. It zooms in or out until the width or height fills the
available space with 100 screen pixels of padding per side, within the camera's
zoom limits. Padding shrinks for small embedded viewports.
The Design inspector is always visible on the right. Show layers in Canvas menu
toggles the floating left Layers panel. The Design inspector is a single
header row when nothing is selected; selecting an item reveals its properties in
a viewport-bounded card with a fixed header and a scrolling body. Fit scene accounts
for the expanded inspector. The top selection section offers separate horizontal and
vertical alignment button groups, distribution,
X/Y position, rotation, quarter-turn and flip controls. Layout provides width/height
and horizontal/vertical spacing; differing values show Mixed. The lock beside dimensions
shows an active background when locked and links width and height, preserving each selected item’s aspect ratio when typing or scrubbing. These fields support
negative positions/spacing and undo. Fully connected connectors do not contribute
to alignment, distribution, or layout bounds, even inside groups. Connectors render
above their highest connected endpoint after layer changes and grouping. Connected
connector strokes, dashes, and arrowheads keep their size when items or groups scale.
Smooth connector selection bounds follow the curve extrema, with selection outlines
and picking using the same world-space geometry as the visible connector.
Fill appears for rectangles/ellipses, Corners for
rectangles, Connection for connectors, and Typography/Text color for text. Rectangle and ellipse drawing previews use the current fill, stroke, opacity, and
corner style throughout the drag. Sections
are always expanded, with `border-edge` dividers. Color fields are compact input
groups: click the swatch to open the shared ColorPicker with a saturation/brightness
field, Hue and Opacity sliders, and a hex input. Keyboard focus marks the field's
handle, not its outer edge; the opacity track and preview checkerboards use the
active theme's surface colors. The 12 Macro palette colors plus
None, Ink, Surface, and Accent appear below these controls. A separate On this canvas section lists unique fill and stroke
colors from the whole scene and updates as shapes change; click one to reuse it.
Muted and Accent wash are not offered in the preset palette. The row also accepts
hex input (3, 4, 6, or 8 digits). Open the picker on black, white, gray, transparent,
and mixed selections; none should blank the canvas or change the selection color
until you edit it. Arrow keys adjust the field and sliders; invalid hex stays in
the input with a validation error and never changes the canvas. Numeric fields and color rows use the shared neutral
input-group focus frame; connection/font menus use the shared Select. Mixed values
are shown only when relevant selected shapes differ (ellipse radius does not affect
rectangle corner values in a group).
Drag a numeric field's icon to preview position, dimensions, rotation, spacing,
opacity, stroke width, corner radius, or font size directly on the canvas. Release
to commit one undo step; Escape, pointer cancellation, or window blur restores the
starting values. Check that the shape changes before release, Undo reverses the
whole drag, and canceled drags leave no history or saved document changes.
For large selections, drag hundreds of boxes in a 1,000-shape scene. Their
geometry outlines should track the move without extra per-box bounding rectangles;
unselected shapes should stay put and keep their paint order. Repeat with grouped
shapes and connected arrows, then cancel a move and verify Undo/Redo after a
completed move. Ordinary moves share a translation in the renderer; resizing and
connector routing still update their geometry live.
The drawing toolbar includes an Eraser (E); Line is available through L. C is
reserved for Create. Drag the eraser across shapes to remove them, including
shapes crossed between pointer events. The eraser reuses the pencil renderer for a faint ink-muted trail. Points thin
with age and expire after 300ms. Crossed shapes preview at 20% of their original
opacity until release commits deletion; cancellation restores their appearance.
One drag is one undo step; Escape or pointer cancellation restores that stroke.
Switching to Arrow, Line, Connector, or Pencil restores theme Ink for a missing or
fully transparent default stroke, 2 px for zero width, and full opacity for zero
opacity. Visible colors, positive widths, and partial opacity carry forward.
This only changes new drawing defaults; a selected shape with no stroke stays unchanged.
Numeric fields support typing and dragging their icon horizontally; Shift increases
the step. A drag commits on release as one undo step; Escape cancels the drag.
The icon also accepts arrow keys. Clicking numeric or color text fields selects their contents.
Stroke style offers Solid, Dashed, and Dotted for rectangles, ellipses, and connectors.
Group and layer actions are available from the context menu rather than a panel section. Right-click the canvas for
the standard app context menu: cut/copy/paste/duplicate, group/ungroup, the Arrange
submenu, select all, and delete. Arrow keys navigate this menu; Escape dismisses it
and returns focus to the canvas. Active embeds and rich-text editing keep their own
context-menu behavior.

Tools: V select, R rectangle, O ellipse, P pencil, H hand; Space temporarily pans.
Escape cancels the current tool and clears the selection. Open menus and active
text/embed editors retain their own Escape behavior first.
Hold Shift while drawing a rectangle or ellipse for a square or circle. Hold Shift
while moving a selection to constrain movement horizontally or vertically along
the dominant world axis, including Option-drag copies. Modifiers update live even
when the pointer is stationary, and the modifier state on release controls the commit.
Rectangle/ellipse creation selects the new shape and returns to Select. Pencil
stays active for repeated strokes; V or Escape returns to selection. A tap creates
a dot. Mouse movement controls thickness; pens supply pressure. Drawing is one
undo step and Escape cancels pending ink. Pencil selection boxes enclose the
smoothed ink; picking and marquee use the actual ink (3 screen px click tolerance),
so gaps/empty loops remain clickable until the stroke is selected. Resize scales
its samples and recalculates simulated pressure, retaining nominal brush width. Shift-click/marquee adds
selection. Cmd/Ctrl-click selects within a group. Option/Alt-drag duplicates
selected subtrees; Escape cancels without committing the copies.

Single selected shapes retain their bounding boxes and also show a 1 screen px blue trace:
the smoothed pencil centerline, rounded rectangle perimeter, or ellipse perimeter.
In groups or multi-selections, pencil strokes, rounded rectangles, and ellipses show
just their geometry traces inside the shared selection box, without individual rectangular boxes.
Rotated circles and ellipses contribute their actual curve extents to the shared
box, alignment, and movement snapping. Rotate several overlapping circles by 30°
and select or group them: the shared box should touch the outer curves, without
padding from the circles' rotated local squares. Check nested group scaling and
Undo too; a single selected ellipse still retains its oriented resize box.
These traces include children of selected groups, track transform previews, and stay
the same thickness through zoom and nested scaling without intercepting pointer input.
With Select active, hovering shows this trace on the shape/group a click would
select, without handles or a new box. Empty unfilled interiors still click through.
Cmd/Ctrl previews a child within a group; Shift previews the additive selection target.
Hover clears on pointer exit and hides while drawing, panning or transforming.

Use Cmd/Ctrl+A/C/X/V/D for select all/copy/cut/paste/duplicate, arrows to nudge
one snap unit (Shift: ten), Cmd/Ctrl+G to group and Shift+Cmd/Ctrl+G to ungroup.
Undo/redo and Delete use the normal editor shortcuts. They are scoped to this
editor and do not hijack text or number inputs. Right-click exposes editing actions.

Single and multiple selections have invisible resize targets along their entire
edges, with resize cursors and a 10-screen-pixel hit area at any zoom. Only corner
handles are visible; they take priority over the edge targets where they overlap.
The grips stay square to the screen; edge cursors stay EW for sides and NS for
top/bottom. Corners use diagonal arrows based on their world-space position relative
to the selection center, including after rotation or a flip.
Click-drag anywhere inside the selection box to move it, including
gaps and unfilled interiors. Shift-click toggles on release; moving at least 3 screen
pixels instead starts a constrained drag. An unselected target is added before moving.
Shift-drag on empty canvas still adds a marquee; deep-select still picks children.
Drag a side to change width, or top/bottom to change height; perpendicular pointer
movement is ignored. A rotated single shape follows its local axes. Groups and
multiple selections always have dashed, world-axis-aligned boxes; single shapes
retain their oriented solid boxes. The rotator follows a single shape's oriented
top edge; for groups and multiple selections it is centered above the world bounds.
With one rectangle selected, small circular handles inside the corners adjust a
uniform corner radius. Drag any handle inward to round all four corners, or outward
to square them. The value previews on the shape and in the inspector, always snaps
to whole local pixels independently of scene snapping, and stops at the largest
whole number no greater than half the shorter side. Release commits one undo step;
Escape, pointer cancellation, or blur restores the starting radius. Test a rotated
rectangle inside a scaled group as well. Controls stay the same screen size, merge
when they overlap at a pill/circle radius, and hide when the shape is too small on
screen. Radius controls are not shown for groups, multi-selections, or other shapes.
Option/Alt anchors the center; Shift preserves
proportions, including shrinking. Incompatible descendant rotations force uniform
scaling for both edge and corner drags, preventing new shear. Dragging through zero
flips the crossed axis and continues resizing on the opposite side.
Each drag is one undo step, Escape cancels, and handles/collective bounds hide
throughout the preview. Losing pointer capture alone must not snap a move back:
the gesture continues until release, including outside the canvas. Actual pointer
cancellation or focus loss still discards the preview.
The box, handles, rotation circle and resize math all use
the same core selection frame.

The left inspector edits fill, stroke, width, opacity, and rectangle radius;
mixed selections show Mixed values. Group styling applies to descendant shapes.
Styles also become creation defaults. Arrange offers six alignments, horizontal
and vertical equal-gap distribution, grouping, and stable layer changes. The
Layers list selects items; Shift-click toggles selection. Keyboard clipboard
round-trips Canvas Next shape/group/rich-text fragments. Plain/HTML text pasted
onto the canvas creates a text shape.

Smoke test: draw each shape; select/group/copy/paste; verify originals remain and
new items are selected; nudge by one/ten snap units; Option-drag and cancel once, then commit
and undo once; style a mixed group; align/distribute; reorder and check stacking.
Input focus must retain native typing/clipboard behavior.

Local history regression: move a pencil stroke, undo and redo, then delete it and
undo again. Verify its original stroke shape returns and unrelated items stay put.
After undo, making a new edit must disable redo; selection and camera changes must
preserve redo. Each completed gesture remains one undo step (up to 100 steps).

# Graphics playground (local development)

The scene foundation is shared by the graphics and image demos. The graphics demo
adds a circular **Rotate selection** handle 16 screen pixels outside a single shape's
oriented top edge, or above the world-aligned bounds for groups and multiple selections,
with no connecting stem. Single shapes retain oriented solid
boxes; groups and multiple selections have dashed world-axis-aligned boxes.
Click-drag their interiors to move the selection. Resize grips stay square, with
fixed EW/NS edge cursors and diagonal corner cursors matching their world-space
quadrant. Drag the circle to rotate; hold **Shift** to snap a single
shape/group's world angle to 30° increments. Multiple selections snap the rotation
delta, preserving relative angles.
Shift can be pressed or released during the drag, including while stationary.
The edit is one undo step. The shared selection box and all transform handles hide during move,
rotate, and scale previews, then return on release or cancellation. Individual
outlines remain visible. Drag a shared corner to scale the selection about the
opposite corner. Shared corner and edge resizing stretch independently when all
descendant axes align with the selection frame (including quarter turns).
Incompatible rotations or shear force proportional scaling for the whole selection.
Resizing continues through zero, reflecting the crossed axis. A tiny nonzero
minimum at the crossing keeps scene transforms invertible. Rectangle corner
handles follow its transformed corners. Hold **Shift** during single-shape corner resizing to
preserve its starting aspect ratio. Hold **Alt/Option** to resize from the center;
combine both modifiers for proportional resizing from the center. Modifiers
can be pressed or released during the drag, including while the pointer is
stationary. Alt/Option also scales groups and multiple selections around their
collective center. **Group** combines selected siblings; **Ungroup** restores
their children to the parent. Groups can nest and contain rotation/nonuniform
scale. Ordinary canvas clicks select the outermost group; Alt-click selects the
hit rectangle directly. **Fit scene** brings content and handle space into view.

Expand **Layers** in either graphics demo to see the scene tree in back-to-front
order and select nodes directly. **Send to back**, **Send backward**, **Bring
forward**, and **Bring to front** reorder the selection within each node's parent.
Multiple selected nodes keep their relative order, and groups move as contiguous
subtrees. Reordering is one undo step; selecting or transforming a shape keeps its
document layer position. The document stores stable fractional sort keys rather
than array indexes or CSS z-index values. **Reset test scene** rebuilds the demo
from its seed script, clears history and selection, returns to Select, and resets
the camera (fitting the nested demo). Reloading also recreates the seeded data.
Test documents stay in memory: there are no schema versions, migrations, or local
storage saves. Saving/loading and multiplayer remain separate checkpoints.

Open `/app/component/nested-scene-playground` for the scene graph tester. It starts
with a rotated/scaled outer group, a rotated inner group, three descendants and a
root-level sibling. Expand **Layers** to see the indented hierarchy and select
any node directly, then collapse it to edit on the canvas. **Move selected to root**
reparents while preserving the world pose; Undo restores the prior parent and
order. Reparenting and grouping must not remount unchanged rectangle components.
All demos are local, in-memory; reload resets the seeded scene.


The image variant is `/app/component/image-markup-playground`. It loads the bundled
`teo.png` automatically. Drag over the image
to create an annotation. Reverse drags work; ends are clipped to the image bounds.
Scroll or use the zoom buttons to zoom around the image center. Panning is disabled;
the image stays centered on zoom and viewport resize. **Fit image** fits it in view. Escape cancels a drawing. **Clear rectangles**
removes annotations; **Replace image** starts a fresh scene after successful decode.
Invalid files leave the previous image intact. Files and annotations stay local and
are discarded on reload. There is no save/upload, selection or resize yet.

Open `/app/component/graphics-playground` on a local frontend server.
Use **Select** to click a shape and drag it, or drag a visible corner handle or anywhere along an edge to resize.
Unfilled rectangles and ellipses are picked only within 3 screen pixels of their outline at
any zoom; their empty interiors let clicks reach shapes beneath. Filled shapes
also accept clicks inside. The orange seed rectangle is filled; the other two
seed rectangles and newly drawn shapes have no fill. Box selection tests the
whole shape, including its interior, but excludes empty corners around an ellipse.
Drag empty canvas to select all shapes the box touches; Shift-drag adds to the
selection, and Shift-click toggles individual shapes. Drag a selected shape
to move the group; Delete removes the group in one undo step. Escape during box
selection restores the previous selection. Multiple selection and persistent groups expose visible corner handles and invisible full-edge resize targets; scaling
is one undo step and preserves relative placement, including nested descendants. Click empty canvas to deselect. **Rectangle** and **Ellipse** draw their respective shapes anywhere in the
infinite world. Ellipse previews follow the curve; ellipses support the same
move, resize, rotation, multi-selection, grouping and history as rectangles. **Delete** (or Delete/Backspace while the canvas is focused) removes
the selection. Escape cancels an active gesture; otherwise it deselects.
**Undo** / **Redo** also support Ctrl/Meta-Z, Ctrl/Meta-Shift-Z and Ctrl/Meta-Y while
the canvas is focused. Creation, moving, resizing and deletion each undo as one
operation. Camera and selection changes do not enter history; a new edit clears
redo. This is local, in-memory history, discarded on reload.

Open `/app/component/graphics-playground` on a local frontend server. This
registry-mounted experiment shows three seeded rectangles, an infinite grid,
camera position and zoom. It has no persistence or document creation effects.

- Scroll to pan; Ctrl/Meta-scroll zooms about the pointer.
- Focus the canvas, then Space-drag, or use a middle-button drag, to pan.
- Zoom buttons use the viewport center. Reset view returns to 100% at camera 0, 0.
- Each split owns its own camera and local scene.

### Graphics multiplayer playground

Open `/app/component/graphics-multiplayer-playground` on the local frontend. Alice
and Bob render independent Loro replicas of the same seeded scene side by side.
Each panel has Select/Rectangle/Ellipse, Fill/No fill, Delete, Group/Ungroup, Fit and
its own Undo/Redo. Expand Layers to select nested nodes, reorder, move to root, or
move the selected node into an eligible group. Canvas pan/zoom, selection, resize
and rotation use the same controls as the infinite canvas playground.

Go offline stops delivery. Make different edits in the two panels, then Sync now
to deliver the queued bytes while staying offline, or Reconnect to resume automatic
delivery. Delivery delay simulates batching latency; the status shows queued and
delivered update counts. Gestures sync on release. A remote commit cancels an active
local preview. Undo affects local history; same-property conflicts follow native
Loro undo behavior. The adapter notes document the provisional reparent/move policy.

While connected, each panel shows the other peer's colored cursor/name, dashed
selection outlines and tinted ghosts of pending drawing, movement, resizing or
rotation. Dragging a selection box also shows a remote marquee. Try selecting a
shape in Alice's panel, then dragging it slowly: Bob sees Alice's pending position
while the committed shape stays put until release. Pan/zoom Bob independently to
check that awareness follows his camera. Escape clears a gesture preview.
The cursor has a rounded name-only badge; no action/status text or detached label
appears on the selection. During transforms, the ghost supplies the outline.
Cursor and preview updates debounce for 40 ms (100 ms maximum during continuous
movement), and the receiver spring-smooths their motion between updates. Release
and cancellation clear ghosts promptly. Reduced-motion settings disable smoothing.

Awareness does not edit the document or local selection, intercept clicks or add
undo steps. Delivery delay applies to presence too, with intermediate messages
coalesced. Go offline immediately hides remote awareness and drops its pending
messages; Sync now while offline syncs documents only. Reconnect publishes fresh
presence. Document update counts exclude cursor/selection/preview messages.

Reset both peers recreates the scene and clears histories, selections and queued
updates. Reload also resets everything. This is a local-only component registry
demo: no document files, storage, SyncService, or backend data are created.

### Canvas Next rich text (local)

In `/app/component/canvas-next`, choose Text (T), then click empty space for
auto-width text or drag horizontally for a wrapped box. Type normally. Use the
Text formatting toolbar for inline marks, headings/quotes, lists, links and
alignment; the left inspector controls font family/size and auto width.
Double-click a text shape, or select it and press Enter, to reopen its editor.
Escape, Cmd/Ctrl+Enter, Done, or clicking elsewhere commits one canvas history
entry. Inside the editor, Cmd/Ctrl+Z undoes typing without undoing canvas shapes.
Empty drafts leave no item. Clearing existing text removes the item on Done;
canvas Undo restores it. Canvas Next owns these empty-content decisions. Clipboard
fragments and saved scenes with invalid editor payloads are rejected by the host.
Side edges wrap text without changing font size;
corners scale it proportionally. Text can be copied, duplicated, grouped, layered
and transformed with other shapes. Only the active editor is contenteditable.
While editing text or labels, the editing box has no outline; the caret and native
text selection remain visible. Selection bounds return after finishing the edit.
To label a rectangle or ellipse, double-click inside it (filled or unfilled), select
it and press Enter, or choose T and click it. The same rich editor opens inside the
shape; labels start centered and wrap to its interior. Smaller shapes uniformly fit
the label. Font controls apply to the active or selected label. Clicking a label
selects the shape; deleting all label text removes only the label. Copy/duplicate,
grouping, rotation, and resizing keep it attached. Verify native text paste does not
create an extra canvas item, and finished label edits undo in one canvas step.
Text and labels now use the shared Markdown builder and store serialized Lexical
JSON strings. Select text to expose the shared floating formatting toolbar; alignment
and Done are above the canvas. The Loro adapter merges completed edits as one LWW
string, separately from pose. Canvas Next is still local-only; Reload/Reset demo
discards text and labels along with other shapes.

Type `@` while editing text or a shape label to open the shared mention picker.
Search and pick a person/document/reference using the mouse or arrows and Enter.
Escape dismisses the picker without finishing the text edit. Verify the mention
renders after Done, reopening, and shape copy/paste. Mention-only text is valid
content. The local demo does not track references or send mention notifications.
Task mention badges and avatars follow the text's font size. Verify a horizontal
corner drag shrinks text smoothly, Option/Alt preserves the center, and a side-edge
drag changes wrapping at a fixed font size. Corner scaling preserves line layout.

### Canvas Next arrows and connectors (local)

In `/app/component/canvas-next`, use A (Arrow) or L (Line), then drag
between empty points or shapes. Only the hovered shape shows attachment targets:
small white circles with blue borders at its center and four edge midpoints.
The active point gets a larger pale-blue halo, before the initial click as well
as while dragging either endpoint. Nearby edge points win; farther inside the
shape's core, the center is active even for unfilled shapes. Leaving the shape
hides its points. Hovering its rim away from a point shows no active halo.
Center attachments automatically meet the shape outline. Side attachments retain
that edge midpoint as the target moves, rotates or resizes.
Pencil strokes expose no attachment targets. Starting or dropping an endpoint over
ink leaves it free; an eligible shape underneath the ink can still receive it.
C opens the app's Create menu. For a rounded connector, choose Elbow in the
Connection inspector.

Select a connector to show its start/end circles. Drag either circle to reattach,
or release over empty canvas to detach. Shift constrains a free end to 45-degree
increments. Escape cancels without writing history. The Connector inspector offers
Straight, Elbow and Smooth routes, and None, Arrow, Filled arrow, Dot and Small dot
for both ends. Each completed endpoint drag is one undo step. Dragging the path
moves free ends; bound ends stay attached.

Check target movement during its preview, reconnecting either end, undo/redo, and
copying connected shapes together. Copies should connect to copied targets; copying
only a connector should detach it at its visible endpoints. Deleting a target
leaves the connector in place, and undo restores its binding. Reset/reload discards
all demo data. Connector labels and remote endpoint-drag awareness are not present.

### Canvas Next media and document cards (local)

In `/app/component/canvas-next`, Add media offers an upload input and a searchable
list of existing workspace images/videos. Selecting an existing file inserts its
reference without uploading again. File drop and pasted images use the same
insertion path; uploads go to the existing static-file service. The scene itself
remains disposable. Select a video and use Play/Pause video in the inspector.

Add document inserts workspace files as compact 340 × 136 preview cards, one
surface layer above the canvas and at the front of the scene. Select a card and
use Open document to navigate to its source. Preview text stays at `text-base`
when resizing; titles and controls are clickable, and dragging its background
moves the card. While loading, the card keeps its frame and shows a pulsing icon
dot plus two text skeleton lines in the header positions; shared DocumentPreview
popups use the same skeleton. Workspace entity drops insert
images/videos or document cards as appropriate; pasted Macro links create cards.

Verify move/resize/rotate/flip, grouping, layer order, copy/paste and undo work for
these items; failures show in the status line or the individual preview. Reset demo
cancels pending insertion. Reload resets the scene and does not delete any uploaded
file. SVG files render as media, not editable imported shapes.


### Canvas Next full embeds (local)

Add embed lists existing Markdown documents and canvases. Insert one, then choose
Interact (or double-click the inactive editor) to use its full editor inside the
card. Done, Escape, or clicking elsewhere on the outer canvas exits interaction.
The inspector switches a supported reference between preview and full embed.
Verify that embedded clicks, text selection, scrolling, and clipboard shortcuts
do not move or paste into the outer canvas. Verify resizing reflows the viewport,
enter/exit preserves the mounted editor, and undo/copy preserve the reference and
presentation. Preview title and Reference actions should work even with the card
selected; a transparent selection overlay must not intercept them.

These are real existing editors using their existing permissions and sync. Edits
inside an embed change the source file; use disposable test files for edit tests.
The outer Canvas Next scene still resets on reload. Supported full embeds are
currently Markdown and existing Canvas documents.

Legacy canvas drawing under outer zoom/rotation/flip still needs coordinate-mapping
work. Do not treat the successful mount/pan checks as transformed drawing coverage.
