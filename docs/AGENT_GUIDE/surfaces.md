# Other Surfaces

## Top bars

Right-aligned split-header actions (including Calendar's New event and Channel's
Call and Ask Macro) are borderless with a rounded-xl background on hover. Channel
header tabs use fully rounded tracks and selected pills.

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
starts an Edited activity for that editing session. Human edits
are attributed to the signed-in editor; agent edits retain their agent attribution.

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

When `enable-tasks-reviews` is enabled, `Reviews` appears above `My Tasks` as a
shortcut to the separate Reviews view. It lists relevant open GitHub pull requests;
selecting one opens `/app/reviews/pr/<foreignEntityId>` with a Reviews breadcrumb.
See [Tasks](tasks.md#reviews-view) for verification.

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
offline action followed by reconnect. Sent-only threads cannot be unarchived.

The service retains both replica-backed Soup reads and a primary-backed email
writer. Email mutations and their uncached reply reloads use the primary; ordinary
GraphQL/REST lists, direct Soup lookups, and realtime Soup hydration use the replica.
A mutation reply is fresh, but subsequent list refetches are eventually consistent
and can still return replica-stale read/archive state. Test that boundary separately
from mutation reply correctness. A post-commit reply-load failure is retryable;
it must not discard the queued intent. Deploy
the backend schema containing `setEmailThreadArchived` before this client.
Browser WASM and native cache builds must include the regenerated schema metadata;
native offline archive support therefore requires a full app build, not just OTA.

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

The path selects the Month, Week, or Day period, and choosing another period updates
that path. Calendar navigation defaults to Day on phones and Week on desktop; the most
recent choice is remembered locally for navigation that does not specify a period. An
opened event is reflected in the pane-owned `sN.calendar.eventId` search parameter.

Quick-call creation, incoming invitations, Live lists, Macro meeting links, and
the `/app/meet/*` routes require the PostHog flag `enable-quick-calls`. While the
flag loads or is off, those controls stay hidden and meeting routes do not mount
call setup. Existing channel calls and the upcoming-events list remain available.
For local verification, set `VITE_ENABLE_QUICK_CALLS=true` or `false` explicitly.


Calendar event creation and editing open in a bottom sheet on touch devices,
with scrollable content above the keyboard. Desktop retains the centered dialog.
Dismissing a changed event still asks before discarding the draft.

On phones, event details use inset round action buttons and a transparent RSVP
footer. Answering a recurring invitation opens a rounded glass sheet: choose
`This event` or `All events`, then `Save response`. Cancel or Close returns to
the event details without sending a response.

The calendar header has matching `New event` and `New Call` buttons. Both stay
available in narrow splits and on phones, where compact icons have accessible
labels. `New Call` opens call setup; it is no longer in the right side panel.
Week view also has a `Choose calendar view` menu, prev/next week,
`Search events`, `Calendar settings`, and a mini month picker in the right side panel.
The mini calendar's month label opens a month picker; arrows also change months.
The right side panel has a collapsible `Upcoming events` box.
Active Quick Calls you created, participated in, or were invited to appear above your
next five events (including ones in progress), whether or not they have call links.
The active area is hidden when no calls are active. Event rows show the name and
time; click one to open its details. An event with a call link shows `Join` while
it is in progress. Upcoming events follow today's date even when you browse another week;
hidden calendars, cancelled events, and invitations you declined are omitted.
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
Events require connecting a Google account (`Connect calendar`). The
`Calendar settings` (gear) menu has an `Accounts`
section listing each connected account with a per-account `Enable` (grant calendar) or
`Turn off` action, plus `Connect another account` to connect a new Google account
(email + calendar).

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

The side panel's `Calendars` section folds each connected account into a collapsible
group: a caret plus the account address header with a checkbox that shows or hides all of
that account's calendars at once, and the account's calendars listed beneath it (color dot,
name, per-calendar checkbox). Accounts start collapsed. Subscribed system calendars
(Google holidays, birthdays) carry a small RSS icon. A calendar whose sync has been failing persistently carries a small
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
breadcrumb, PR title/status, GitHub action, discussion timeline, and Details/Checks
side panel below the top bar. PRs are not tasks and do not appear in the Tasks list.
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
press `Join call`. Setup requests device
permissions and previews video locally; sharing starts only after joining.
Permission denial leaves the affected device off and still allows joining.
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
It keeps its label and shows a checkmark for a few seconds after copying, then
restores the copy icon.

Guest access is limited to the call room; joining does not expose the channel or grant
anonymous access to saved transcripts and recordings. Guest names are preserved in
the host's call history. Signed-in attendees receive access to that session's saved
call without gaining access to the channel.

The join screen, in-call participant tiles, and incoming direct-call badges use
profile pictures; initials are the fallback when no photo is available.
The join screen uses small switches for Microphone and Camera. Join and
`Copy Meeting Url` use gray buttons; the copy action includes a copy icon.
The in-call header uses the same copy button and shows the current local time
before the call name. Owners can click the name to rename it, then Save or press
Enter; Cancel or Escape discards the edit. Guests and other participants see a
read-only name.

### Sharing a call

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

Company selection actions **Set owner** and **Set revenue** remain available
while team deal-stage definitions are loading. **Set stage** waits for the active
team definition rather than opening an editor with system defaults. Check both
the entity actions menu and command menu with stage requests delayed; cancel the
editors without changing hosted data.

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

To verify document content activity, keep Activity open in one tab and edit an
existing document's body in another, without renaming it. The editor's Edited
entry should arrive for the first edit. Keep typing across multiple saves: the
activity count must stay unchanged. After five minutes without editing, the next
edit should add one new event. Reconnecting within that window and opening or
closing a document without edits must not add an event.

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

### Email signatures

In Integrations, **Edit signature** beside an owned inbox expands its editor.
The editor uses the app's background and text colors, including in dark mode;
explicit colors in signature content are preserved. **Close signature editor**
(the X) or Escape while focused in that inbox row collapses it and returns focus
to **Edit signature**. Unsaved edits remain when reopened; closing does not save
or remove the signature.
The inbox row's trash icon removes the inbox through the existing confirmation;
it is separate from the signature editor's close control.

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
previous scroll position. `API Keys` is desktop-only and has no row here.
**Close settings** at the top right, Escape, an
outside tap, or a downward swipe dismisses the sheet. A tap that dismisses a
menu opened inside the sheet leaves the sheet itself open. Opening Settings again
starts at the main page; explicit links (for example Account) open their
section directly. Existing settings URLs open the requested section in the sheet
and restore the underlying app route. The header stays visible while forms
scroll, including with the keyboard open. On desktop, `/app/settings/<tab>`
opens settings fullscreen, while `/app/inbox/~/settings/<tab>` docks it beside
Inbox. **Open fullscreen** pushes a standalone settings URL; browser Back
restores the preceding split layout. **Move to split** restores the app layout
and docks the selected tab, while closing a docked settings pane minimizes it.
A direct fullscreen link returns to Inbox when there is no prior app layout.

Left nav: General → `Account` (profile, delete account), `API Keys` (create /
list / delete personal keys; the secret is shown only once and is sent as
`x-macro-user-api-key`), `Notifications`, `Billing` (current plan card with
`Manage`; only in dev (`dev.macro.com/app` or a local frontend using the dev
backend), paid plans show an **AI usage** card with the period meter, credit
balance, credit-pack buttons `$10`/`$25`/`$50`/`$100` that redirect to Stripe
Checkout, and a `Usage billing` toggle with per-period limit pills; these
controls and usage-billing promotional copy are hidden outside dev; an
`Upgrade`/`Upgrade to Max` card, or a `Switch to Premium` link on Max; on a team
the plan change moves only the viewer's own seat),
`Appearance`, `Agents`, `Mobile App`, `Shortcuts` (interactive keyboard visualization, not a list);
Workspace → `Team` (members list; on a paid team each row shows the seat's plan,
and admins/owners change it with the `Seat plan` menu: `Premium` or `Max`,
prorated at once), `Tags`, `CRM` (enable/disable; once enabled, a `Deal stages` section
with `Customize stages`, inline rename, reorder by drag handle or arrow keys (up/down
buttons on touch), delete, `Add stage`, `Reset to defaults`, and `Closed stages`
checkboxes, editable by the role set as `edit_stages_role`),
`Integrations` (personal Gmail/GitHub accounts), `MCP server`
(setup snippets for Claude Code / Codex CLI / Claude.ai / ChatGPT / IDE), `Bots`;
`Log out`.
`Agents` unifies agent definitions and runtime configuration in one page, also used by the Agents workspace. Its `Agents` section lists team and private agents. `New agent` / `Edit <name>` open full-page forms grouped
Profile, Behavior, Runtime, Connections, Channels, Share. Connections is a radio pair:
`Use my connected apps` (default; the agent gets whatever the person running it has
connected) or `Specific apps`, which reveals a `Search connectors` box over the whole
Pipedream catalog (results are `option` rows; picking one adds it) and a row per picked app
with a connected / not-connected dot for the *current viewer* plus an inline `Connect`
that opens the Pipedream Connect flow inside the page. Unconnected picks never block
saving; each teammate connects their own account. An agent session that calls a picked
but unconnected app gets a tool result saying so, and the agent's reply renders a
`Connect <app>` chip that opens Agents → Connections for that app. MCP integrations
are managed on that page, rather than in Settings.

With `pipedream-mcp` enabled, Agents → Connections has `Connected` and `Discover`
tabs. Connected groups GitHub, Linear, Notion, and Slack tool grants by provider,
lists other catalog connections alongside them, and puts custom MCP servers in
a separate section. Discover offers featured providers, a searchable catalog,
and `Add custom MCP`. Slack discovery retains its development-only gate.
Provider Back returns to the tab that opened it; navigation is local to each
Agents workspace and starts at Connected on a fresh visit.
Provider and custom-server More menus contain Disable, Reconnect, and Disconnect;
custom servers also offer Rename. Disabled grants show Enable. Unauthenticated
custom servers show Connect and Remove. Disconnect/Remove require confirmation.
Adding a custom MCP saves its name and URL; Connect on its row starts OAuth.
An agent reply's `Connect <app>` chip still starts that app's connection flow.
Cursor stays in Agents → Runtimes with its API key and default model controls; it is not
featured or offered in the Connections catalog. Personal Gmail and GitHub account
links remain in Settings → Integrations. The native-only Connections page remains
available when `pipedream-mcp` is disabled.
`Back to app` returns to the previous surface. Open via user-email button menu or `Ctrl+;`.

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
