# Email

## Thread motion

Message cards animate their height when expanding or collapsing a message or
its inline reply draft. Hidden messages unfold with the shared collapse
transition. Check repeated toggles during motion: the card should continue from
its visible height and settle to natural sizing, with no clipped editor or
attachments. Resizing the viewport and enabling reduced motion should settle
immediately. Touch replies keep their existing drawer behavior.

For an isolated check without account data, open
`/src/features/email-message/browser-test/motion.html` on the Vite server. It
uses the real message card and collapse transition with local sample content;
it does not exercise draft persistence or delivery.

## Email reminder delivery

An email snooze returns its original conversation to the inbox and adds a
notification to that email row in Home. It has no separate reminder toast or
detail view. See [Email reminders](reminders.md#delivery-and-undo).

## Email — `/app/component/mail`

Email's Tags sidebar uses the [nested tag tree](tasks.md#nested-sidebar-tags).
Carets and folder-only parents expand branches; actual tags select their exact ID
and switch the mailbox to All. Parent selection does not include descendant tags.
Unlike Calls, it lists only personal tags; team-shared tags are hidden,
and its `New tag` action creates a personal tag with no Team sharing option.

Full email client. Desktop groups `Signal` and `Noise` under one `Inbox` sidebar
item, with pill tabs beside the Inbox title in the content header, matching the
Chat sidebar tabs. Selecting Inbox
from another mailbox opens Signal; selecting it while in Noise keeps Noise.
The desktop sidebar continues with `Favorites`, `Drafts`, `Sent`, `Scheduled`,
and `Reminders` (when reminders are enabled), followed by a **Library** section containing `All mail`,
`Archived`, and `Shared`, then **Tags**. Sidebar number and sequential shortcuts
follow that order. Calendar mail remains available through the calendar filter
and existing Calendar route. Mobile keeps its original tabs and order, including
separate Signal, Noise, and Calendar tabs.
Compose via the `Email` button (or `Create` → `Email E`). On a fresh local user it
shows `Connect your email`; Gmail/Google Workspace and enabled Outlook connections
use provider consent. Most functionality needs a connected account. Search is `Ctrl+F` or `/` within the surface.

Mail-client keys work in the list, the reading pane, and the open thread while
Email is focused: `s` star, `z` undo the last action, and `g` then a letter
for a tab (`i` Signal, `o` Noise, `s` Favorites, `t` Sent, `d` Drafts, `e`
Archived, `a` All). These letters replace the app-wide `g` targets only inside
Email (`g t` is still Tasks elsewhere); `g h` still goes Home. `Escape` in a
list with nothing selected returns to Signal; in the reading pane it first
hands the keyboard back to the list. `?` lists every shortcut for the focused
view. `Shift+M` mutes the selected rows or the open thread, and `S` and
`Shift+M` also work on a thread opened in its own split. In a thread, `O` opens
or closes the selected message (the latest when none is selected), `Shift+O`
opens every message including the collapsed middle run, and `N`/`P` step
messages like the arrows. `Cmd+Up`/`Cmd+Down` jump to either end of a list.
In every composer `Cmd+Shift+.`, `Cmd+Shift+,` and `Cmd+Shift+D` discard the
draft exactly like its trash button, `Cmd+Shift+U` opens the attach picker, and
`Cmd+Shift+X`, `7`, `8` and `9` apply strikethrough, numbered list, bulleted
list and quote. Check discard from both a reply (the reply closes) and
standalone compose (the view goes back), with focus in the body.

Outlook connections support personal Outlook.com and individual Microsoft 365
inboxes. Choose the inbox explicitly when testing mixed-provider accounts. The
same thread, search, Signal/Noise, draft, and schedule surfaces apply to both
providers. Shared/delegated Microsoft mailboxes are outside this account scope;
sharing an inbox or thread inside Macro remains available.

A Microsoft 365 tenant that lets only administrators consent sends the user
back to an `Admin approval required` dialog with `Copy admin approval link`
(a tenant-wide approval link for IT) and `Connect a different account`.
Cancelling on the provider's consent screen returns to the previous view
silently. An administrator who opens the approval link returns to
`Approved. Try connecting again.` with the connect dialog open. On native
mobile the approval dialog is not shown; connect from the web app instead.

For Outlook writes, distinguish acceptance from provider confirmation. Thread
organization notices and inbox settings show pending or failed changes; the
mark-as-read from opening a thread is announced only if it fails. Draft sync and
delivery progress is silent, as on Gmail: a composer or sent message shows a
notice only for a conflict, uncertain or rejected delivery, revoked access,
unsavable content, or an inbox move. Use its recovery actions and check the
provider copy before choosing an explicit resend; a resend in flight shows as
the send button's pending state. Switching the sender
inbox copies the draft and attachments into the destination; wait for completion
before sending. If the copy is interrupted, use retry or keep the original.

Opening an attachment opens it in a split from its Drive copy, except a
calendar file: it opens its event (see the calendar invitations section of the
calendar guide), or downloads when Macro could not read one, and creates no
Drive file.

Imported Outlook attachments keep their provider identity, including inline
images. Cloud-reference attachment chips open the original Outlook message.
Forwarding a message with cloud references shows a notice to share those links
from Outlook; they are not downloadable files. Verify a native draft attachment
replacement, removal of the final attachment, and moving a populated folder into
and out of Deleted Items when exercising sync.

Sender names use each message's `From` display name, falling back to the
address-book name when it is absent. Multiple people or bots sending through
one address (such as GitHub notifications) retain distinct names within and
across threads. Verify in Mail and in Search with the Email filter and an empty
query: load more threads from the same address, then check that existing row
names and their hover cards do not change. Repeat with a text query to exercise
the search-service results.

`Favorites`, directly below Inbox on desktop, lists starred Macro emails across
Signal, Noise, and archived mail. It respects the selected inboxes and filters; search
within the tab is also restricted to favorites. Removing a star removes the row
from this view. The tab persists across reloads. With `enable-graphql-soup` on,
the paginated GraphQL Soup query uses `favoritesOnly: true`. With the flag off,
REST Soup uses `favorites_only: true`. Starring changes membership without
changing the list query. Text search still resolves favorite IDs for the search
service. An empty favorites list shows `No favorite emails`.

`Archived`, between All mail and Shared in the desktop Library section, lists
your own archived (Mail Done) threads: the
All mailbox with Done applied, excluding threads teammates shared with you. It
respects the selected inboxes and filters. The search service cannot filter
archive state, so search within the tab keeps only archived hits on the client.
Rows offer **Unarchive email**;
unarchiving removes the row at once. The tab persists across reloads. An empty
list shows `No archived email`.

A thread carrying a sent file shows a muted paperclip immediately before its
date, in every list layout. Inline images (an image with a Content-ID, such as
a signature logo) and calendar invites do not count; invites keep their own row
icon. Search-service results carry no attachments, so they never show it.

On desktop, a favorited email keeps a filled, muted star just before its
timestamp. Other rows reserve only that small star slot. Hovering reveals
**Star email** (Macro favorites), **Archive email** (Mark Done, with Undo), and
**Open command menu** for that email. The star stays in place; archive and commands
replace the timestamp within its existing space. Archived rows offer
**Unarchive email**; the archive control is disabled in tabs that do not support
Mark Done. The icons also appear when a button receives keyboard focus. Clicking
an icon neither opens the thread nor applies the action to other selected rows.
On touch devices, swiping a row left marks it done and swiping right opens
**Remind me** for it; the row springs back until a time is picked. Right swipes
that start within 40px of the left edge are left to swipe-back navigation.
Search results use the same reserved column, with actions aligned to the first
line; snippets, highlighted matches, and expanded hits remain unobstructed.

When switching email tabs or inboxes, the list shows current-query cached results
or a scoped `Loading email` spinner until they arrive—not the previous tab's rows
under the new heading. Active searches also hide retained results and show loading
while selected tag sets are pending. Background refreshes retain the current list. To check this,
rapidly alternate Signal, Noise, and Sent, then change inboxes; a delayed cache or
network read must not leave the old rows visible or expose their Load more action.

For native offline reads, let the GraphQL email backfill finish, block dev-service
traffic, terminate the app, and relaunch it. Open Mail and a backfilled thread:
cached rows and message bodies must remain visible while REST inbox identity and
mailbox-operation requests are pending or paused. Restore connectivity and check
that supplemental metadata appears without replacing the rows or thread body.
On the first mobile Mail visit, its filter button and Signal/Noise pills must
also appear. Navigate Home → Mail → a thread → Mail and verify those controls
survive header replacement, including with the network still blocked.

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
For optimistic mutation interface changes, delay the network response and verify
that only the affected row's read/done indicator changes, with scroll position and
unrelated rows retained. Quickly reverse the action, then reject the first request:
the later intent must remain visible. A stale refresh while either write is pending
must not clear its optimistic state. A retryable failure should remain queued;
a permanent failure should restore only the failed intent's fields.
With two views of the same thread mounted, a read/unread or archive scalar
change should update both existing query stores without a full query reread.
Observers of unrelated fields should stay idle. Changes to links, record
identity, or unsupported query projections still take the cache reread path;
a subsequent scalar update must not cancel that pending structural refresh.

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

The per-query caches for email threads, channels, and native offline document
context reopen closed IndexedDB connections. Verify a cached read and a subsequent
write after closing the connection, then clear/logout during recovery: old-account
entries must not return. These caches retry only transaction creation; persistent
storage failures still follow the existing cache fallback behavior.

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

**Reading pane.** On desktop the header's columns button (or `Shift+V`) shows
threads beside the list instead of in its place; the choice is remembered per
browser. The list keeps its own keys: j/k and arrows move the cursor and the
pane follows it (replacing history rather than adding entries) while the list
keeps focus, even if the thread is still loading; Mark done on
the open row follows the next row (an action on another row, such as the one
under the pointer, leaves the pane alone), and the open row keeps an accent
marker while the pointer highlights others. Rows there are full-bleed bands, not
rounded insets, and the open row's accent bar runs the row's full height. Enter
or a click opens the row and moves the keyboard into the reader, as does any
click inside the reader. Its keys live in a child hotkey scope so they never
replace the list's, and while it has the keyboard the list's keys stand down,
so `x`, `Cmd+A`, `End` or `Shift+Enter` in the reader never act on the list.
j/k in the reader step threads and move the list cursor with them, replacing
history. Escape in the reader, once there is nothing to unwind, hands the
keyboard back to the list without closing the thread. Narrow email rows here
stack senders and date, subject, and one preview line beside a slim unread-dot
gutter (no per-type icon); unread rows are bold, hovering swaps the date for the
row actions, and hovering the gutter shows the select checkbox. Phones keep
their own touch email rows, with the sender's picture on the left.
Without room for both (narrow split, collapsed window) the pane folds away and
a thread replaces the list as usual; the thread remounts, but a reply draft
survives. The divider can be dragged; the list width is remembered. Verify that
list `e` still works after switching threads in the pane (the reader's `e` must
not replace it), and that after j/k the grid still has focus: the next Enter
moves into the reader without opening a reply.

In the new Email view, ordinary row activation opens the thread inside
`/app/component/mail`; the view breadcrumb (for example Inbox) has a hover
background and returns to the filtered list. Pressing `Escape` in the open thread
with focus outside any input does the same once there is nothing left to unwind
(an open reply, an expanded body, or a focused message each take one `Escape`
first); the list keeps the row you came from focused. The inline header uses the existing
email title menu: open the menu button beside the subject for **Ask AI**, **Create a
Task**, and the other thread actions. On desktop, **Mark as unread**, **Mark done**,
and reminders share one outlined group at the right of that header. Separate
groups contain **Previous item** / **Next item**, icon-only **Ask Macro** / **Create
task**, and the **Share** icon and label / copy-link icon. Mobile keeps its existing
controls. The arrows
follow the current filtered list and disable at its ends. When the open thread
leaves the list while it stays open (a reply in Signal marks it done, or another
device archives it), they step from its former neighbours. Mark done advances in
that list. In a list, the Mark done, Mark as not done and Delete keys act once per
press: a held key auto-repeats, and those repeats are ignored. Mark as unread (in
the header or title menu) returns to the originating list with its tab, inbox, and
filters preserved. Mark as not done and Mark as read
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
the same subtle 3D rim in dark mode, and a faint hover tint. The selected
card uses a 2% ink wash, brighter than that hover and lighter than a hovered
settings row. Desktop selection does not add an accent-colored ring; keyboard
focus has a neutral outline.
On touch, the floating Reply, Forward, previous/next email, and done controls
use the mobile dock's chrome fill and icon color in both themes.
Replies appear inline on desktop and in a full-screen composer on touch devices,
including tablets. Reply, Reply all, and Forward use the same grouped header
actions as new email: attach, schedule, and send. The schedule clock matches
Attach's touch icon size. The Back control returns to the thread; when a reply
has content, choose Save Draft or Delete Draft. Escape
and Android Back follow the same close flow, including Escape with a header
button focused. Closing an empty reply discards its local/server draft and
removes its Draft preview from the thread. Saving must finish before leaving;
a failed local save keeps the composer and draft options open. The message list
stays mounted underneath so closing a reply preserves its scroll position.
On touch, a saved reply shows as a **Draft** row with its opening words under the
message it answers (which stays expanded); tapping it reopens the draft.
On desktop, a saved reply that reappears with its thread (opening it, stepping
to it with j/k, the reading pane following the list) stays unfocused, so the
next j moves on instead of typing into it; `r` or a click continues it.
Desktop draft bodies and app-controlled message text use 15px, matching channels.
HTML messages with preserved sender typography retain their explicit sizes.
Desktop reply actions sit together at the bottom right: discard, attach, schedule,
then Send, with circular hover backgrounds inside the card's 16px padding.
Standalone compose uses one right-aligned row inside its 16px content padding:
delete, attach, format, schedule, and send. Touch compose uses its header toolbar.
`R` and `Alt+R` (`Option+R` on macOS) open reply-all for the selected message,
or the latest message when none is selected. `F` opens a forward and focuses To.
In new emails, replies, reply-alls, and forwards, `Cmd+Shift+C` (`Ctrl+Shift+C`)
reveals and focuses Cc and `Cmd+Shift+B` does the same for Bcc, expanding a
collapsed reply header; inside a composer they never fall through to the
thread's Copy link. `bunx playwright test --config
src/features/email-compose/browser-test/playwright.app.config.ts` (from
`apps/web`) checks both shortcuts in all four composers.
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
Files that would push the email over the sending inbox's delivery limit (18 MB
on Gmail, 25 MB on Outlook) are not attached:
a confirmation (a drawer on phones) offers to upload them to Macro and share
view-only links instead. Confirming inserts one link per file at the end of the
written message, above a reply's quoted thread, and the draft autosaves; Cancel
adds nothing. Files that fit still attach, and the same check covers files
dropped onto the body.
To forward from another inbox, open Forward, expand the forwarding envelope on
desktop, and select a different account in From (already visible on mobile).
Forwarded files must remain attached after switching to an owned or delegated
inbox, saving, and reopening the draft. Send must fetch the original files from
the receiving inbox while using the selected From inbox for delivery. A scheduled
cross-inbox forward must not download a source whose inbox access was revoked
after saving.
When checking draft autosave, edit the body of a draft with uploaded or forwarded
attachments, wait for the save, and reopen it; the attachments should remain visible.
In a long thread, scroll away from the bottom while a draft save is pending.
After repeated saves, the scroll position, editor selection, and received-message
DOM must remain stable on desktop and mobile. Reopening must show the saved body.
Repeat with a save completing after the thread closes; reopening must still
load the latest saved draft.
Ordinary queued saves must not request another `EmailThreadPage`; a missing
thread snapshot or a move between inboxes still requires reconciliation.
AI email tool drafts persist body-only edits; changing recipients or the subject
is not required to save the body.
For an AI-drafted reply with no explicit sender, the backend selects the inbox
that received the original message. Delay the reply-inbox lookup: the composer
shows `Resolving sender...`, hides the signature, and disables Send (including
the keyboard shortcut and batch submission). Fail the lookup and check Retry; choosing a From inbox
also enables sending immediately. A late lookup must not overwrite that choice.
Implicit senders omit `from` on edits and sends. An explicit sender is preserved
even while inboxes load or after disconnection; an unavailable sender blocks Send
until another connected inbox is selected. New emails default to the primary
inbox after inboxes load. Repeat on mobile using the expanded `Cc/Bcc, From:` row.

With GraphQL draft queuing enabled, working copies and pending attachment bytes
are saved on this device independently of the mutation queue. A failed server
save must leave the draft discoverable in **Drafts** (including grouped views)
and in its reply thread. Saving is silent on desktop and mobile: no saved or
syncing text appears, including offline. A failure shows a banner inside the
composer, above the recipients, with **Retry** (or **Retry discard**); it never
appears in the toolbar or the mobile header actions. Verify the banner on mobile
sits below the header and that editing while failed continues saving locally
without repeatedly submitting the rejected request.
Local draft storage reopens unexpectedly closed IndexedDB connections. If creating
a transaction fails because the connection is closing, it retries once before
running any writes. When WebKit aborts a started transaction (typically while the
iOS app is backgrounded), the whole transaction, draft or outbox, replays on a new
connection, at most three attempts; a save recognizes its own commit, so a replay
never duplicates a revision. Each edit is written locally at once; any visibility
change, such as hiding the app, also sends the debounced server save immediately
and retries a failed local write with the live editor content. Verify by closing
the draft database connection, then editing: the latest content must persist
locally and server autosave must continue without reloading. Repeat across
background/resume on an iPhone. Persistent failures still block server autosave;
copy unsaved content before restarting. Storage failures and recovery report
current page visibility and network state without draft content.
Request errors settle only after the transaction's abort event, preserving the
underlying IndexedDB error and waiting for rollback before recovery or replay. To
verify, force a request constraint failure: the prior draft must remain intact,
the error must be `ConstraintError` and is not replayed, and a subsequent valid
save must succeed.

Repeated local-save failures show one persistent warning per composer; a later
successful write or closing the composer dismisses it. Closing writes the failed
edit once more, unless send, discard, or a reset already cancelled it; if that
write also fails, a brief warning shows after the composer closes. A later
failure shows a new warning.
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
Verify that an unrelated queued action still completes in both cases. With
browser OTel enabled, the failure appears once per draft as
`graphql.mutation_queue.recovery_failed` (or `graphql.mutation_queue.skipped` with a
`mutation_queue.skip_reason`), never as a line per poll.
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

Sending a reply from an inbox thread marks that thread done but stays on it.
Send and mark done (Shift+Cmd+Enter) and Mark done open the next email, counted
from where the thread sat when it was opened (a reply draft lifts its thread to
the top of Signal while it is written). If the user has already moved to
another thread when the send finishes, the replied thread is marked done
without navigating; Undo before then leaves it in the inbox.
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

**Send** always persists new messages, replies, and forwards for Gmail and
Outlook in device email storage; no outbox feature flag is required. This works
with either thread read transport, including when normalized-cache
initialization has failed. Recipients, inbox, sender alias, body, displayed
signature, and attachment references are frozen under one attempt ID. Completed
uploads are required; adding files offline is unavailable.

**Send Later** schedules the saved draft through the schedule endpoint instead
of the outbox. It shows **Email scheduled** with the send time, **Undo**, and
**View message**; the message stays a draft, is listed under **Scheduled**, and
opens with **Scheduled for …** and **Cancel**. Cancelling leaves it an editable
draft. Sends scheduled through the outbox before this change still show in the
status panel with **Cancel**.

An authenticated app-level dispatcher submits online immediately and retries the
same attempt independently of unrelated draft, archive, and property mutations.
An online send shows **Email sent** with **Undo**: a new message opens its
conversation and a reply closes its composer, and the message appears as sent
there immediately, before the server or provider confirms it. An offline send
shows **Email queued to send** and returns to the email list. Routine delivery
is otherwise silent: the status panel shows a send only while it waits on this
device (**Queued on this device**), needs attention, or is scheduled
(**Scheduled**). On phones the panel sits below the safe area and the floating
header. Only one active send can own a draft across tabs; queued composers
remain read-only.

Queued sends remain visible in **Drafts** and their conversation with a persistent
status and **Cancel** action. A never-attempted send can be cancelled offline.
If admission may have reached the server, **Cancellation pending** keeps it locked
until the server confirms cancellation. A definitive inbox-access rejection of
the first submission permits restoring the saved draft locally. Verify this still
works after reload without a cancellation request to the inaccessible inbox.
A lost response followed by an inbox-access error must remain locked. Once delivery starts, cancellation may
be too late. Confirmed cancellation automatically restores the working copy,
including after navigation or reload. Restoration and removal of local send
authority commit together. It preserves newer edits and fences callbacks from
before cancellation; older autosaves cannot overwrite or delete the restored copy. A failed queue attempt retains recovery content;
cancel it before restoring and sending again. The server starts the undo delay
at first admission, so reconnecting does not consume that delay while offline.
The send toast's **Undo** works after navigation closes the composer. It shows
**Cancelling send…** until the server confirms, then **Send cancelled**, and
restores the draft only after that confirmation. The open conversation reads the
thread again, so the cancelled message never stays visible as sent beside the
restored draft. The restored draft carries the server's advanced generation, so
it can be edited, sent again, or discarded. Cancellation that cannot be confirmed in time, an expired undo
window, and failed cancellation each display a notice. Delivered attempts
remain complete even if the sent message is later deleted from the provider.
After Undo, delay the accepted cache record's refresh: the newer restored draft
must still reopen with its body and attachments. A later confirmed send must still
prevent reopening that older draft.

In local backend tests, delete a message after acceptance and during uncertain
submission. Its body, attachments, delivery job, and reconciliation identifier
must remain intact. After cancellation, the deferred deletion must not delete the
restored draft or a subsequent send, even when the provider ID stays the same.

If an approved attachment is no longer available before delivery, the send stops
with a failure so the draft can be restored and reviewed. It must never silently
send a smaller attachment set. An interrupted worker can retry preparation, but
after submission may have begun it only checks Gmail for the original Message-ID.
An unresolved outcome shows **Delivery unconfirmed** with **Check status**; it
remains locked and is never automatically resent. A confirmed Gmail match marks
the original attempt delivered. A definite preparation failure or provider
rejection allows cancellation and draft restoration.

When Gmail sync imports a delivered message before recovery completes, recovery
keeps the Gmail-synced conversation and the original local message ID. Links to
the now-empty draft conversation redirect for users with access to that inbox.
Sharing only the old conversation must not grant access to the destination.
Existing properties and reminders on the old conversation stay attached to it.

Switching an existing draft's sending inbox while offline must send from the
selected inbox after reconnect, even when the intermediate draft save is still
queued. Uploaded files remain attached. Forwarded and imported provider attachments retain their source-inbox access checks.
Provider-bound drafts use the explicit inbox-transfer flow. Accepted Outlook
sends remain owned by its provider coordinator; ambiguity is reconciled there.

Verify: queue a new message and a reply offline, close and reopen the app, and
check their persistent status and read-only content. Cancel one before reconnect
and confirm its send mutation is never issued. Reconnect the other and check
that one stable attempt is replayed even after a lost response. Also test a
cancel racing admission, unavailable local storage, and a pending upload.
Send a standalone message, let it open its thread, then use the toast's Undo and
confirm the original draft reopens. Repeat after delivery starts and check the
visible failure notice. Cancel a draft-only thread and check it returns to Drafts
without requiring another save.
Restore both a standalone draft and a reply, then edit and save without reloading;
confirm the original content is visible and no send watermark returns. While a
standalone send is queued, verify sender, recipients, subject, body, attachments,
signature, formatting, schedule picker, delete, and Send remain disabled. Only
Cancel may change the queued send. The disabled reply Send action explains
**Queued to send. Cancel the send before editing.**
Open the formatting ribbon before queueing
and verify it disappears while locked. Repeat after reload and restore in the
same mounted composer; no schedule proposal should survive the queued state.
Drop an inline image while queued and confirm no upload or insertion occurs.
Queue the same draft from another composer while its link editor is open;
the link editor must close. Repeat while image conversion or file upload is
pending and verify completion does not insert content into the locked body.
While a
reply is queued, click Forward on another message and confirm the queued content
and recipients stay unchanged. Race Send from two tabs and confirm only one
active intent exists; cancellation must not leave a second send queued.
Queue Send before the latest edit reaches the server. The send journal takes
ownership of that exact local revision. After cancelling, edit the restored draft before reconnecting and verify those later
edits still sync. Repeat across tabs: a newer local edit racing Send must block
the stale submission, and old send cleanup must preserve a restored draft and
its attachments. Logout should warn about queued sends even after their original
local working copies have been retired; it must not claim to cancel server sends.
Approved local sends survive sign-out, are hidden from other accounts, and resume
only when the same account signs back in. The status panel also lists failed,
unconfirmed, and scheduled server attempts from other devices, with pagination. Cancelling one must
preserve this device's unsynced edits. A malformed or newer-version journal record
shows a recovery warning, retains its recognizable draft locks, and does not stop
unrelated valid sends. Reconnecting an expired email account requires **Check
status** to resume a paused local attempt.

New messages and replies persist a local draft identity before Send; an ordinary
autosave does not need server acknowledgement when the frozen message and
completed attachment references are available locally.
GraphQL draft saves automatically retry only network failures. GraphQL errors,
including internal, invalid, and unauthorized errors, fail the mutation and
release the queue. The local working copy offers explicit Retry. Send and Send
Later capture the latest local revision and completed attachments for offline
delivery.
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

Attachments require connectivity: adding files offline is refused in both composers.
Existing attachments stay visible and preserved while offline, but Send and Schedule
send require reconnection for any draft with attachments. Online, clicking Send before
a save debounce finishes must start or continue uploads; a queued save's confirmation
must also resume pending uploads after reload. Pending or failed inline image/video
uploads block Send and Schedule send until they have durable URLs or are removed.

Queued sends survive query-cache recovery in independent account-scoped storage,
retaining their original attempt IDs, frozen bodies, attachments and cancellation
requests. After cache loss, status reconciliation must reuse that attempt identity;
it must not create a second delivery.
Cancel a reconstructed send while its original HTTP request is delayed: the draft
must stay locked until the server confirms cancellation, even if recovery's status
lookup found no attempt. A fresh queue entry cannot prove the original was never tried.
Repeat while the general GraphQL queue is blocked on an unrelated mutation;
Outbox submission and cancellation must proceed independently.
After durable reply Undo, delay the restored working-copy read until UI callbacks
finish, then edit and send again. New edits must save using the restored generation.
Repeat provider draft sync followed by trash and a new explicit Send: a delayed
Undo for the trashed send must preserve the newer send's schedule and body.
Restart after persisting Cancel but before submitting it: app-shell recovery must
finish cancellation and restore the draft atomically. Repeat with no email view
mounted. Reset the actual WASM cache and verify the independent send journal,
approved body, attempt ID and draft reservation remain intact.
Cancel and Restore must win over a delayed Send completion in both composers. Start
another send after restoration, delay its preparation, then release the old response:
the newer send must remain locked until its own preparation and delivery finish.
Restore while an editor is still connecting and verify that its text, HTML, or
empty body survives initialization. Leave a reply attachment picker open, start
restoration, then finish picking a file: the delayed callback must not change
attachments until restoration completes. Existing attachments must stay intact.
Trashing a thread may cancel unsubmitted scheduled drafts, but must preserve
submitted and delivery-unconfirmed claims. It must not make either send appear
cancelled or allow a second delivery while the original outcome is unresolved.
Resizing media must stop immediately when an editor
locks, including an active drag and a pending debounced resize. Open the GIF
picker before the lock arrives: it must close, and a pending selection or
deferred opening must not insert content into the locked draft.
Keep an oversized-file link confirmation or upload pending while another tab
queues the send, changes the inbox, or restores the draft. Its late completion
must leave the uploaded files private and the draft body unchanged. Restore a
queued reply while Send and mark done is waiting for the next page: the delayed
completion must not archive the restored thread.

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

Scheduled delivery failures replace the time summary with **Send failed before
delivery** and **Restore draft**. Restoration cancels delivery before unlocking the
message. **Delivery unconfirmed** explains that the email may already have been
sent and offers **Check status**; it never offers restoration or automatic resend.
The time picker stays disabled for failed, sending, and unconfirmed deliveries.
Preparation that has not reached provider submission remains cancellable, including
after its due time or a retry delay. Verify both standalone and reply composers,
including a status refresh whose scheduled time is unchanged and a failure arriving
while a replacement time is selected.
Block the REST lifecycle read while GraphQL loads a failed scheduled draft. It
must still show failure recovery and keep the time picker disabled; GraphQL
provides both the scheduled time and delivery status.

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
single-row header: title (with Signal/Noise tabs beside Inbox), inbox/filter
controls, reading-pane option, New, and an expandable Search icon. At 640px or
narrower, the list header shows Signal/Noise, the reading-pane toggle, and Search;
outside Inbox, the mailbox title replaces those tabs. Its outlined
`New` button also sits directly
below the sidebar title, above a flat, outlined **Accounts** group with the same
control background. Its selector shows
the current account or `All inboxes` and opens a single-select dropdown of linked
accounts and aliases. `Connect another account` starts the add-inbox flow from
the group's separated footer. On desktop, `All inboxes` uses the shared avatar
group to overlap the first two account portraits with a separator ring; aliases
do not repeat a portrait. A single selected inbox shows its own portrait.
`New email` prefills From with the selected inbox, or the primary
inbox when All inboxes is selected; reopening a draft keeps its saved sender.
The From menu groups each connected inbox with its verified Gmail send-as aliases.
Replies default to an address on the thread's own inbox: preserve an outgoing
message's From, otherwise match To before Cc/Bcc (prefer an alias within each
recipient group). A manual choice or saved draft takes precedence over late
account refreshes. Reply-all excludes the inbox's primary address and its aliases.
Aliases are scoped to their owning inbox, even when two inboxes share an address.
A failed alias lookup for one inbox does not hide other inboxes' aliases. An
invalid or unavailable selected alias is rejected on save/send, never silently
replaced with the primary address.

The sidebar and mobile inbox picker also list aliases beneath their inbox.
Selecting one scopes mail to that inbox and the exact address in From/To/Cc/Bcc;
search candidates are checked against the same GraphQL scope. Search and Reminders
automatically advance nonmatching candidate pages until a match or exhaustion;
while alias membership is loading, wait rather than treating it as an empty inbox.
Refresh retries both search and alias membership. A failed retained membership
lookup shows an error without discarding already-confirmed rows. If a saved alias
disappears from the catalog, the primary address must not look selected; use
`All inboxes` or choose an available address to clear that scope. Scheduled mail
matches its saved sender. `All inboxes` clears both the inbox and alias selection,
and the selection survives reloads. With one inbox **and aliases**, the All row
and address pickers remain available. To check without sending real mail, open
both pickers, select an alias, switch to the primary address, reopen a saved alias
draft, and confirm the address remains unchanged. Alias discovery uses
`MailAccounts`, draft saves use `saveEmailDraft`, and delivery uses
`sendEmailAttempt` for durable delivery or `sendEmailMessage` for foreground
GraphQL delivery; the existing undo-send window still applies. Verify an alias
through offline queueing, reconnect, and Undo: it must stay attached to the
captured inbox and must never fall back to that inbox's primary address. Existing
queued sends created before alias support must still replay with the same attempt
identity.

If an explicitly selected sending inbox is unavailable, Send reports
`Unable to find linked email account. Select a sending inbox.` without delivering
through another account. The From picker stays available as `Select sending inbox`,
including when only one linked inbox remains. On mobile, expand `Cc/Bcc, From:`
to choose the sender. Selecting an available inbox clears the error and allows
sending; the picker never displays another inbox as selected before that choice.
With no explicit selection, an unavailable primary still falls back to
the first linked inbox.
The desktop account dropdown marks the selected inbox with a checkmark. With
exactly one connected inbox and no aliases, the selector displays its address
and omits `All inboxes`; the mobile filter drawer has no inbox section. The
touch sidebar keeps its existing account rows and shows up to four before
scrolling independently. With many accounts, scroll to the last inbox in the
dropdown and check that selecting it updates the selector and header filter.
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

## Email reminders

Email's **Reminders** tab contains original conversations with active snoozes,
ordered by return time. Each row's clock opens the shared reminder command menu;
see [collection verification](reminders.md#email--reminders).

Use **H** on one selected email or its open conversation, **Remind me** in the
menu, or the header bell. These share the [email reminder menu](reminders.md#snooze-or-change-a-conversation).
A confirmed save archives the thread and advances within the invoking list.
Cancel and failed saves keep the current email. H on a pending snooze edits it;
**Remove reminder** returns it to the inbox. Bare H in a reply or search field
remains ordinary typing.

### Cache initialization recovery

With the GraphQL draft queue enabled, block the cache WASM download until its
bootstrap retries fail. Compose text and verify it remains saved on this device
with a synchronization status and Retry. Restore network access and reconnect or
press Retry: the same composer and working copy must remain, and synchronization
must resume only after the preserved queue is readable. Repeat while another tab
holds the cache owner lock; recovery must never steal the lock or erase its queue.
Storage/schema failures that cannot prove preservation show recovery/update
instructions instead of repeatedly reopening potentially damaged storage.
