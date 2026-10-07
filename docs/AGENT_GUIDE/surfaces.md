# Other Surfaces

## Home list loading

Home shows compact row skeletons during initial loading, with taller notification
placeholders on touch devices. Date grouping includes a placeholder heading.
Pagination appends three placeholders without replacing existing items; refresh
keeps loaded items visible. Wait for real rows before navigating or selecting.

## Top bars

Low-emphasis right-aligned split-header actions (including Calendar's touch/preview
New event and Channel's idle Call and Ask Macro) are borderless with a rounded-xl
background on hover. Emphasized variants retain their treatment, including an
active call's green ink and outline frame. Channel, company, contact, and project
content tabs use inset controls in the top bar. Button sizes do not change variant colors or framing; individual
framed controls default to glass on touch and flat on desktop. Use `glass={true}`
to enable glass on all devices, or `glass={false}` to disable it everywhere.
Embedded and low-emphasis actions use `ghost`; inline calendar-invitation text
actions remove the transparent border to keep their text alignment.

## Dialog actions

Cancel uses a ghost button. Confirm, save, and create actions use strong: the
outline surface and border with semibold text, without inverted colors. Disabled
and pending primary actions retain the strong variant. Mobile confirmation drawers
use the same action hierarchy.

## User cards

Avatar and user-mention cards open on hover on pointer devices and as a bottom
sheet on touch devices. With a keyboard on a touch device, Tab to the trigger and
press Enter or Space; verify focus enters the sheet and returns to the opener
after dismissal or copying, including after reopening. DM, Open contact, and
Assign task should leave focus in their destination when the sheet closes.
On pointer devices, avatars should stay out of the Tab order while still opening
their cards on hover. Copy email/name confirms only after the clipboard
write succeeds: the hover card shows a checkmark, while the sheet closes. A failed
write shows failure feedback and leaves the card open for retry.

## Canvas colors

To check the default canvas color, create a rectangle and a text box without
changing the swatch. The rectangle should have a light neutral fill and a dark
outline; the text should be dark and visible. Also check the neutral swatch after
selecting another color. Neutral colors use an OKLCH `none` hue, which must render
as gray rather than transparent.

## Canvas link paste

Pasting a supported routed Macro app link onto the canvas creates a text
node with an entity mention, as legacy links do. Routed links retain compatible
block targets, but not workspace paths or pane-local search state; unsupported
links remain text.

## Live updates in flat Soup lists

The normalized cache retains at most 64 flat/grouped Soup page snapshots per
viewer, with a combined 512 KiB encoded budget. Older pages can require a network
refetch when revisited; normalized entities and queued offline edits are not
removed. Backfills hydrate entities/indexes without retaining their pagination
wrappers. Existing oversized viewer records compact once on a compatible open,
without resetting storage generation or pending mutations. To verify, load many
pages, revisit an evicted page online, and confirm an offline property edit still
replays after reopening the app.

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
To check reconnect behavior, load a non-Mail list online, let background hydration
advance its cache while offline, then reconnect without delivering a fresh network
response. The newer local result must remain visible; connectivity alone must not
restore the older network snapshot. A fresh network response can take authority again.

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

The Mark done action (`e`, row menu) hides its rows at once from GraphQL lists that
exclude done items, such as Email Important/Noise and Home Signal, without waiting
for the server. Email All keeps the row and flips its done indicator immediately.
GraphQL Undo is offered as soon as Done applies locally, even while its initial
write is pending. Undo restores the row and focus immediately; its server write
waits for the initial outcomes and uses only acknowledged notification IDs.
A late Done reply must not settle or overwrite the newer Undo display intent.
Undo also restores a previously admitted row after the cache has removed it,
without waiting for the reversal's server reply; changing filters/sort clears
those view-local restoration snapshots. Home's separate recent-activity inclusion
rules are unchanged. Test Done/Undo/Redo with delayed replies and verify both flat
and grouped rows/counts. A failure must roll back only its own local intent.
Test mixed committed/queued/rejected archives and notification writes,
including an archive that fails while its notifications succeed (and vice versa). Accepted writes retain Undo; rejected siblings must neither
reappear in its request nor be retried by Redo. Partial feedback keeps an Undo
action. A reply with no matching notification IDs must release that target's
optimistic hide and notification overrides immediately, even if Undo was never
clicked and mounted readers remain stale. Do not wait for acknowledgement or a
timer when there is no receipt. Accepted siblings keep their own display intent;
a no-op target cannot borrow their IDs to restore its row. Mixed accepted/no-op
results replace the optimistic full-count toast with the actual completed count
and retain Undo for accepted writes. An empty notification receipt alone must not
make a successfully archived email or completed reminder look partially failed.
Partial Undo/Redo failures retry only the failed writes.
If every initial write fails, retire its pending Undo/Redo entry and unwind both
Done and any early Undo overrides. Disposal or clearing history while a reversal
is pending must not resurrect that entry when its response arrives. Also delay
Redo, then perform a new action: the late Redo's success or failure must not
repopulate either history stack or show its stale completion toast. The next Undo
must still target the newer action; already-dispatched network writes are not
cancelled by this history fence.
Newer in-scope activity can re-admit a row, but loading an older notification or
activity in a separate channel thread must not. Redo targets the original exact
notification IDs, not notifications received since the original action. A newer
Done must win over an older retained overlay. Delay reconciliation past a minute:
pending/stale state must not simply expire and resurrect the row. Once committed,
mounted cache readers must acknowledge the intent before its overlay is released.
GraphQL display intents are scoped to the authenticated viewer and login session.
Login/logout retires old buckets; even same-account native reauthentication must
not let old overlay Undo/Redo handles or a late refresh republish old intent.
Verify account changes with overlapping entity IDs and a pending/failed refresh.
After a successful Done, verify that the row stays gone after a reload.
Test GraphQL list optimism independently of REST: block REST Soup, email-thread,
and user-notification data endpoints before page initialization, then confirm
GraphQL alone populates the list. Hold GraphQL mutation replies while testing
Done/Undo/Redo and rejection: row feedback must not depend on REST cache reads,
patches, cancellation, or invalidation. Auth/account metadata is outside this
row-data boundary. Test the REST path separately, not as a GraphQL fallback.
Email Reminders contains original email rows: Done archives those conversations,
with the same immediate GraphQL Undo behavior as the other email tabs.
In Tasks, Email, Home and Drive, rows keep their DOM when the list updates. A
property edit or a rename updates the edited row in place instead of rebuilding
every visible row. To verify, watch the row nodes with a `MutationObserver` while
editing: only moved or removed rows should be added or removed. Rename a row and
then drag it: its drag label/payload must use the new fields without another
registration/layout measurement.

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

## Email reminder delivery

An email snooze returns its original conversation to the inbox and adds a
notification to that email row in Home. It has no separate reminder toast or
detail view. See [Email reminders](reminders.md#delivery-and-undo).

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

When `enable-tasks-reviews` is enabled, `Reviews` appears above `My Tasks` as a
shortcut to the separate Reviews view. It lists accessible GitHub pull requests;
Open/Closed tabs below search and filters default to Open; Closed includes merged
PRs. Status also remains in the filter menu. Custom multi-status selections hide
the tabs except for the combined Closed preset.
The list topbar says Reviews at narrow widths or with its sidebar collapsed;
selecting one opens `/app/reviews/pr/<foreignEntityId>` with a Reviews breadcrumb.
See [Tasks](tasks.md#reviews-view) for verification.

The desktop `Create` → `Task` modal uses the standard dialog panel, circular
icon controls, and a pill-shaped `Create Task` button with 16px outer padding.
The mobile task drawer retains its existing layout.

## Email — `/app/component/mail`

Email's Tags sidebar uses the same [nested tag tree as Tasks](tasks.md#nested-sidebar-tags).
Carets and folder-only parents expand branches; actual tags select their exact ID
and switch the mailbox to All. Parent selection does not include descendant tags.
Unlike Tasks and Drive, it lists only personal tags; team-shared tags are hidden,
and its `New tag` action creates a personal tag with no Team sharing option.

Full email client. Tabs: `Signal` / `Noise` / `Favorites` / `Sent` / `Scheduled` / `Calendar` / `Drafts` / `Shared` /
`Archived` / `All`. Compose via the `Email` button (or `Create` → `Email E`). On a fresh local user it
shows `Connect your email` (Gmail/Google Workspace OAuth) — most functionality needs a
connected account. Search is `Ctrl+F` within the surface.

`Favorites`, directly below Noise, lists starred Macro emails across Signal,
Noise, and archived mail. It respects the selected inboxes and filters; search
within the tab is also restricted to favorites. Removing a star removes the row
from this view. The tab persists across reloads. With `enable-graphql-soup` on,
the paginated GraphQL Soup query uses `favoritesOnly: true`. With the flag off,
REST Soup uses `favorites_only: true`. Starring changes membership without
changing the list query. Text search still resolves favorite IDs for the search
service. An empty favorites list shows `No favorite emails`.

`Archived`, directly before All, lists your own archived (Mail Done) threads: the
All mailbox with Done applied, excluding threads teammates shared with you. It
respects the selected inboxes and filters. The search service cannot filter
archive state, so search within the tab keeps only archived hits on the client.
Rows offer **Unarchive email**;
unarchiving removes the row at once. The tab persists across reloads. An empty
list shows `No archived email`.

On desktop, a favorited email keeps a filled, muted star just before its
timestamp. Other rows reserve only that small star slot. Hovering reveals
**Star email** (Macro favorites), **Archive email** (Mark Done, with Undo), and
**Open command menu** for that email. The star stays in place; archive and commands
replace the timestamp within its existing space. Archived rows offer
**Unarchive email**; the archive control is disabled in tabs that do not support
Mark Done. The icons also appear when a button receives keyboard focus. Clicking
an icon neither opens the thread nor applies the action to other selected rows.
Touch devices retain the swipe actions.
Search results use the same reserved column, with actions aligned to the first
line; snippets, highlighted matches, and expanded hits remain unobstructed.

When switching email tabs or inboxes, the list shows current-query cached results
or a scoped `Loading email` spinner until they arrive—not the previous tab's rows
under the new heading. Active searches also hide retained results and show loading
while selected tag sets are pending. Background refreshes retain the current list. To check this,
rapidly alternate Signal, Noise, and Sent, then change inboxes; a delayed cache or
network read must not leave the old rows visible or expose their Load more action.

Opening an email shows loading while its local draft identity and thread data
resolve. Verify a cold open and switching directly between threads with delayed
cache reads: neither should flash "Sorry, an unexpected error has occurred" or
show the previous email. A failed load must still show its error and Retry action;
reconciling an already-open offline draft must preserve its composer and text.
If local cache initialization fails, ordinary server threads must still load
through the session's uncached GraphQL client, including the thread being opened.
In that fallback, leave a thread open and mark it Done/Not Done from its list:
only the matching open thread refreshes through GraphQL after the committed archive
mutation, including its loaded message pages. Mark Seen/Unread and generic Soup
refreshes must not refetch open threads. Disabled/unmounted readers must not refetch.
Also delay cache initialization failure until after the first identity lookup fails:
an uncertain server route must then load and participate in archive refreshes,
while a positively identified unsynced local draft must never be sent to the server.
Keep already-resolved server aliases through that fallback. With the normalized
cache active, the shared email record updates the thread without an extra network
refresh. Neither path relies on REST thread-cache invalidation.

If a saved inbox selection references an unlinked account, successfully loading
linked accounts resets the filter to All inboxes while preserving an open or
restored thread. Check this with a stale saved scope and a thread route, including
when no linked accounts remain. Explicitly choosing another inbox or All inboxes
still closes the thread.

The new views reuse the legacy filter option rows and searchable submenus.
Their triggers are icon-only buttons matching the surrounding view controls;
Clear/Reset filters and the mobile Clear all action use destructive text styling.
Both layouts show a small accent dot beside categories with active refinements;
default All selections are not marked.
Email Status and Done are single choices that close the menu; attachment filters
stay open for multiple selections. Tags supports search, pins selected tags first
on opening, and is omitted when no tags exist. **f** opens the filter menu.

### Read state and trash

In the Email view, Status filters discovery on the server **before pagination**,
for both the mailbox list and service-backed search. With Unread selected, opening
or marking an admitted row read keeps its position across refreshes. Separate
lookups, bounded to 100 already-admitted thread IDs each, omit only the read filter;
they still enforce the tab, inbox, other facets, and (for search) the search text.
A snapshot bridges a pending lookup, but a confirmed non-match removes the row,
so archive/trash cannot be resurrected by retention. Changing the search text,
filters, tab, inbox, or user resets admission. Check that unread mail is discovered
even after 100 newer read threads, then verify focus through Mark Read and refresh
in both list and search, including with more than one loaded page.

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
The GraphQL-disabled REST path is unchanged. With GraphQL enabled, archive-based
Mark Done, Mark Not Done, and Undo/Redo use `setEmailThreadArchived`: `inboxVisible`
updates optimistically in the normalized cache, and each reversal is a distinct
ordered queue entry. The server resolves the thread's owning/delegated inbox;
no client INBOX-label lookup is needed. Confirmed writes revalidate mounted lists,
including continuation pages; queued writes retain those descriptors for replay
without refetching over optimism. Callers preserve the queued disposition and
skip REST/TanStack email invalidations as well, including Done/Undo batches and
thread archive replay. Committed writes and failed non-queued batches still
reconcile. Permanent failures roll back the failed intent.
Check Signal/Noise removal and All's done indicator, then Undo/Redo, including an
offline action followed by reconnect. Also wait for provider/metadata synchronization
before Undo, and repeat after reloading: an archived received thread can lose its
inbox-sorting timestamp but must still be unarchivable. Sent-only threads and
unsent drafts cannot be unarchived; sent mail addressed back to its sender can.
With GraphQL Soup enabled, bulk Mark Not Done settles per email: a rejected
sent-only/draft thread stays done, while successful and durably queued siblings
remain restored. Only accepted
threads get their notifications restored. Notification or list-refresh failures
warn without rolling back accepted unarchives. Verify mixed committed/queued/
rejected selections, partial-success counts, and that a queued sibling prevents
shared-list refetch even when notification restoration fails. GraphQL reversals
rely on normalized writes and their durable revalidation, not an extra REST Soup
refetch after rows settle. Verify the open-thread header too: with GraphQL enabled,
Mark Not Done remains available for an archived thread whose inbox timestamp is
missing; the server decides whether its received-message history allows restoration.
The REST path retains its timestamp preflight, whole-batch handling, notification
ordering, and existing cache reconciliation.

The service retains both replica-backed Soup reads and a primary-backed email
writer. Email mutations and their uncached reply reloads use the primary; ordinary
GraphQL/REST lists, direct Soup lookups, and realtime Soup hydration use the replica.
A mutation reply is fresh, but subsequent list refetches are eventually consistent
and can still return replica-stale read/archive state. Test that boundary separately
from mutation reply correctness. GraphQL application errors, including a failed
post-commit reply load, release the queued mutation rather than retrying forever.
Transport failures retain the existing retry policy. Draft recovery preserves local
content and offers explicit Retry using the original handle. Deploy
the backend schema containing `setEmailThreadArchived` before this client.
Browser WASM and native cache builds must include the regenerated schema metadata;
native offline archive support therefore requires a full app build, not just OTA.

### Cached Mail filtering

Performance check: switch Signal → All twice against a large synchronized cache.
Dense local pages use bounded sort-index candidates rather than sorting the entire
mailbox. Sparse filters and large timestamp ties retain the exact fallback plan.
A filter result, row fragments, and final revision that agree must be accepted even
when background hydration advanced past the revision observed before the request;
that alone must not trigger another filter scan. Also verify local Load more,
same-timestamp ordering, and pending archive/read changes.

With GraphQL caching enabled (browser or native Tauri) and the email metadata backfill synchronized,
All, Signal, Noise, Drafts, Sent, Calendar, and Shared support tab changes and new
filter combinations while offline: account selection
(including delegated inboxes), read/unread, and archive-based Done/Not Done. Mail Done
means `inboxVisible = false`; it is **not** notification lifecycle state. Signal/Noise
retain their Inbox scope, so archived mail is found in Archived (All + Done).

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
`/app/component/mail`; the view breadcrumb (for example Signal) has a hover
background and returns to the filtered list. Pressing `Escape` in the open thread
with focus outside any input does the same once there is nothing left to unwind
(an open reply, an expanded body, or a focused message each take one `Escape`
first); the list keeps the row you came from focused. The inline header uses the existing
email title menu: open the menu button beside the subject for **Ask AI**, **Create a
Task**, and the other thread actions. On desktop, **Mark as unread**, **Mark done**,
and **Previous item** / **Next item** sit at the right of that header. The arrows
follow the current filtered list and disable at its ends. Mark done advances in
that list. Mark as unread (in the header or title menu) returns to the originating
list with its tab, inbox, and filters preserved. Mark as not done and Mark as read
stay on the current thread.
Opening a saved draft from **Drafts** keeps the subject breadcrumb, title menu,
and applicable header controls visible above the composer. Verify these remain
available when returning to Drafts and reopening the draft.
**Delete** in the title menu moves the thread to Trash and returns to the same
filtered list. Its toast offers **Undo** to restore the email.
Verify that opening the title menu, returning to the list, and reopening a thread
preserve working menu actions and header controls. Repeatedly navigate forward
and backward, including after returning to the list: the subject and email body
should remain visible without reloading.
Shift-click opens a standalone split at `/app/email/<thread-id>`, which remains
the destination for direct links and legacy surfaces. Click a message header to
expand or collapse it; `Show N hidden messages` reveals the collapsed middle of
a longer conversation. A standalone link with
`?email_message_id=<message-id>` loads older pages as needed, expands the target,
scrolls it into view, and briefly highlights it. For navigation regressions,
exercise both a recent message and one outside the first page. Open another
target while loading or highlighting: the previous request must not scroll the
new thread or clear its highlight. Closing the split cancels pending positioning.
The load gate and message body share one live thread source in both hosts. Cached
body rendering should not wait for a second thread fetch, optional References,
or inbox metadata. Inbox-dependent actions stay gated while ownership is unknown;
explicit inbox IDs must never silently route to primary while links are loading.
Background refreshes and older-message loading still update the same thread.
Verify with API traffic delayed and with previously opened bodies offline.
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
compose also flushes pending edits when leaving through app navigation. Switch
views immediately after typing, before the 500 ms autosave debounce: the old
thread must close, further navigation must work, and reopening must retain the
last edit. Repeat with an existing draft and a new reply. During
mobile Save Draft navigation, a failed local flush is reported and keeps the
back menu and editor open with their contents intact. After another edit saves
successfully, Save Draft can leave the composer. Reopen an existing reply after
clearing its body: the saved empty body must not restore the original quoted HTML.
During send or discard, its sender and scheduling controls cannot change the operation.
Attachments that can be opened are buttons named by their filename; Tab to one
and press Enter or Space. Removal is a separate button named `Remove <filename>`.
Removing a forwarded file keeps the received original.
When checking draft autosave, edit the body of a draft with uploaded or forwarded
attachments, wait for the save, and reopen it; the attachments should remain visible.
AI email tool drafts persist body-only edits; changing recipients or the subject
is not required to save the body.

With GraphQL draft queuing enabled, working copies and pending attachment bytes
are saved on this device independently of the mutation queue. A failed server
save must leave the draft discoverable in **Drafts** (including grouped views)
and in its reply thread. **Draft saved** sits immediately left of the desktop
delete button after editing pauses for 500 ms and the latest local save completes,
then fades out after two seconds, including offline saves. Resuming typing hides
it immediately; another pause and saved version restart the timer. Background
sync updates do not. Failures replace it with persistent **Retry** in the same place; hover for details.
Clicking Send must not show the badge for its preparatory draft save, including
when delivery fails. Later edits can show it again after the usual pause.
Verify the label does not cycle through saving/syncing text on each edit and
that retry remains accessible beside the actions on mobile. Editing while failed
continues saving locally without repeatedly submitting the rejected request.
Repeated local-save failures show one persistent warning per composer; recovery
or closing that composer dismisses it. A later failure shows a new warning.
Retry preserves the original draft handle. An already-sent rejection drops the
local copy rather than recreating the sent message. The REST compose path keeps
its existing behavior.

Native draft recovery requires a full app update containing queue inspection and
durable mutation metadata support. An older app receiving an OTA bundle shows
**Macro update required** and uses the existing uncached fallback. Its old queue
must remain intact, with no new claims or queued writes, until the native update.
When the cache becomes unavailable, draft saves and discards must not bypass its
preserved queue through GraphQL or REST fallback. Local editing stays durable;
reload or update the app to resume server sync. Verify this after a native
upgrade-required error and a worker initialization failure; ordinary reads still work.

For recovery verification, reject a draft save with a GraphQL error (including
legacy `retryable: true` metadata), then perform an unrelated queued action: the
failed save must release the queue. Reload and reopen the draft; verify subject,
recipients, body, and pending file contents. Retry and check that exactly one
server draft exists. If per-mutation recovery preparation fails or times out,
the mutation must fail and release the queue too, including legacy drafts that
have not been copied into recovery storage. Existing local working copies remain;
an unmigrated legacy edit can be lost if the queue held its only durable copy.
Verify that an unrelated queued action still completes in both cases.
Repeat with two tabs, a save response arriving after a newer
edit, an attachment upload completing during another local save, and Discard
while an attachment snapshot is still being saved. A snapshot based on an older
local revision must fail without replacing newer content or files, including
when another tab saves first. Reopen the draft to use the latest version.
A completed discard must not resurrect on reload. A clean,
fully synchronized local copy must not hide newer server edits or sent state.
While online, create a disposable reply, wait for its server identity, discard
it, then leave and reopen the thread and reload. Its local body and attachment
bytes must be gone and the server draft must stay deleted. Repeat with a second
tab holding the same draft under its server ID: a delayed save from that tab must
not recreate the discarded working copy. Repeat after Undo revives the draft:
the old tab must not overwrite the restored copy even when revisions match.
A newly composed reply still saves.

For offline replies, use a received email so recipients come from its contacts.
Type a reply, leave the thread, and reopen it while still offline; repeat both
immediately after typing and after waiting for autosave. The reply body and
recipients must remain, including after reload. Delay local draft discovery while
the cached thread is available: the reply editor must wait for the recovered
draft before it can accept edits. When several local replies target the same
message, reopen the most recently edited draft. This exercises the real form-to-
storage boundary as well as queued saves; plain hand-built save inputs alone
do not cover it.

Explicit sign-out warns before removing unsynchronized local drafts and files.
Cancel must retain them; confirm must clear them and fence in-flight work so the
next account cannot see them. If local storage cannot be inspected, sign-out must
still offer a warning and a way to continue. Do not verify this by deleting real
user drafts; use disposable drafts in an isolated test session.
The three-dot button beneath a body reveals quoted content and a trimmed
signature. Plaintext and Macro Markdown use the existing Markdown renderer;
Macro Markdown messages retain document mentions. Ordinary HTML bodies use an
open shadow root: Playwright text locators can reach them, but a card's ordinary
`innerText` or `querySelector` does not traverse that root.

Sending a reply from an inbox thread marks that thread done but stays on it;
only the explicit Mark done action opens the next email.
Sending a message shows it in the open thread immediately, while delivery is
still pending. It stays visible until the thread refresh confirms it, with no
duplicate message. Failed delivery removes that message and restores the reply
draft; a successful Undo Send removes it and reopens the draft. This temporary
thread display uses the existing REST delivery path.
Sending must leave the new message's reply composer closed. After delivery,
focus belongs to the sent message card in the same thread pane, even while
the thread refresh is still pending. Replying again requires clicking Reply
or using a reply shortcut.

After a successful send, the `Email sent` notice offers `Undo`. Undo restores the
sent envelope and editable content, including when the reply used another inbox;
a slow background refresh must not keep the restored editor disabled. A rejected
send reports failure and restores its original reply editor if it is still mounted.
A failure from an older, unmounted editor must not overwrite a newer edited reply.
A presentation or refresh error after successful delivery is not a reason to send
again. After the undo window and provider acceptance, send finalization supplies
any missing delivery timestamp before publishing the realtime update. The cached
Sent list must therefore admit the message without waiting for Gmail inbox sync
or an online visit to Sent. Verify by sending from another Mail tab, receiving the
final sent update, then switching offline and opening Sent. Existing provider
timestamps and timestamps from repeated finalization remain unchanged; an unsent
or cancelled draft must not acquire Sent membership.

Send and schedule are refused with a notice while the device is offline, while a
draft is still syncing (its save was accepted locally but not yet confirmed by the
server; retry after a moment), or while an attachment has no completed upload. The
composer keeps its content in each case. Attachments cannot be added while
offline: a blocking notice explains and nothing is attached.
For a new standalone email, a failed REST draft save is best-effort: Send can
still proceed without a draft ID when no save was queued and no attachment is
waiting to upload. A server rejection blocks sending even an existing draft.
GraphQL draft saves automatically retry only network failures. GraphQL errors,
including internal, invalid, and unauthorized errors, fail the mutation and
release the queue. The local working copy offers explicit Retry; Send stays
blocked until a save is confirmed.
A successful save response with an invalid cache identity binding still commits
its normalizable server data and reports a cache diagnostic without replaying
the mutation or asking the user to save again. If that response also cannot be
normalized, the attempt stops retrying and reports a permanent cache failure.
If a queued GraphQL save is permanently rejected after reconnect, the draft status
offers **Retry** using the original draft handle and latest locally saved content.
Further typing saves locally without retrying the rejected write. Verify that
pending attachment bytes survive reopening and that a reply stays in its
conversation.
An already-sent rejection after reconnect follows the same path as an immediate
already-sent response: announce that the email or reply was sent, clear the local
composer, and cancel pending autosave. It must never offer Retry for that draft.
Verify this in standalone and reply composers, including a queued edit awaiting
its debounce and a failure racing the first identity read. A settlement for a
previous or different draft must not clear the current editor.
Repeat with the composer closed before reconnect: terminal queue failures must
refresh the saved thread and list queries without requiring an open editor, so
an already-sent draft does not remain in Drafts solely because nobody observed it.
With cached inbox metadata available before viewer information loads, saving a
new offline draft must still create its Mail thread. The selected inbox supplies
the owner, including delegated inboxes. If that account metadata is unavailable,
the save must fail before queueing; retain the editor content for a later retry.
Test this with a previously saved draft as well as a new one: a queued edit must
block Send and scheduling until a save commits. Reopening a cached draft while
offline must retain its uploaded attachments and confirmed scheduled time.
Open a reply draft while its durable identity read is still pending: REST lifecycle
reads and attachment actions must wait for confirmation. Editing keeps the seed ID
as a handle; a committed cache read or save unlocks server-only actions. A failed
identity read must not mark a queued draft committed. Verify an autosave failure
shows one notice in both standalone and reply composers. If the live mail transport
switches to GraphQL while the editor is open, queued saves must still adopt their server
identity after settlement without replacing the editor's current text.


With the persistent GraphQL Email cache enabled, a new standalone draft saved
offline appears immediately in Drafts and the other matching Mail tabs, including
date-grouped lists. A draft changes a conversation's preview, read state, and sort
time according to that tab; discarding it restores the remaining conversation's
metadata. `Showing cached mail` still means only synchronized and locally created
items are available.

Verify the durable lifecycle: create a standalone draft offline, enter recipients,
subject and body, close the composer, then restart while still offline. Open it
from Drafts and confirm its content and sending inbox; edit it again. Reconnect
and check that exactly one draft remains and the open editor keeps any new text.
On a cold app start, reopen a local draft thread before another GraphQL query has
initialized the cache. Its subscription must observe settlement and adopt the
server ID. If its identity read fails, it must remain cache-only until a later
cache event resolves it; never send the unresolved handle to the server.
Keep a reopened offline draft open while reconnecting: the composer must remain
mounted when the local thread handle resolves to its server ID. After syncing,
reopen the original local thread URL and confirm the composer still loads; then
open a different thread and confirm the previous draft is not shown there.
Reply from a different sending inbox, save, and reopen the original conversation:
its original messages must remain there even if the reply belongs to a new thread.
Repeat after changing the sender on a saved reply; neither conversation may become
an alias for the other.
Throttle the next email's response while navigating within the inline detail:
the previous subject and composer must disappear during loading, and the new
thread must not be marked read using the previous thread's sending inbox.
Make multiple edits while offline, reconnect, wait for syncing to finish, then
send. Repeat after refreshing with queued edits: the first attempted save must
recover its server identity and let newer saves complete, rather than leaving
Send permanently blocked by "Draft still syncing".
After restarting offline, reconnect and visit Signal and Drafts. The queued draft
must stay visible when the first server list arrives, including in date-grouped
views, until its save settles; it must not briefly appear and then disappear.
Repeat with discard before reconnect, including a save that was already attempted
before connectivity dropped. The discarded draft must stay absent after restart
and reconnect. Opening through an older local thread link must reach the same
server thread after synchronization. Repeat with an existing reply and confirm
that other messages, attachments, and the Sent preview remain intact.

With GraphQL Mail enabled, discarding the last draft in a thread must remove the
thread from every local Mail view, including after queued replay. Discarding a
standalone draft from its composer returns to the previous list after deletion
is accepted, including offline; a failed deletion keeps the composer open.
Check both the toolbar trash button and the mobile Delete Draft action.
In Email's inline detail, deletion closes the detail and preserves the current
mail tab and filters; it must not navigate split history to an older composer.
Discarding a reply draft must preserve the remaining conversation. A previously
cached thread that the server no longer has must leave the lists after opening it or receiving
a 404 while changing its labels; a cached record must not override the server's
not-found response. Check the same behavior after REST discard. Offline/network
errors alone must never evict a cached thread.

Choosing or clearing a send time is local preparation only. The composer remains
editable and autosaves normally, shows **Scheduled send: ...** (the time and the
viewer's timezone, e.g. **Sep 25 at 8:00 AM EDT**) in a bar attached
below the composer (a strip along the bottom of the message card for replies), and
performs no schedule, unschedule, archive, or delivery request. The bar's **Cancel**,
at its far right, clears the local choice; the clock's tooltip reads **Schedule send
time**. The clock and
primary arrow remain icon-sized; the clock turns accent-colored when a time is
selected, while the primary action's accessible name and tooltip change from
**Send email** to **Schedule send**. Clicking it or pressing `Ctrl`/`Cmd`+`Enter
runs the same validation and is the only initial scheduling commitment. A selected
time that has passed is rejected at submission rather than falling back to immediate
send. Touch toolbars keep the summary inline beside their icons, with Cancel next to
the time; when space is tight, that summary truncates or wraps separately from the
fixed icon group. The
former picker-auto-commit behavior was a defect and must not be restored.

Only a successful scheduling response or authoritative lifecycle reconciliation
shows **Scheduled for ...**. Confirmed scheduled composers are content-locked.
Picking another time creates a local proposal while the original remains active;
the bar continues to show the original time plus the proposed replacement and
explains that the original remains active. **Update schedule** commits the proposal.
Clearing that proposal does not cancel the original. **Cancel schedule** is a
separate explicit action, and only its
confirmed success returns the message to an editable draft. Failed schedule,
update, or cancel requests retain the user's local intent and last authoritative
time, and never fall through to immediate Send. At narrow split widths the bar's
label truncates while Cancel stays at its far edge; the bar never covers discard,
attachment, formatting, the clock, or the primary action. Reply recipients
cannot be edited or dragged during a confirmed schedule or active delivery mutation.

When verifying, use an intercepted or isolated delivery fixture: choose a time,
confirm that the editable **Scheduled send** preview makes zero delivery calls, then use
the primary button and `Ctrl`/`Cmd`+`Enter separately to confirm exactly one schedule
call. Reopen a confirmed schedule to exercise proposal/update and explicit cancel.
If a later lifecycle refresh fails, the confirmed result remains in place; stale
observations must not undo it or create a recovery draft after a failed inbox move.
Reconciliation resumes when a fresh poll or event-driven read succeeds.
If scheduling succeeds but marking the thread done fails, the email remains
scheduled and a notice explains the separate failure. Check the confirmed time
before retrying; do not treat that notice as a failed schedule.
Keep a scheduled composer open through its due time when verifying the flow. It
reconciles on email events, tab focus/reconnect, cross-tab schedule changes, and a
short due-time poll. Confirmed delivery closes or disables the old composer and
stops autosave/delete against the sent ID. Text from an edit that raced delivery
is preserved as a new unsent draft, never submitted with the sent message ID.
Recovery re-uploads local attachment files and restores forwarded attachments.
Remote-only draft attachments cannot be copied after the original draft is gone;
their pills are removed and a notice asks you to attach those files again.

A successful initial schedule shows an **Email scheduled** notice whose description
gives the full send time, with **Undo** and **View message** on their own row below
it; a rescheduled email
shows **Email rescheduled** with **View message**. Undo cancels the captured draft in
the captured inbox and restores its editable body, envelope, and attachments; it must
not overwrite a newer reply. View message opens the scheduled thread, or scrolls an
inline reply back into view.
The Email view's **Scheduled** tab lists only server-confirmed scheduled drafts,
soonest first across the selected inboxes, as ordinary email rows: the recipients,
subject, and snippet, with a clock-and-time badge (for example **Tomorrow, 2:12
PM**) in place of the row's date; hovering it gives the full date, time, and
timezone.
Opening a row previews its thread like any other email; cancel from the opened
message's bar. Search and filters are hidden on this tab. Immediate-send undo-window
queue rows are not scheduled drafts and must not appear.

With the new app views enabled, mobile and tablet Email use a floating, horizontally
scrolling row of those tabs, with `Open email filters` at the left. The rest of the
view is the email list, which scrolls beneath the header and supports pull to refresh
and swiping left to mark emails done in Signal and Noise. The filter button opens a
glass bottom sheet for status, done, attachment, calendar and tag filters, plus an `Inbox`
section when the user can pick one: `All inboxes` or a single address, never several.
`Clear all` resets those filters and the inbox selection. Desktop keeps its sidebar,
search field, filter menu and preview control. The sidebar lists the inboxes above the
`New email` button and tabs as plain rows; clicking one shows only that inbox.
`Connect another account` starts the add-inbox flow from its own row below the
scrolling list. `New email` prefills From with the selected inbox, or the primary
inbox when All inboxes is selected; reopening a draft keeps its saved sender.
If an explicitly selected sending inbox is unavailable, Send reports
`Unable to find linked email account. Select a sending inbox.` without delivering
through another account. The From picker stays available as `Select sending inbox`,
including when only one linked inbox remains. On mobile, expand `Cc/Bcc, From:`
to choose the sender. Selecting an available inbox clears the error and allows
sending; the picker never displays another inbox as selected before that choice.
With no explicit selection, an unavailable primary still falls back to
the first linked inbox.
Sidebar rows, including `All inboxes`, replace their icon with an accent-colored checkmark when
selected. With exactly one connected inbox, only its address appears as the selected
row, followed by `Connect another account`; there is no `All inboxes` row, title
inbox dropdown, or inbox section in the mobile filter drawer. The inbox section shows up to four rows (including `All inboxes`), then
scrolls independently without overscroll so the email tabs stay in place. With many
accounts, scroll to the last inbox and check that selecting it updates the header filter.
Selecting one inbox also shows `from [email address]` beside the list title.
The address is a borderless ghost dropdown with the title's font weight and a
consistent 14px font size at all widths; `from` is 12px. Both align to the title's baseline, without
a tooltip or a separate clear button.
Its single-select menu includes `All inboxes`, which clears the account selection
and removes the filter. Saved selections from the old multi-select picker restore
the first saved inbox; an empty saved selection restores All inboxes. Once linked
accounts load successfully, a selected inbox that no longer exists resets to All
inboxes. This runs for the whole email view, including on touch devices before
the filter drawer opens. New email uses the originating email-view split even if another split
is active. Verify that
sidebar and menu selection stay in sync and that clearing preserves the current tab and other filters.
Sidebar rows, `New`, and the panel's back, forward and close controls act on primary-button
mousedown, so the selection changes before the click completes; a normal click
still works. The sidebar ends with a collapsible `Tags` section (every personal and
team tag, plus a `New tag` button): clicking a tag opens the `All` tab filtered to
threads carrying it, clicking it again clears it, and choosing any tab clears it like
the other filters.
Rows have trailing selection checkmarks; Close filters dismisses the sheet
without resetting its selections.

## Search

Sidebar `Search` button → `/app/search` with a focused query box. Results
(including a `Featured Results` group) filter live as you type; no Enter needed. `Ctrl+K` is
usually faster for jump-to-entity; `/` opens workspace search when no editor is focused.

On touch devices, the dock's **Search** button opens a persistent input. Type a
query, then switch the scope pills between **All**, **Notifications**, **Email**,
**Channels**, **Files**, **Agents**, and **Tasks**. The selected view searches with
the same query and retains its tab/facet restrictions. Channels searches
conversation names. Clearing the
input restores the current scope's unsearched list; **Close search** ends the
session. Switching scopes keeps the input mounted and focused. The dock query is
not saved into the view's desktop search or restored entry state. Home and
top-level Tasks use this same overlay; embedded project task lists retain their
own search while the dock is open.

Search snippets carry their target in the destination pane's route search. Channel
messages open Chat at the message (replies open their parent thread); email snippets
open the matching message, Markdown snippets the matching node, PDFs the matching
page and highlighted text, agent snippets the matching turn/author, and call
snippets the matching transcript segment. Plain rows keep their existing behavior:
email rows open normally, while agent and call content results use their first hit.

Verify both a cold open and a result whose entity is already open in another pane,
including a Home or Drive detail: reuse keeps that pane's workspace and filters,
leaves the search pane intact, and scrolls to the target. Scroll away and click the
same snippet again to verify it re-targets. Repeat with Shift-click and Cmd/Ctrl-click
(new split and new browser tab), and check Back/Forward restores the earlier target.
Channel checks should include an older offscreen message, a reply, and then a root
message to ensure the previous thread target is cleared.
For a PDF that is still loading, clear its route target before pages become visible.
The old search hit must not apply afterward, and its normal initial position should
still restore if no target has been applied. A newer mention or preview target must
survive that cleanup and still open when the viewer is ready.

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

Files opens **Drive** using the same shell as Tasks, on desktop and touch
devices alike.

With `enable-databases` enabled, **My Files** includes owned databases and
**Shared with me** includes databases shared by other owners. **All files**
also includes accessible databases owned by others. **Search Drive** matches
database names and **Filter → Type → Database** narrows the list. **New →
Database** creates and opens a database from file tabs or the folder overview;
it is absent inside a folder because databases have no folder membership yet.
Database rows open their database block, including Enter and Open in new split.
Use the database block's own actions to rename, share or trash it. The list
omits unsupported duplicate, delete and move-to-folder actions for databases.
Databases have no view history and do not appear in **Recent**, folder contents,
or **Email attachments**. Creation time orders them when the selected sort has
no corresponding database timestamp.

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
folders without navigating. With GraphQL caching enabled and membership metadata
hydrated, a never-visited folder can immediately show cached documents, chats,
and subfolders for supported created/modified sorts and filters. Email remains
server-owned: the full mixed GraphQL query still refreshes in the background,
keeps loaded email rows, and owns pagination. A non-email projection with no visible
rows, including when pending deletions hide every cached row, must not show
`This folder is empty` while that initial request is pending or failed. Verify that
loading and transport errors remain visible in this case; releasing a failed deletion
restores cached rows without a refetch.
Verify with a folder-specific GraphQL response delayed, then navigate to another
folder before it completes; neither cached rows nor late results may leak across
folders. The top bar keeps the full folder and file detail
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
The New menu and drag/drop uploads target the selected folder. In a folder
opened in its own split or an inline preview, drop files from the computer onto
the empty state or file list, then reopen the folder to verify membership.
Check both one file and multiple files; the nested list drop target must retain
the open folder as the upload destination.
File rows retain
selection and context menus; ordinary folder clicks and Enter browse inside Drive,
while Markdown, code/CSV, image, video, PDF/DOCX, canvas, and unrecognized file
clicks and Enter replace the list with a breadcrumbed detail. Those detail
menus include Duplicate, Rename, Move to folder, and Delete. Code, CSV, image,
video, canvas, PDF, DOCX, and unrecognized files also include Download. PDF
details include Print, and DOCX files include Download DOCX. Markdown details
use the document menu, which already includes Download. Spreadsheets keep the
editor's Import and export menu for Excel and CSV downloads. Choose the current location
breadcrumb to return to the list; choosing an ancestor file drops newer detail
entries. Opening a list row or sidebar favorite pushes a new one-item detail path;
sidebar favorites start from My Files instead of inheriting a previously selected
folder. Only navigation originating inside a detail appends to that path. Browser
Back and Forward restore the exact path saved with each entry, and renamed files
update in mounted ancestor breadcrumbs without rewriting history. Cmd/Ctrl-clicking a
row toggles selection; Shift-clicking a checkbox selects a range, and Shift+Enter
opens the focused row in a new split. Cmd/Ctrl-clicking a row's folder link or
search hit opens a new tab. Short filtered pages load more results automatically;
a failed page shows a retry action instead of silently stopping. On touch, tabs
switch via the header pills; on narrow desktop layouts the header keeps a plain
title and navigation goes through the hamburger overlay. Location, search,
filters, expanded folders, list focus, and scroll position are restored when
returning from an opened file.

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
pill. Provider backfill shows a persistent `Syncing your calendar…` banner above the
grid, explaining that events will appear automatically and Macro remains usable.
The banner stays visible as partial results arrive and disappears when sync finishes.
Errors retain the separate retry state. Verify delayed occurrence
responses: switch Month/Week/Day rapidly and navigate without blanking the grid.
Confirm mixed event shapes, stable positions, clean handoff, and an uncovered Retry.
Reduced-motion mode disables pulses and transitions. The page stays busy until the
handoff starts. Hidden pages do not animate. Resize to confirm skeleton alignment.

Calendar reads come from the local GraphQL cache when both `enable-graphql-soup`
and `enable-graphql-calendar` are on (PostHog in production, on by default in dev
for the calendar flag; set `VITE_ENABLE_GRAPHQL_CALENDAR=false` to test the REST
path). A range the cache has covered renders with no occurrence request, and a far
jump fetches only the uncovered weeks. A `refresh_calendar` poke, reconnecting,
coming online, or returning to the tab runs one `CalendarChanges` delta that
applies edits made elsewhere. RSVPs, edits, deletions, and creates show at once
through the durable mutation queue: a rejected write rolls back with the usual
error, and a write made offline stays visible and replays on reconnect. Native
apps whose engine lacks the calendar cache commands keep the REST path.

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
so invitees can open those links.

Calendar connections live in **Settings → Calendar** (`/app/settings/calendar`).
Scheduling lives in the separate **Settings → Booking links** item
(`/app/settings/booking-links`), with Booking links, Availability, Booking pages,
Teams, Bookings, and Insights in one scrolling page. The calendar toolbar’s
booking actions open Booking links; email and integration connection shortcuts
continue to open Calendar.
There is no second sidebar or global owner switch. Personal and team booking links
appear together with ownership badges. New booking link and New schedule ask which
owner to create for when multiple editable owners are available, then open inline editors;
event options are stacked sections. Save changes or Cancel returns to the list.
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
Ownership badges identify Personal or Team · team name on links and availability.
Public booking pages, bookings, and insights are grouped by owner and remain visible
together; editing one owner does not switch the rest of the page. Search booking
links by title, slug, or owner. Team owners/admins can edit team links; ordinary members can view them. `Event types` creates, edits,
pauses, duplicates, previews, and copies booking links. Event settings include
weekly availability, collective/all-host or round-robin/one-host assignment,
notice, buffers, booking horizon, daily limits, and custom questions. New event
types stay paused until `Accept bookings` is selected and changes are saved.
`Availability` manages named weekly schedules and date overrides in an IANA time
zone. Set a default schedule for new event types; a schedule cannot be deleted
until its event types use another one. Collective and round-robin team meetings
respect each host’s personal default hours when configured, plus busy calendars.
`Teams` summarizes connected teams and links to team settings; the member roster
lives in team settings. Choose hosts for a team booking link inside its editor.
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
`/app/book/:profile/:slug?` pages accept bookings without Macro sign-in. Uncertain
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
is feature-gated and lists teammates with 24px avatars; its section switch
toggles the entire grid overlay. Clicking a teammate's row navigates to that
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
**Team sharing**: `Busy blocks` (the default), `Event details`, and `Nothing`.
These are Macro read permissions. They do not change Google Calendar ACLs,
invite teammates to meetings, or let teammates edit, RSVP, or manage reminders.
The sharing choice covers every currently authorized calendar synced to Macro.
Private/confidential events only expose generic time blocks; event details
come from one authorized source copy. Disconnecting an account or losing
source access removes its team projection.

**Calendars that count as busy** controls which calendars represent the user's
personal schedule. Primary calendars count by default; other calendars require
explicit inclusion. Meetings the user attends also contribute, except declined
meetings. Following a coworker's calendar does not automatically make that
coworker's events occupy the user's time. In team overlays, `Busy` means the
block contributes to that teammate's availability; `Shared calendar block`
means it belongs to a calendar the teammate can access and does not count
toward their busy time. Event details show the same distinction explicitly.

The sidebar's **Team calendars** section has a master `Show team calendars`
switch and per-teammate checkboxes; Settings exposes the same display controls.
Display toggles affect this viewer's grid only. Team chips are prefixed with
the sharer's name and open read-only details. Copy-event links, guest-email
actions, RSVP, editing, and deletion are unavailable on team projections.
A directly accessible copy retains its own actions; another person's projection
of the same meeting may appear separately, with its sharing provenance.
Team projections and availability use server-confirmed copies. An offline queued
edit appears in the editor's own calendar, but reaches teammates only after the
server commits the provider-backed change and their shared projection refreshes.
An unavailable team fetch displays a warning and removes stale shared details.
Sharing-change notifications clear open shared details before refetching;
focus/reconnect and a 30-second refresh provide a fallback. Shared details also
disappear when an offline refresh is paused; they are not persisted for offline
use. While the app is running, team responses and in-flight requests expire
after 60 seconds, so a hung refresh cannot retain old details. Replacing a login
session clears team data and open shared details before the new identity loads.
Legacy out-of-office rows are read-only status displays and do not claim
that every absence blocks availability.

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
has a checkbox in its header row toggling the whole overlay on or off — all teammates or
none — and lists the next 90 days of teammate absences; clicking a row navigates the grid to
that date. Coverage depends on each teammate having connected their own calendar and using
Google's out-of-office event type.

A calendar event mentioned in a channel message opens the calendar focused on the viewer's
own copy of the meeting. When the sender holds the event on their own calendar, the mention
also shares it read-only with the channel's current members: a member without a copy of their
own sees the mention's title and time, and its hover card adds a `Shared with you · not on
your calendar` line with no open action. Clicking such a mention shows that hover card
instead of opening the calendar. Private and confidential events are never shared this way.
Every calendar mention's hover card shows the schedule, location, organizer and attendee
count, plus the first lines of the event description (its links open), and no last-updated
byline.

## Pull requests — `/app/reviews/pr/<foreignEntityId>`

Macro-linked GitHub pull requests open inside the Reviews shell, with a Reviews
breadcrumb, PR title/status, linked GitHub metadata, discussion timeline, and Details/Checks
side panel below the top bar. An open PR also shows a **Merge** button in the
top bar beside **Changes**. It opens a confirmation with the repository, PR number,
and title, then merges on GitHub as the signed-in user through their linked account.
GitHub's permissions and branch protections decide; a refusal appears as a toast
with GitHub's reason, and a merge refreshes the PR status in place. Without a linked
GitHub account the toast points to Settings. Merged and closed PRs have no Merge
button. PRs are not tasks and do not appear in the Tasks list.
The metadata pills beneath the PR title include linked agent sessions, using the
agent sparkle icon. A single session shows its name; several sessions show a
count chip opening a session list. Selecting a session opens it, with Shift-click
on the single-session chip opening another split. The same chip appears in PR
list metadata without activating its containing PR row. Empty links show no chip;
loading or inaccessible session previews are not navigable. PR status pills stay
passive; status filtering uses the Reviews list's Open/Closed sliding tabs and
filter menu.
Opening **Changes** slides a full-height pane in from the right beside the PR details,
including beside the PR top bar rather than underneath it. The PR details shrink
alongside the entry slide instead of eagerly jumping narrower. The Changes pane
has no outer top, right, or bottom border. The PR's `+N −M` diff count pill also
opens the pane when changes are available; it remains a passive count without a
Changes controller or when changes are unavailable.
Closing slides the pane fully off the right edge while expanding the left pane,
without fading in either direction or a final width snap. From full width, the PR
details appear behind the sliding pane, without blank space. Reopening during exit
keeps the same pane mounted.
The pane shell opens before the diff bodies render. Reduced-motion preferences
disable both animations.
The PR breadcrumb and side-panel toggle remain above the left pane. The
**Changes** toggle stays visible in split view, ghost while closed and accent text
on a tinted background while open; clicking it again closes the pane. There is no standalone **Open on
GitHub** button: the pane header has no visible Changes title, and its
`head → base · #N` is one plain-text GitHub link, underlined on hover without a
pill background or icon. GitHub diff totals and five green/red squares appear
beside the PR number in both split and full-width layouts. The squares summarize
the addition/deletion mix; the numbers retain exact totals. At full width, a smaller
PR title appears before the link. Both title and totals come from the existing PR
query; unavailable values stay hidden, without placeholders or captured-count
fallbacks. File headers highlight on hover. When space is tight, the smaller
branch/PR/count metadata wraps below the title, while pane actions stay separate.
The Changes toggle has no diff totals and becomes icon-only below 28rem of header
width, retaining its name, tooltip, and active state. Breadcrumbs keep their existing layout.
The full-height file tree has a fixed header with its file count on the left and
**Hide file tree** on the right. Borderless diff controls float above the diff stack
rather than spanning the pane in a second toolbar. Unified/Split retains text labels
at narrow non-touch widths on the left, with diff collapse/expand and refresh on
the right. Hiding the tree moves its count
and **Show file tree** above the diffs, as described in
[AI Chat](ai-chat.md#reviewing-a-linked-github-pull-request).
Spotlighting changes hides the left pane and its top bar; **Back to the split**
restores the prior divider position and retains the draft, diff state, and scroll.
At host widths of 720px or less, Changes opens full-width automatically without
that width toggle; widening restores the requested wide layout and split ratio.
Narrow file trees start closed. **Show file tree** opens an animated drawer over the
diffs without resizing them, including on phones. File selection, Escape, the
backdrop, or **Hide file tree** closes the drawer and restores focus to its opener.
The drawer does not change the saved wide-tree visibility or preferred width.
Closing releases the drawer's dialog handlers immediately while its inert visual
frame finishes exiting, so rapid reopening does not restore focus to a stale opener.
The file tree has its own draggable, keyboard-resizable divider and remembers its
width locally. Tree visibility uses the sidebar's shared width transition while
retaining directory state and diff owners. Reduced motion skips this transition.
The divider remains visible but inert through the tree's exit. Resizing the outer
split or viewport settles active tree motion before applying the new geometry.
**Copy path** briefly shows a non-pulsing success checkmark without collapsing
the file. The PR viewer stays read-only and does not offer agent review notes.
Copy Link from a PR in Quick Access copies `/app/reviews/pr/<foreignEntityId>`.
Old `/app/pr/<foreignEntityId>` links redirect to Reviews. Check a copied link,
a PR opened from a list or agent session, a second split, breadcrumb return,
side-panel toggle, and phone layout. If no GitHub data loads, the detail shows
an error banner with a Retry button; pressing it refetches the PR in place.

## Calls — `/app/component/calls`

Tabs `All` / `Missed` / `Unattended`; `New call` offers `Call a channel or contact`
and, with `enable-quick-calls` enabled, `Manage call links`. Create Quick Calls
with `New Call` beside Calendar's
`New event`, or with `Create` → `Call` (`C C`). Scheduled calls are created through
Calendar and can be shared with people who do not have a Macro account.
The channel/contact option opens the recipient picker.
Recordings, transcriptions
and summaries appear here; empty state notes "Calls are available to agents."

Opening a recording uses `/app/drive/call/<callId>` inside the Drive shell,
with one breadcrumbed header (`My Files > <recording name>`) and a route back to
Drive. The Drive file list does not include calls.
Old copied `/app/call/<callId>` links redirect to the Drive detail without losing
the transcript target. The detail shows a loading state, recording/transcript/summary,
Share, and a call side panel below the breadcrumb header; a failed load shows Try again.
`call_transcript_id=<segmentId>` seeks the matching video segment after loading.
Check a direct link, an old copied link, a Calls-list click, a second split,
the breadcrumb return, and clicking the same transcript search hit twice after
playing elsewhere. On phones, recorded call headers omit **Call Again**.

A channel's `Calls` tab lists that channel's recordings with the same rows, filtered
by the channel id. Its search field matches call names and transcripts in that
channel.

If a recording fails to play, reload the page to obtain a fresh recording link,
or use **Open or download recording**. The playback warning does not assume
that the failure is caused by an unsupported media format.

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
`/app/meet/:shareToken` without restarting the call. Leaving returns to Macro.
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
for audio, video, device selection, screen sharing, and effects. `Leave call` returns
to Macro. `Copy Meeting Url` is available during the call.
Rejoining from a new page waits for the prior page's pending leave cleanup before
requesting another connection, so a slow leave cannot disconnect the replacement.
Leaving the last participant archives the session first and tears down its media
in the background, so the next call does not wait for that room to be deleted.
It keeps its label and shows a checkmark for a few seconds after copying, then
restores the copy icon.

Guest access is limited to the call room; joining does not expose the channel or grant
anonymous access to saved transcripts and recordings. Guest names are preserved in
the host's call history. Signed-in attendees receive access to that session's saved
call without gaining access to the channel.

The join screen, in-call participant tiles, and incoming direct-call badges use
profile pictures; initials are the fallback when no photo is available.
The join screen has microphone, camera, and background effects buttons over the
preview, with pill selectors below for microphone, speaker, camera, and
backgrounds. The background button over the preview toggles the selected effect
off and back on; when no effect has been selected, it enables Strong blur.
Backgrounds use a simple menu with None, Light blur, Strong blur, and image upload
(JPG, PNG, or WebP, up to 10 MB). Dot icons distinguish the two blur strengths.
Selected devices and backgrounds carry into the call; unsupported browsers use
the system speaker. If a background cannot be applied, the camera stays off
until the user retries or chooses None. The screen uses a gray join
button. The in-call header has a gray `Copy Meeting Url` button with a copy icon
and shows the current local time before the call name. Owners can click the name
to rename it, then Save or press Enter; Cancel or Escape discards the edit. Guests and other participants see a
read-only name.

Join-preview and in-call controls use the standard Macro icon buttons. Pause
over the microphone, camera, or background group to reveal an animated settings popover
above the call toolbar; click its caret to keep it open. Brief pointer passes
do not open settings, and moving into the popover keeps it open. Settings
respect reduced-motion preferences. The toolbar and settings panels use Macro's
shared glass surface in both light and dark themes.
Audio settings include microphone, speaker, and noise suppression. Camera
settings include the camera selector. Clicking the background icon toggles the
selected effect off/on, restoring the last blur strength or image (Strong blur
by default). Its hover panel contains the same None, Light blur, Strong blur,
and image-upload menu as the join screen; the caret pins this panel for keyboard
and touch access. Click outside or press Escape to close the settings.
The controls also work by keyboard and touch.

### Sharing a call

With quick calls enabled, channel calls use the same **Copy Meeting Url** button
as instant and scheduled calls. Clicking it creates the share link and copies it;
opening the call tab alone does not create a link. If loading fails, click again
to retry. If clipboard access fails, a selectable URL appears below the button.

A channel call's **Share** dialog has a `Team access` control (None or View) for the same canonical
team share. Its side panel has a `Sharing` section with one `Share with team` checkbox, and the
in-call controls carry the same checkbox while a call is live. It is canonical team sharing (the
same `Team access` model documents and AI chats use), fixed at **view**. While the call is **live**
the checkbox is a pending toggle (on by default for channel calls)
that any participant with edit access can flip;
other participants see it update live. When the call ends it is applied: with the toggle on,
everyone on the creator's team can open the recorded call, read the transcript and AI summary,
and find it under Calls and in search; off means nothing is shared. Afterwards only the call's
**creator** can change it — everyone else sees the checkbox read-only with a note saying so.
Team sharing is independent of channel access and of link sharing.

Standalone instant and scheduled calls are excluded from team memory. They have no
`Share with team` or `Team access` controls during the call or on the saved recording.
Signed-in participants keep direct access to their recordings, transcripts, and summaries;
joining a standalone call never makes its content available to the wider team.

## Customers (CRM) — `/app/component/companies`

On desktop, the local sidebar uses the same navigation primitives as Email and Tasks.
Board and List share a horizontal segmented toggle at the top of the sidebar; the
main header has no layout toggle. People lists contacts across every CRM-enabled
team the viewer belongs to. Duplicate full email addresses (case-insensitive)
collapse to the visible contact with the most recent interaction; ties use the
contact ID. Each team's record and existing contact links remain separate. Hidden
contacts and contacts under hidden companies are excluded. The directory supports
name/email search and sorting, and its navigation remains available on touch devices.
Company views include All companies, My companies
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
Clicking a contact in an embedded company's Team tab appends a third
breadcrumb: `<current view or list> > <company> > <contact>`. The CRM sidebar stays
visible. Click the company breadcrumb or the contact's Company link to return to
the company; click the first breadcrumb to return directly to the originating
view. Shift-click still opens a contact in a separate split. Direct contact links
use the standalone contact page.
Company and contact headers have `Copy link` beside the side-panel toggle.
Their information panel starts closed and opens as a floating bubble at every
width, without shrinking the record content. Click outside the bubble or use
the toggle to dismiss it; the open state is not restored on a later visit.
It copies the record's direct URL and shows a confirmation toast; this is also
available in the embedded company and contact breadcrumb header.

A company is laid out like a project. Its split header or embedded breadcrumb
header shows inset `Overview`, `Team`, `Emails`, `Files`, `Tasks`, and `Calls`
tabs, collapsing to icons when narrow. Overview shows the name, pills
for each domain and `Last interacted`, the generated description and the
Discussion. Team lists the contacts with `Add contact`. Emails keeps the
`Signal`/`All` and `Team`/`Me` toggles. Files lists non-task documents whose
`Companies` property references the company, plus attachments of emails with
its domains. Tasks is the Tasks list scoped to the `Companies` property; its
`New task` composer pre-fills the company. Calls lists calls linked to the
company, including those linked automatically from their participants. The side
panel keeps Properties and Sharing.
A contact has the same layout with `Overview`, `Emails`, `Files`, `Tasks` and
`Calls`: Overview pills show the email, the company (opens it) and `Last
interacted`. Files and Calls match on the contact's `Contacts` property and, for
files, attachments of emails with its address. Tasks created from a contact also
reference its company. The side panel keeps Sharing (admins only).

Company and contact pages have a **Discussion** section built from the same
message conversation as a document's Discussion: threaded replies, reactions,
attachments, and edit/delete from the message menu. `@` suggests the team's
members and agents. A message's copied link is the standalone record URL
with `comment_id`; opening it, or a CRM discussion notification, scrolls to and
highlights that message. Deleting a thread's first comment deletes the thread.

Company selection actions **Set owner** and **Set revenue** remain available
while team deal-stage definitions are loading. **Set stage** waits for the active
team definition rather than opening an editor with system defaults. Check both
the entity actions menu and command menu with stage requests delayed; cancel the
editors without changing hosted data.

`Collapse CRM sidebar` persists across visits; `Expand CRM sidebar` restores it.
At narrow widths, `Show CRM navigation` opens the same navigation in a menu.
The sidebar's Views and Lists sections can also collapse independently.

**Pipelines** in the CRM sidebar hold company or contact entries in the shared
records editor. They have their own identity, ownership and sharing; their
storage does not appear as a separate database in navigation.
**New pipeline** is disabled until the team's CRM is enabled. For a new team,
use **Open CRM settings** in the empty state to enable CRM, then return to
Customers to create a pipeline. Verify this with a newly created team as well as
an existing CRM-enabled team.
Choose **New pipeline**, enter a name, choose **Companies** or **Contacts**, and
choose **Just me** (the default) or **My team**. Creating opens the pipeline's
editable table. Team members can edit shared pipelines; the creator owns them
and can change access later through the standard **Share** dialog. Under
**Team access**, choose **Edit** to share with the team or **None** to make the
pipeline private. **Copy Link** copies a CRM link that opens this pipeline for
anyone who has access. On mobile, team access is in the **Team** tab.

The first column is a required company/contact reference. The same company or
contact can occur in multiple rows in a pipeline and can also belong to other
pipelines. Each row has its own field values; **Duplicate** copies a row into a new
entry referencing the same company or contact. The reference column
can be renamed but cannot be removed or changed to another type. Stage, Owner,
and Revenue are independent pipeline fields; editing them does not modify the
company's CRM fields. Use **Add column** or a column header's menu to customize
columns. Pipeline Stage options initially copy the team's current deal stages. Open
pipelines refresh other editors' changes periodically; a local edit refreshes
immediately after saving.
**Trash pipeline** removes its table from navigation without deleting the linked
companies or contacts. **Back to companies** returns to the main CRM views.

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

To verify document content activity, keep Activity open in one tab and edit an
existing document's body in another, without renaming it. The editor's Edited
entry should arrive for the first edit. Keep typing across multiple saves: the
activity count must stay unchanged. After five minutes without editing, the next
edit should add one new event. Reconnecting within that window and opening or
closing a document without edits must not add an event.

Requires authentication and the `enable-activity-feed` flag. Direct navigation and
restored splits wait for flags to load; when disabled, they redirect to Home
(`/app/home`) without loading the activity feed.

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

With Databases on, databases are activity entities too: creating, renaming, trashing,
restoring, or permanently deleting one, and every write to its tables (grid edits and
agent tools) lands on the acting user's feed as `You created/edited/deleted <database>`;
the mention opens the database. Databases also appear in the Ctrl+K command menu under
**All** and **Files**, ordered by creation time. Home's merged feed and the Recent view read Soup, which
does not list databases.

## Home — `/app/component/home`

Greeting, example prompt buttons (`Draft a document`, `Draft an email`,
`Search & research`), and the ubiquitous `Ask AI` composer. Finishing onboarding
without a deep link lands here. The retired Getting Started page's old
`/app/getting-started` and `/app/component/getting-started` links also open Home.

On phones, shared confirmations (including Remove Member and Cancel Invitation)
use a glass sheet with a title, description, Close confirmation button, and
side-by-side cancel and confirm actions. Pending actions disable both buttons
and prevent dismissal; canceling leaves the underlying data unchanged.

## Onboarding bypass — `/app/onboarding`

All `@macro.com` accounts see a **Bypass** button on every onboarding step. It
skips the rest of the flow and leaves onboarding. Accounts on other domains
do not see it.

## Setup plan step — `/app/onboarding`

Onboarding has no plan picker; it ends with the 30-day Premium trial offer and a
Guest continuation (see [login](login.md#desktop-onboarding)). Plans are chosen
afterwards in **Settings → Billing**, where Guest users can buy Premium or Max.

## Settings — `/app/settings/<section>`

### Slack archive import

In **Team → Connections**, **Import from Slack** appears only for team admins
and owners with `enable-slack-archive-import` enabled. Production rollout stays
off until explicitly enabled. Select an export ZIP, filter the grouped conversation
picker, optionally show archived conversations, and use Space to toggle focused
checkboxes. **Select all visible conversations** preserves selections hidden by
filters; unchecking it or **Clear visible selection** clears only visible selections.
Rows show stable Slack IDs
so duplicate names remain distinguishable. Counts are advisory when available,
otherwise “not yet counted.” Discovery moves keyboard focus to the filter.
Slack file/canvas discussion folders (`FC:<file-id>:<title>`) are ignored, not
imported as channels; their presence must not prevent channel discovery.

Review email attribution and external membership implications, choose whether to
include history, and confirm the immutable Slack workspace binding before
**Import selected channels (N)**. At least one selection is required. File selection
alone makes no server writes. Close/Escape or cancel before confirmation discards
the archive and selection without creating a job; reopening requires choosing a
file again. After confirmation the selected IDs/options are frozen. Closing and
reopening then retains the upload session; keep Team Settings open until it finishes.
The dialog restores focus to its opener, and polling should not blank Settings.

Use **Job history** (including older pages) for server progress after a reload.
It displays the persisted selected names/IDs/kinds, history option and selected
failures/skips without the ZIP. Unselected channels are not skipped work. Reload
recovers server tracking, **not interrupted local uploads**; finalize verified work
with skips or cancel and explicitly confirm a new import/token.
**Cancel import (keep partial results)** does not delete committed messages or
channels; running work may finish. An interrupted upload offers **Recover job
receipt**, then **Finalize with skips** or cancellation. Channel links appear only
when the server confirms current participation and the viewer's channel list
confirms access. Verify counters, errors and skip
reasons at narrow widths, using synthetic exports and a test backend rather than
importing customer data into hosted dev.

For a release check, inspect the actual create request and then reload the server
receipt: both must contain exactly the selected Slack IDs and history option.
Select two rows with the same display name, filter both out, and confirm the
selected total remains unchanged. Cancel before confirmation and verify there
were no create, registration or PUT requests. An open job must reject tampered
registration/sealing of an unselected ID; a client-only picker test is insufficient.
Check desktop web and Tauri: opening Settings alone creates no ZIP worker, and
signed PUTs work without dropping checksum or conditional headers. A 412 upload
retry verifies the existing object instead of overwriting it. Keep an active job
open through websocket disconnect/reconnect to verify polling remains usable.
The [runbook](../SLACK_ARCHIVE_IMPORT_RUNBOOK.md) distinguishes fixture tests from
live-backend release gates and documents staging retention and recovery.

### Email signatures

Open **Settings → Email → Signatures**. Each owned inbox has a visible editor;
there is no expand/collapse control. Format the text, add links or images, and
choose **Save signature**. **Clear signature** removes only the signature, while
**Remove inbox** in Accounts uses the existing inbox removal confirmation.
**Add to replies & forwards** saves that preference immediately. On desktop,
**Import from Gmail** in each inbox's header fetches that account's Gmail
signature and saves it right away, replacing any unsaved draft; a toast reports
when Gmail has no signature. Unsaved drafts
survive switching settings pages. On phones, signature editing remains desktop-only;
the replies/forwards toggle and clear action are available.
Email accounts can also be managed from **Integrations**. Its **Email settings**
link opens the dedicated page, and Email links to Notifications and Calendar.
With a composer open, save a changed signature or reply-signature preference and
verify its preview updates. Once the account refresh completes, reopen a composer
offline and confirm it uses the saved settings.

### Notification snoozes

Open **Settings → Notifications** to see **Snoozed items** and their local resume
times. **Change time** opens the same searchable time picker used by entity
actions; **Resume** cancels a snooze immediately. Permanent mutes appear separately
under **Muted items**, with **Snooze instead** to replace one with a timed pause.

The Chat detail pane also supplies these commands for its current channel or DM;
focus the conversation before opening the command menu.

To snooze an entity, right-click its row (long-press on mobile) and choose
**Snooze notifications…**, or select/open the entity and search for that command
in Cmd/Ctrl+K. Multi-selection applies the chosen deadline to all selected items.
Use arrow keys and Enter, click a preset, or type a future date/time such as
`2h` or `tomorrow 10am`. The next morning means the next local 9 AM; the weekend
preset resumes on Monday at 9 AM. The picker displays the exact local date and
time before saving. Escape closes the picker; before choosing a time, it makes
no changes.

Snoozing pauses notifications only: it does not hide, archive, mark read, or mark
done. Channel message/thread rows target their parent channel, matching mute.
The server enforces expiration even when no client is open. Displayed snooze
state refreshes when the window regains focus or a mute/snooze changes; the
client does not poll. A failed save keeps the picker open for retry; a successful
save appears in notification settings.
If only some selected items save, the picker shows the saved count and retries
only the remaining items. Closing it keeps any snoozes already saved.

On phones, long-press opens the entity actions drawer. The snooze time picker
uses the same responsive `Dialog`, width, and `CommandMenuShell` as Cmd/Ctrl+K,
with larger touch targets and tap instructions. Swipe the preset list when the
viewport is short. In **More views → Settings → Notifications**, item names and
deadlines sit above **Change time** and **Resume**. Saving or cancelling a picker
returns to the settings sheet. Start new snoozes from an entity's actions or
Cmd/Ctrl+K; Settings manages existing snoozes and mutes.

Design references: [Slack notification pause/resume](https://slack.com/help/articles/214908388-Pause-your-Slack-notifications)
and [Superhuman's keyboard-driven Remind Me picker](https://new.superhuman.com/remind-me-29124).
Macro applies the temporary pause per entity and keeps the entity visible.

### Team membership

Team membership has no size cap, including free teams. Invitations and domain
auto-join must keep working beyond five members and the former stage-plan limits.
Free-team joins do not create a paid subscription, bill a seat, or grant premium
roles. Teams with an existing paid subscription retain their per-seat billing;
enterprise teams retain their billing bypass.

On a local stack started with `--no-doppler`, verify free-team creation from a
fresh passwordless signup. It must work without Stripe credentials.

Under **Team**, owners/admins can turn **Auto-join on domain** off and can restrict
invitations to admins with **Members can invite**. These controls still apply.
To verify the membership flow, use a local free team with five members: invite
and accept a sixth member, then sign up another user on its enabled auto-join
domain. Both should appear in the team's member list and configured auto-join
channels without an upgrade prompt. Repeat with auto-join disabled to verify a
same-domain signup is not added automatically.

### Navigation

On phones, **More views → Settings** opens an inset glass sheet over the current
page. The main page has a profile shortcut and the same grouped Blocks, Personal, Workspace,
and Developer sections as desktop, plus enabled admin settings. Search finds
individual settings; selecting a result opens its page and reveals the section. Tap a row to open that settings
page inside the sheet; **Back to settings** returns to the grouped list at its
previous scroll position. `API Keys` is desktop-only and has no row here.
**Close settings** at the top right, Escape, an
outside tap, or a downward swipe dismisses the sheet. A tap that dismisses a
menu opened inside the sheet leaves the sheet itself open. Opening Settings again
starts at the main page; explicit links (for example Account) open their
section directly. Existing settings URLs open the requested section in the sheet
and restore the underlying app route. The header stays visible while forms
scroll, including with the keyboard open. On desktop, Settings is an ordinary
split view: the rail's gear button (or `Ctrl ;`) opens it in the active split
like any other rail item, and Shift-click opens it in a new split.
`/app/settings/<tab>` opens it as the only split with the app rail still
visible, and `/app/home/~/settings/<tab>` places it beside Home. Its inner
sidebar matches Email and Tasks: a **Settings** title bar with the
**Hide navigation** toggle (`Cmd .`), a rounded **Search settings** field, the
grouped section pills, and **Log out** pinned to the bottom. Below 720px the
sidebar becomes an overlay opened from **Show navigation**. Escape closes a
settings split that shares the layout, or steps back to the previous view when
it is the only split (Home when there is none). Leave settings by picking any
other rail item; there is no separate back or fullscreen control.

Settings pages use the email composer’s raised surfaces on the page background.
Section headings and controls share a white surface in light mode and the
composer border in dark mode, with subtle row separators. The compact sidebar
uses the shared workspace width.

Left nav (feature and platform gates still apply):

- **Blocks**: Email, Calendar, Agents, CRM.
- **Personal**: Account, Appearance, Notifications, Keyboard shortcuts, Usage, Billing, Desktop App, Mobile App.
- **Workspace**: Team, Tags, Integrations (personal Gmail/GitHub accounts).
- **Developer**: Agent connections, Runtimes, MCP server, API Keys, Bots.

**Desktop App** (`/app/settings/desktop-app`) shows a compact version and
build-date card in the desktop app. The date is when the running app bundle was
built, not when it was installed on the computer. In the browser it links to the
latest desktop release on GitHub, and only appears when the `desktop-app` PostHog
flag is enabled. Native desktop always shows this section regardless of the flag;
native mobile never shows it.

Search checks individual setting titles and keywords, tolerates common typos,
and shows the parent page below each control result. Selecting a result opens
that page, scrolls to its section or row, and briefly highlights it. Try
`singature`, `email digest`, `calendar color`, or `cursor`. Arrow Down from search
focuses the first result; Tab moves through controls normally. Escape in the
search field clears the query. Clearing search restores the grouped navigation. Keyboard shortcuts are listed
by category with the action on the left and keys on the right; expand **Keyboard
preview** for the visual key map.
Appearance starts with visual **System**, **Light**, and **Dark** mode choices.
The previews use the saved themes; System follows the device and exposes both
per-mode theme selectors. Light or Dark shows its own theme selector. Each selector
retains theme search, editing, copying, and custom theme creation.

Existing settings URLs remain valid; `connections` still opens Integrations,
`agent-connections` opens Agent connections, and `harness` aliases Runtimes.

`Usage` appears directly above Billing, including for Free accounts. In
production, the `enable-ai-usage-billing` PostHog flag controls activation. While
it is off or loading, the page shows **AI billing changes take effect on October
8, 2026.** and all Usage controls are disabled. Turning the flag on activates the
page and removes the announcement. Dev and local remain interactive even with
the flag off. The production usage-limit dialog follows the same flag. Its
**Monthly limit** meter displays a percentage using the backend's current-period
usage and allowance. The info button explains AI agent chat and AI document
editing. **Usage Credits** shows the dollar balance and `Add more`, which opens
**Need more usage?** with `$25` / `$50` / `$100` / `Other`. Supported amounts
redirect to Stripe Checkout; unsupported custom amounts are disabled. Free
accounts see `View plans` instead of purchase or reload controls; paid team
members who are not the payer cannot manage billing.
Unlimited enterprise plans show `Unlimited` and do not offer credit purchases
or automatic reload. The development paid-plan preview can still display
those controls, with purchases disabled.

The **Automatic reload** switch opens **Auto-Reload** without toggling directly.
It contains Minimum balance (default `$10`), Target balance (default `$100`),
optional Maximum monthly spend (`No limit`), a payment-method management link,
and the automatic-charge warning. The dialog saves for paid payers:
`Turn on auto-reload` enables usage billing with those thresholds (the monthly
limit also caps usage billing per period), `Save` updates them while on, and
`Turn off` disables usage billing. The **Automatic reload** switch reflects the
saved state. Paid team members who are not the payer see
`Only the account that pays for this plan can change automatic reload.` and
cannot save. After a failed automatic reload the dialog shows `Your last
automatic reload could not be charged. Update your payment method, then save to
try again.`; saving retries. Existing postpaid usage billing is shown separately
and can be turned off by the payer; while it is on, credits reload automatically
when the balance drops below the minimum. Local **Developer tools** offer
`Preview Free plan` and `Preview paid plan` to display either Usage page with
sample usage, regardless of the signed-in account's tier.
`Open Free usage-limit dialog` and `Open paid usage-limit dialog` open the
corresponding exhausted-usage prompt directly. The previews also work before
the usage summary loads or when it fails. The paid-plan preview allows
testing Auto-Reload settings. Purchases and payment management are disabled during any
preview; `Reset preview` restores server data and closes the usage-limit dialog.
`Preview production before Oct 8` shows the October 8 announcement and disables
Usage controls, including usage-limit dialogs. Dev tools remain interactive:
Free and paid previews can be combined with this state, and `Reset preview`
restores the normal dev view.

`Billing` shows the current plan and `Manage`. Free users see separate Pro
(`Get Pro`) and Max (`Get Max`) cards, side by side when the panel is wide enough
and stacked on narrow panels. The Pro card shows `Free for one month!` for Free
users. `Get Pro` requests the same server-validated 30-day first-subscription
trial as onboarding; checkout redirects only after the server confirms the trial.
Ineligible accounts see the rejection reason and are not silently charged.
`Get Max` keeps standard paid terms. Prices read `/ month` for solo users and
`per seat / month` for team accounts. Each card puts its button beside the price when wide enough and below
the price when narrow. Free lists 2 connected email accounts; Pro and Max list
unlimited connected email accounts. Pro users see a Max card (`Upgrade to Max`); Max
users see a Pro card (`Switch to Pro`). Cards appear only for users who can
manage their subscription. Team-paid members see no plan options, including
on Free seats. Member options stay hidden until the billing summary confirms
they pay for their own seat. On a team, a plan change moves only the viewer's
own seat. Max lists "10x more AI usage than Pro"; Free and Pro allowance labels
still follow the `enable-ai-usage-billing` flag. Usage controls live in Usage.

On a local HMR dev server, `Preview billing states` opens an opt-in preview in
Billing. Choose Solo, a team-paid member, a self-paying member, or a team owner,
and Free, Pro, or Max. `Permissions, loading, and feature states` exposes the
billing summary status, billing permission, active/trialing license, AI usage
flag, and pending plan actions. The preview uses the real Billing UI with local
fixtures; checkout, plan changes, Manage, and Team settings only show preview
status messages. `Reset preview` restores Solo/Free; `Exit preview` restores
the signed-in account. State is not persisted and resets on leaving Billing.
These controls are excluded from deployed builds, including dev.macro.com.

`Team` (members list; on a paid team each row shows the seat's plan,
and admins/owners can move a seat between Premium and Max with the `Seat plan`
menu; moves are prorated at once). CRM (enable/disable; once enabled, a `Deal stages` section
with `Customize stages`, inline rename, reorder by drag handle or arrow keys (up/down
buttons on touch), delete, `Add stage`, `Reset to defaults`, and `Closed stages`
checkboxes, editable by the role set as `edit_stages_role`)

`Agents` unifies agent definitions and runtime configuration in one page, also used by the Agents workspace. Its `Agents` section lists team and private agents. `New agent` / `Edit <name>` open full-page forms grouped
Profile, Behavior, Runtime, Connections, Channels, Share. Connections is a radio pair:
`Use my connected apps` (default; the agent gets whatever the person running it has
connected) or `Specific apps`, which reveals a `Search connectors` box over the whole
Pipedream catalog (results are `option` rows; picking one adds it) and a row per picked app
with a connected / not-connected dot for the *current viewer* plus an inline `Connect`
that opens the Pipedream Connect flow inside the page. Unconnected picks never block
saving; each teammate connects their own account. An agent session that calls a picked
but unconnected app gets a tool result saying so, and the agent's reply renders a
`Connect <app>` chip that opens Agents → Connections for that app. The same page
is also available as Settings → Agent connections.

To change an agent's picture, open `Edit <name>`, choose an image with `Upload`,
wait for `Uploading…` to finish, then click `Save changes`. Images up to 16 MB
are uploaded to image storage; Save stays disabled during the upload. A failed
upload shows an error and keeps the previous picture so you can retry. Verify
the picture after reopening settings and after a page reload, then type `@` and
the agent's name in a channel to check its mention-menu picture. Team agents
available in all channels should refresh there without reloading the channel.

With `pipedream-mcp` enabled, Connections (in Agents or Settings) has `Connected` and `Discover`
tabs. Connected groups GitHub, Linear, Notion, and Slack tool grants by provider,
lists other catalog connections alongside them, and puts custom MCP servers in
a separate section. Discover offers featured providers, a searchable catalog,
and `Add custom MCP`. Slack discovery retains its development-only gate.
Provider Back returns to the tab that opened it; navigation is local to each
Connections page and starts at Connected on a fresh visit.
Provider and custom-server More menus contain Disable, Reconnect, and Disconnect;
custom servers also offer Rename. Disabled grants show Enable. Unauthenticated
custom servers show Connect and Remove. Disconnect/Remove require confirmation.
Adding a custom MCP saves its name and URL; Connect on its row starts OAuth.
Enabled custom servers are offered to the owner's agent sessions (Cursor, Claude,
Codex, macrod, in-memory) alongside connected apps, through the same session
egress path: the sandbox sees the server under its name and a URL key, never the
server's address or token. A disabled server is not offered. If a server's
connection has expired, its tool calls return a message telling the agent to
have the owner use Reconnect under Custom MCP; there is no `Connect` chip for
custom servers. Agents configured with a fixed app selection do not receive the
owner's custom servers.
An agent reply's `Connect <app>` chip still starts that app's connection flow.
Cursor stays in Agents → Runtimes with its API key and default model controls; it is not
featured or offered in the Connections catalog. Personal Gmail and GitHub account
links remain in Settings → Integrations. The native-only Connections page remains
available when `pipedream-mcp` is disabled.
Open Settings with the rail's gear button or `Ctrl+;`; leave it by picking any other rail item.

`Agents` → `New agent` (or edit an existing agent) opens a full-page form. The
`Instructions` field is a Lexical contenteditable textbox, not a textarea. It
supports Markdown headings, lists, emphasis, code, links, and the normal `@`
mention picker; select text to open the formatting menu. Saved instructions
retain mention identities using the shared editor's Markdown format and reopen
with their formatting intact. Enter adds a new paragraph; use `Create agent` or
`Save changes` to submit. The form also includes runtime selectors.
Under the runtime, `Answering a mention` chooses between `Coding agent` (a
channel mention is answered with a magic chip that opens into the live session)
and `Chat agent` (the agent replies in the thread, like `@macro`). It is the
agent's own setting and always saved: a new form starts from the selected runtime
- Macro's in-memory runtime as chat, every other runtime as coding - and picking a
different runtime resets it to that default, but only the saved choice counts.
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

The `Runtimes` section shows built-in Macro, Cursor, Claude, and Codex configuration, followed by paired macrod runtimes. The “Bring your own agent” card sits above the Agents / Runtimes navigation and is visible on both sections. It rotates Claude Code, OpenCode, OpenClaw, and Hermes; reduced motion keeps a static name. Its `New runtime` action opens the full-page pairing flow from either section: enter the code, look up the request, review the machine, name, sharing and permission consent, then Approve and Done. Back/Cancel returns to the runtime list. Destructive removal still requires confirmation. `/settings/runtimes` opens this section; legacy `/settings/harness?pair=…` links remain supported.
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
name **Disconnect ChatGPT**) asks for confirmation before removing the connection.
Claude, Cursor, and Connections disconnect actions use the same shared confirmation
dialog (a drawer on mobile); Cancel leaves the connection intact. Claude's row
keeps its layout while status loads, and sign-in details appear only after Connect.
The UI never asks for an
OAuth token.

The Codex section and its auth/config requests were exercised in Chromium with
mocked backend responses on 2026-09-15. Provider login and a full deployed Macro
session were not exercised by that UI check.

## Notifications

In the desktop app, **Settings → Notifications → Delivery → Desktop notifications**
controls system notification delivery for this installation. When the Notifications
page is disabled by its feature flag, the existing **Account → Notifications**
switch controls the same preference.
Turning it off takes effect immediately and persists across app restarts; turning
it on requests permission and resumes delivery when authorized. On macOS the
switch reads the actual system authorization, and enabling it requests macOS
permission if it has not been decided. If macOS reports denial, enabling the switch
shows directions to **System Settings → Notifications → Macro → Allow notifications**
without requesting permission again; returning to Macro refreshes the switch.
It does not change inbox items or other devices. Focus and presentation settings
can still suppress alerts even when authorization is granted.
Verify off/on and persistence after restarting; on the Notifications page, a failed
toggle should show an error toast and allow retry.

On native Android, enable notifications in Settings while signed in. Android 13+
also asks for system permission; the system's **Activity** notification channel
must be enabled. Remote push owns system notification display after registration,
so the same WebSocket event should not create a second local notification. Tapping
a notification opens its target; simply receiving one does not navigate. Check
this with the app foregrounded, backgrounded, and after ordinary process death.
Logout clears delivered notifications and disables receipt for the old account.
After a transient native listener failure, verify that notification taps recover
without restarting the app. Android alerts without display text show
`New notification`; silent read/done clears must remain silent.
Also verify logout and notification opt-out while registration is pending: late
backend or native completions must leave the receiver disabled. If a new account
signs in before cleanup finishes, its registration must remain active afterward.

Toast regions are labeled `Notifications (alt+T)`; seven empty live regions always exist in
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
`J` / `ArrowRight` and `K` / `ArrowLeft` use that same order in the Email view.
Arrow keys in a reply editor or other text input keep their normal editing behavior. They do not wrap; a thread
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

### Calendar invitations in email

In `/app/component/mail`, open an invitation message; the same card appears in
`/app/email/:threadId`. Saved details appear below the sender without waiting for calendar
sync. Expand guests and descriptions with their explicit controls. `View original email`
is an accessible disclosure that starts closed; attachments remain below it.
Related recurring components are grouped behind their own disclosure. Only mail synced
after the feature shipped gets a card; older invitations render as plain email.
A newly arrived scheduling update shows RSVP and Join only once its calendar state has
been checked. A series invitation shows its current or next live occurrence.

A connected, resolved invitation shows the responding address and Yes / Maybe / No.
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

### Agent reasoning effort

Open the model selector and hover a model to choose its reasoning effort in the
submenu. Keyboard users open it with Right Arrow; touch users tap the model.
Cursor and Macro's in-memory agent load the hovered model's own advertised
choices. The selected label includes the effort, such as `Sonnet 5 · High`;
there is no separate effort control in the input box. Models without effort
support remain selectable through `Use <model>` (or a desktop click/Enter).
Default keeps the model's existing behavior.

In an open session, choosing a different model's effort confirms the model first,
then validates and applies effort. Wait for the selector to become available
again. If the model succeeds but effort is rejected, the new model remains
selected with its confirmed effort; the error is shown and no unsupported
setting is presented as accepted.

New conversations confirm selected model and effort settings before sending the
first message. If startup reports a rejected setting or timeout, the first prompt
has not been sent. See [effort capabilities](../AGENT_EFFORT.md) for the harness
contracts and test coverage.

### Floating block information panels

Actions live in the top bar immediately before Share, with consistent compact
buttons (labels collapse on narrow headers). There are no Actions sections in
information panels. Markdown/tasks include Ask Macro and document/task dispatch; email
includes Ask Macro and Create task; PDF and calls include Ask Macro; native
projects expose Delete project with its existing confirmation dialog.

Standard metadata is quiet, non-collapsible text at the bottom of each panel,
separated by a muted divider. Owner and available timestamps share one format;
Markdown adds word/character counts. There is no standard Details or Stats
disclosure. Agent runtime information remains in its dedicated Session section.

Block information panels float over the right side of the block without changing
the content width or its centered position. A single rounded bubble fits its
contents, with `edge-muted` dividers between sections. Its height is capped at
the block height with internal scrolling. At every width it starts closed and
acts as a split-local overlay menu on desktop. The top-right sidebar icon, rotated
180 degrees, opens it, and clicking outside dismisses it. On touch devices the
control uses the Phosphor info-circle icon and opens the standard bottom drawer
with a drag handle, scrollable sections, and safe-area/keyboard-aware spacing.
Dismiss the drawer by swiping down or tapping its backdrop. Opening is never
restored from saved preferences or triggered by the global chrome shortcut. The 320px bubble enters
with a slight slide from the right and a 120ms fade;
closing fades it out in 70ms.
This applies across Markdown/tasks,
snippets, email, calls, agents, pull requests, projects, and all file blocks
including PDFs, images, code, video, canvas, unknown file types, and CRM company
and contact views (both inside the CRM workspace and in standalone blocks).

### Email reminders

Email's **Reminders** tab contains original conversations with active snoozes,
ordered by return time. Each row's clock opens the shared reminder command menu;
see [collection verification](reminders.md#email--reminders).

Use **H** on one selected email or its open conversation, **Remind me** in the
menu, or the header bell. These share the [email reminder menu](reminders.md#snooze-or-change-a-conversation).
A confirmed save archives the thread and advances within the invoking list.
Cancel and failed saves keep the current email. H on a pending snooze edits it;
**Remove reminder** returns it to the inbox. Bare H in a reply or search field
remains ordinary typing.
