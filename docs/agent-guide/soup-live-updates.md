# Live updates in flat Soup lists

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

Desktop multi-select filter menus in Home, Tasks, Drive, Email, Reviews, Search,
CRM, Calendar, and database option-value filters close after an ordinary click or
Enter. Hold Shift while clicking or pressing Enter to toggle individual options
and keep the menu open for further selections. Shift does not select a range.
Single-select controls and mobile filter drawers retain their existing behavior.

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

## Connection recovery

Transient live-update interruptions recover silently without a disconnected
toast or page reload. Verify browser and native online signals, backgrounding
and foregrounding the mobile app, and a temporarily failed authentication refresh.
After reconnection, mounted lists and notification readers should refresh missed
updates. A rejected login stays paused until a fresh session; logging out must
retire old subscriptions before another account signs in.
