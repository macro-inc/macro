// Every difference class the runs produced, closed. A class matches by its
// signature; anything a run reports that matches nothing here is
// "unexplained" and fails the run (and is how a mutant is caught).
//
// Line numbers are in apps/web/src at the PR head; graphql-soup.ts is not
// changed by the PR, so every `graphql-soup.ts` cause is main's own GraphQL
// mapper, which main already serves for every list not sorted by
// notification time.

export type Closure = {
  id: string;
  match: RegExp;
  title: string;
  /** Where the difference comes from (file:line). */
  cause: string;
  /** What callers do with it, and the evidence. */
  outcome: string;
  /**
   * The closure holds only while main's own GraphQL reader gives the entity
   * the branch's value (run.ts reads it as a third side); a disagreement
   * counts as unexplained.
   */
  needsRefAgreement?: boolean;
  /**
   * The PR commit that fixed this difference. A fixed closure explains
   * nothing: on a head with the fix, a match is an open difference again.
   */
  fixedIn?: string;
};

const MAPPER = 'lib/service-clients/service-storage/graphql-soup.ts';
const DOM_EVIDENCE =
  'Caller level: every Home comparison (dom phase and every fifth sequence step) renders the same rows, order, unread state and labels on both sides, apart from D1.';
const field = (pattern: string) => new RegExp(`(^|\\s)field:${pattern}$`);

export const CLOSURES: Closure[] = [
  {
    id: 'C1',
    match: /^same-instant:/,
    title: 'Same instant, two spellings',
    cause: 'REST serializes timestamps with `Z`, GraphQL with `+00:00`; the instant and every fractional digit are equal (lib/classify.ts sameInstant).',
    outcome: 'Invisible: callers parse these with Date.parse / new Date before showing, bucketing or sorting them.',
  },
  {
    id: 'D1',
    match: /dom:initiative-only-in-new:open-notification$/,
    title: 'Home shows an initiative with an open notification only on the branch',
    cause: `Main serves notified lists over REST, whose items carry no notifications, so Home falls back to the global notification source (features/soup/entity-notifications.ts:117-128). That source is an unfiltered GraphQL Soup read (lib/queries/notification/graphql/user-notifications.ts:38-48), and Soup leaves initiatives out unless a filter asks for them (crates/item_filters/src/ast/initiative.rs:85-94), so Home finds no open notification and drops the row. The branch reads the list over GraphQL, whose items carry their own notification edges.`,
    outcome: 'Visible, intended: main with the flag off (GraphQL, what users without the flag get) shows the same initiative row; the branch now matches it (out/smoke/initiative-callers.json: Signal old 33, old flag off 36, new 34; the only row new adds over old is the initiative).',
  },
  {
    id: 'T1',
    match: field('[a-z_]+\\.notifications'),
    title: 'Items carry their own notifications on GraphQL',
    cause: `${MAPPER}:2102-2105 maps each item's notification edges (e.g. :2192, :2217); REST Soup items have none.`,
    outcome: `Callers read an item's own notifications first and fall back to the global source (features/soup/entity-notifications.ts:117-128), so the open/done state they decide on is the same. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T2',
    match: field('[a-z_]+\\.(deletedAt|editedAt|viewedAt|interactedAt|senderPhotoUrl|thread\\.editedAt|thread\\.deletedAt)'),
    title: 'Missing optional timestamps: null on REST, undefined on GraphQL',
    cause: `${MAPPER} maps absent values with \`?? undefined\` (:2212-2213 documents, :2250-2251 chats, :2271-2272 projects, :2302 and :2311 email, :2371-2372 channels); REST sends null.`,
    outcome: `Callers test these with \`!= null\` or truthiness, so both read as "not set". ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T3',
    match: field('(document|initiative)\\.appearance'),
    title: 'appearance absent on REST, null on GraphQL',
    cause: `${MAPPER}:2185 and :2205 set appearance from readEntityAppearance, which returns null when the entity has none; REST omits the key.`,
    outcome: `Both mean "default appearance" (the icon falls back on a missing value). ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T4',
    match: field('document\\.(documentVersionId|sha)'),
    title: 'Document version id and sha are not on the GraphQL list item',
    cause: `${MAPPER}:2214 sets documentVersionId to 0 and the GraphQL document fragment has no sha; REST sends both.`,
    outcome: `List rows do not use either; opening a document loads its version from the document service. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T5',
    match: field('document\\.properties\\[\\]\\.(definition\\.(created_at|updated_at|owner\\.scope|owner\\.user_id)|value|value\\.value\\[\\]\\.specific_message_id)'),
    title: 'Property definitions and empty values are shaped differently',
    cause: `${MAPPER}:1218-1220 fills a GraphQL property definition with owner {scope: 'system'} and empty created_at/updated_at; :1222 and :1201 give an empty value as null (REST omits it); :1193 maps a missing specificMessageId to undefined.`,
    outcome: `Rows show a property's display name and value, not its definition's owner or dates. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T6',
    match: field('email\\.(hasReceivedMail|labels\\[\\]\\.labelListVisibility)'),
    title: 'Email thread fields: hasReceivedMail, label visibility spelling',
    cause: `${MAPPER}:2297 adds hasReceivedMail (REST omits it), :2337 passes the GraphQL label visibility enum ('label_show') where REST sends Gmail's 'labelShow'.`,
    outcome: `Rows do not show label visibility, and hasReceivedMail only gates mail actions on the thread view. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T7',
    match: field('channel_thread\\.(latestReplyAt|thread\\.latestReplyAt)'),
    title: 'Thread latestReplyAt: null on REST, the thread time on GraphQL',
    cause: `${MAPPER}:2416 fills latest_reply_at from effectiveUpdatedAt; REST leaves it null for a thread whose replies it does not count.`,
    outcome: `Home orders and buckets threads by sortTs and notifiedAt, which match. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T8',
    match: field('email\\.updatedAt'),
    title: "Email updatedAt is whichever read last wrote the thread into GraphQL's cache",
    cause: "Soup gives an email thread's updatedAt per read: the row's updated_at on notified reads, the latest eligible message time on All Mail-style reads (crates/email/src/outbound/email_pg_repo/dynamic/query.rs:488-495). GraphQL's normalized cache keeps one updatedAt per GraphqlSoupEmailThread id, so a GraphQL list shows the value of whichever query (Home's update-time witness, a mail list) wrote the thread last. REST lists keep their own copy. Repro: dbg-email.ts and dbg-case.ts (seed 1310 case 7): the same thread reads 2026-11-20 on REST and 2026-11-19 on GraphQL in one page, and main's GraphQL reader shows the same mix.",
    outcome: 'Home sorts and buckets email by sortTs and notifiedAt (features/home/queries/home-results.ts:19-36), and the inbox row shows notifiedAt or sortTs (features/next-soup/soup-view/soup-view.tsx:1283-1296), all of which match. ' + DOM_EVIDENCE,
  },
  {
    id: 'D2',
    match: field('calendar_event\\.notifiedAt'),
    title: 'Calendar events in grouped notified lists carry their reminder time on GraphQL',
    cause: "Grouped Soup pages carry no notified_at on either transport. For calendar events the client falls back to the attached reminder's delivery time (lib/queries/soup/transform-utils.ts:1042-1051), which needs the item's own notifications: GraphQL items have them, REST items do not, so main's REST grouped list leaves notifiedAt unset. Repro: dbg-case.ts seed 1300 case 21 (grouped by date) and seed 1310 case 35 (grouped by type).",
    outcome: "Visible, intended: in a grouped notified view the inbox shows and buckets these rows by their reminder time instead of their update time (features/next-soup/soup-view/soup-view.tsx:1286-1293, soup-view-context.tsx:1354-1361), which is what the fallback's comment asks for and what main with the flag off (GraphQL) already does (the reference read agrees on every one). Flat notified lists are unchanged: the server stamps them on both sides.",
    needsRefAgreement: true,
  },
  {
    id: 'P1',
    match: /(^|\s)paging:retained-pages$/,
    title: "A second read of the same list starts with the pages main's REST reader kept",
    cause:
      "Main's REST reader is a TanStack infinite query with no page limit (lib/queries/soup/items.ts:242-336, mounted at :344) and the client keeps inactive queries for ten minutes (lib/queries/client.ts:27). A reader that mounts a key another reader already paged gets every cached page back, refetched, and its first fetchNextPage asks for the page after them. The GraphQL reader owns its pages per mount (lib/queries/soup/graphql/create-soup-live-query.ts:122, :215) and starts at the first page. Repro: dbg-retained.ts on seed 2601's world (DBG_SIZE=101 DBG_LIMIT=1 DBG_MAX_PAGES=60: the 101-entity viewer's Signal preset, one row a page, sixty pages) reads the same list twice in one tab: main's REST reader returns 60 rows in 60 pages, then 102 rows in 44 pages, to the end of the list (hasNextPage false); the branch and main's GraphQL reader (update-time sort) return 60 rows in 60 pages both times, with a next page. Every second read starts with the first read's rows. The run's case is a read of a list an earlier case read in the same tab; when main's kept pages reach the end of the list, the comparison checks the branch's rows as main's prefix (compare.ts, harness test 'compares only the shared prefix').",
    outcome:
      "Every row the branch reads is the row main shows at that position (the comparison checks the prefix row by row, and every field of it); main only shows rows further down sooner on a revisit, which the branch loads as the list scrolls. That is how every GraphQL Soup list main serves already behaves, and what users without the flag get.",
  },
  {
    id: 'T9',
    match: /(^|\s)error:old:deadline$/,
    title: "Main's REST reader gives up after 12 s where the branch's GraphQL reader waits for the answer",
    cause:
      "Main's REST Soup page fetch runs under createSoupRequestSignal (lib/queries/soup/request-timeout.ts:5 SOUP_REQUEST_TIMEOUT_MS = 12_000, :17-26 AbortSignal.timeout; applied at lib/queries/soup/items.ts:182), which exists so native HTTP requests cannot hang when connectivity drops. The GraphQL Soup transport has no request deadline (nothing in lib/queries/soup/graphql, lib/urql-solid or lib/graphql-cache sets one), on main as on the branch, so the branch's notified lists now wait like every GraphQL Soup list main already serves. The deadline fires before the headers as 'TimeoutError: signal timed out', or while the body streams as 'AbortError: The user aborted a request.' (Chromium's message for an abort during the body; dbg-body-timeout.ts shows both against a local server). TanStack's own cancellations never surface as a query error (they reject with CancelledError), and the native network signal is never set on web (core/mobile/native-network-status.ts:70-71), so on web only the deadline yields these errors. Repro: dbg-timeout.ts on seed 2691's world holds every Soup list request on both sides: at 5 s both read 27 rows; at 13 s and 20 s main errors with TimeoutError after its deadline (two requests, 24 s) and the branch reads the 27 rows (26.6 s, 40.5 s). The run's instances are steps where the stack took longer than 12 s to answer main's read under machine load; the error text of each is in the class detail.",
    outcome:
      "Visible: when the server takes over 12 s, main's Home shows its error state with Retry and the branch keeps the list loading until the answer comes. No row differs: the comparison stops at the error, and every such read is also retried (run.ts readUntilAnswered) so the rows are compared on the answer. The difference is the GraphQL transport's existing policy, not the PR's logic; whether GraphQL Soup reads should get the same deadline is a separate question for every GraphQL list.",
  },
  {
    id: 'T10',
    match: /(^|\s)error:(old|new):auth-refresh-timeout$/,
    title: 'A session refresh that gave up after 12 s under load, on one side',
    cause:
      "Every 401 waits on one shared session refresh per tab, whose request to the auth service is aborted after REFRESH_TIMEOUT_MS = 12_000 and settles as 'Authentication refresh timed out' (apps/web/src/lib/core/auth/session-refresh.ts:36, :148-199 requestRefresh, message at :104-106), so a request cannot hang after a native app resumes. Main's REST Soup read gets it through fetchWithToken (lib/core/util/fetchWithToken.ts:123) and does not retry (lib/queries/soup/request-timeout.ts SOUP_NETWORK_QUERY_OPTIONS retry: false); the branch's GraphQL Soup fetch gets the same result from the same fetchToken and throws it as a retryable NETWORK_ERROR (lib/service-clients/service-storage/graphql-soup.ts:182-192, unit test 'surfaces a refresh timeout as a retryable transport failure'). None of these files differs between main and the branch (git diff 6449317189c 485bb0f7c72 on them is empty): the error comes from the auth layer both readers share, before any Soup reader runs. The quiet run had two instances, both main's reload read of spec0 (lane v5 sequence 4 step 4 at 00:01:31 UTC, lane v12 sequence 2 step 1 at 01:32:17 UTC), while the stack took over 12 s to answer that tab's refresh; the branch's tab refreshed in time. Why both fell on main's tab is not shown; with two instances it may be chance. The steps' other reads differ only in closed classes. run.ts now counts this error as no answer and reads again (readUntilAnswered), as it does for network errors, so later runs compare the rows on the answer.",
    outcome:
      "Not a difference in the PR's readers: a refresh that stalls past 12 s fails a Soup read on either side, through code the PR does not change. A user on main sees Home's error state with Retry; on the branch the same stall fails the GraphQL request with a network error. No row is compared on an errored read.",
  },
  {
    id: 'N1',
    match: /(^|\s)dom:channel-name-snapshot(:rest-unrecorded)?$/,
    title: "A thread row names its channel by the notification's snapshot until the channel directory answers, on both sides",
    cause:
      "Home names a channel thread's channel with loadedChannel(directory.lookup(entity.channelId)) (features/home/components/HomeList.tsx:121-128); lookupChannel stays pending until the directory is complete or a by-id read answers (lib/queries/channel/directory.ts:261-292), and while it is pending getChannelThreadName falls back to the channelName the notification carried (features/entity/utils/channel-thread-name.ts:10-11 and the loop after it). None of the three files differs between main and the branch (git diff 6449317189c 485bb0f7c72 on them is empty). The harness writes the world's channel key ('v2-priv', 'tch') as that snapshot (lib/notify.ts:72, :82) and gives the channel another name ('priv 996'), so a read taken before the directory answered shows the key and one after shows the name. Which side a read catches first is timing: in the quiet run main's DOM-phase read showed 'v2-priv' where the branch's showed 'priv 996' (lane v2, signal), and at lane v4 sequence 4 step 9 both reloads showed 'v4-priv' while both mounted Homes showed 'priv 472'. lib/dom.ts now sets the name aside on a row where it is the only difference and goes on comparing the rows after it; dbg-channel-name.ts reopens a lane's Home on both sides and logs, every 2 s, each thread row whose name differs and when the two agree.",
    outcome:
      "Invisible as a difference between main and the branch: both run the same lookup and fallback, and both settle on the channel's current name once the directory answers. A user sees the snapshot only for a channel renamed since the notification, briefly, on either side.",
  },
  {
    id: 'B1',
    match: /^live:[a-z]+:old-behind:[a-z-]+\/[a-z_-]+$|(^|\s)dom:old-behind-reload$/,
    title: "Main's mounted list stays behind its own reload where the branch's has caught up",
    cause:
      "The class holds only when the branch's mounted list shows, row for row, the fresh read of both sides (run.ts live check; for Home on screen, the branch's mounted rows equal its reload and the two reloads agree), so only main is behind. When the day rolled over between the mounted read and the reload, Home's date buckets are set aside (lib/dom-held.ts withoutDayRollover): neither side re-buckets a mounted list at midnight, both mounted Homes keep 'Today', and order and row text still count. Main's REST notified lists change on a notification only through updateSoupForNotification (main's lib/queries/notification/notification-soup.ts:52-94: stamp notifiedAt, prepend to lists missing the row) and the per-tag invalidations of features/notifications/use-notification-updates.ts:74-246; they never re-read the server. The class is named for the write that first put the list behind (kind/entity kind), and each is traced:\n" +
      "notify/calendar: calendar_event_reminder has no case in use-notification-updates.ts, so it falls to .otherwise (main's :244) and nothing invalidates the list; notifiedAt is stamped (operations.ts:217-249) but a REST page keeps its server order (lib/queries/soup/items.ts:286-293, no client sort), so the event stays under rows notified before it. Repro: dbg-dom-step.ts, seed 2690, lane v3, DBG_KIND=notify DBG_ENTITY=v3-cal1: main's mounted Home keeps the event at row 2 under an event notified 2 min earlier, while both reloads and the branch's mounted Home put it at row 1; dbg-live.ts shows main's live row carrying the new stamp at index 1.\n" +
      "rename/*: another user's rename reaches the GraphQL cache through the SoupUpdates subscription (lib/service-clients/service-storage/graphql-soup-websocket.ts:280-283) and no REST list. Repro: dbg-dom-step.ts, seed 2690, lane v2, DBG_ENTITY=v2-task1: main's mounted Home keeps the old name for 15 s and shows the new one after a reload; the branch's mounted Home shows it within the step.\n" +
      "notify/* with rows main's read lacks: restoreSoupEntityToDoneFilteredQueries prepends the entity to every cached REST list that excludes done items, checked only against the caller's itemFilter and insertFilter (operations.ts:489-564), never the server; the probe's generated-filter reads pass neither, so an email lands in a list confined to another thread. Seen in seed 2100 lane v0 step 1 and seed 2690 lane v0 step 1.\n" +
      "done, seen, delete-notification and other writes that remove a row: on main a GraphqlUpdatedNotification only refetches the notification feed (main's features/notifications/notification-source.ts:441-446), so main's REST list keeps the row until a reload; the branch's GraphQL list re-evaluates on writes to the shared GraphQL cache (lib/queries/soup/graphql/create-soup-live-query.ts:356-371) and, since 215ea768c45, re-reads on the patch itself (notification-source.ts:448-455, revalidateNotifiedGraphqlSoupLists at :454 revalidateNotifiedGraphqlSoupLists).",
    outcome:
      "Visible on main only, and in the branch's favour: on the branch, the list on screen is the list a reload shows, which is the contract's read-after-write and live checks. Main shows it after a reload. Every such step's tokens and their first step are in steps.jsonl (checks.liveMisses) and the class detail.",
  },
  {
    id: 'S1',
    match: /^live:[a-z]+:both-stale-alike:[a-z-]+\/[a-z_-]+$/,
    title: 'Both mounted lists are behind their reads in the same way',
    cause:
      "Not a difference between main and the branch: the class requires that every row where either mounted list parts from its fresh read is the same row on both sides, and that the two fresh reads agree (run.ts live check). It is named for the write that first put both behind. For done, seen and delete-notification from another client, before 215ea768c45 the cause was shared code: a GraphqlUpdatedNotification only scheduled a notification-feed refetch and returned before updateSoupForNotification (main's features/notifications/notification-source.ts:441-449). Repro on 2c41d82: dbg-live.ts, seed 2601, lane v0, DBG_KIND=done DBG_RNG=2601000: both live lists keep the done task at row 13 for 16 s, both fresh reads drop it. Since 215ea768c45 the branch re-reads its notified lists on that patch, so it leaves this class for B1 unless its re-read lands inside the replica lag. A bulk delete of notifications publishes no patch at all (crates/notification/src/domain/service/ingress.rs:1035), so neither side hears it. Writes with no notification (move, team-unshare, revoke, participant changes, mute) reach neither app's notified lists either way.",
    outcome:
      'Both sides show the same rows; a reload shows the new state on both. Pre-existing, unchanged by the PR.',
  },
  {
    id: 'H1',
    match: /^live:grouped:new-held-notified-stamp$/,
    title: "A grouped list on the branch keeps a row's notification time after the websocket floor expires",
    cause:
      "Rows take notified_at through the websocket floor when they are mapped (transform-utils.ts:1046 resolveNotifiedAt; the floor is kept 5 min, normalized-cache/notified-floor.ts:15), and grouped pages carry no notification times, so a fresh read shows none. The branch's GraphQL list reuses a mapped row while its record, baseline and page stamp are unchanged (graphql/items.ts:112-123); a re-read after a notification (notification-soup.ts isNotifiedList, grouped lists included since 9d846c3c812) brings the same record back, so a row mapped inside the window keeps the stamp. Main serves the same grouped list by REST (graphql/ast.ts mapSortMethod rejects notified_at), and a notification refetches the REST lists holding its entity (normalized-cache/operations.ts:256 invalidateSoupEntity), which maps every row again. The harness closes only a stamp equal to one of the viewer's user_notification.created_at times for that entity, where the fresh read has none (run.ts heldNotifiedStamps). Repro: dbg-seq seed 2691, lane v3, spec2 (a filter list grouped by entity type): the project notified at step 0 (06:24:23.330671) shows that stamp in both mounted lists from step 8; main drops it at step 11, when a notification for an email in the list refetches it; the branch keeps it to step 19.",
    outcome:
      "Visible, not fixed: in a grouped view sorted by notification, that row shows its real notification time and sorts first in its group (soup-view.tsx:1289-1294, sort-options.tsx:38, soup-view-context.tsx:1141-1149) until the row changes or the page reloads. Main shows the same stamp and order from the same floor until a refetch of the list happens to run. The value is the entity's real latest notification time.",
  },
  {
    id: 'L1',
    match: /(^|\s)dom:stale-time-label$/,
    title: "Home's relative time labels show a row's age when it last rendered, and the branch re-renders unchanged rows less often",
    cause:
      "The Home card's time label is formatCompactRelativeTimestamp(props.timestamp) (features/next-soup/soup-view/views/inbox/inbox-card-layouts.tsx:415-419), which reads new Date() (features/entity/utils/timestamp.ts:88) outside any signal, so the label is computed when the row renders and never ticks, on main and on the branch alike. Main's REST notified lists refetch when a notification touches an entity in them (lib/queries/soup/normalized-cache/operations.ts:256 invalidateSoupEntity) and map every row again, so every label is recomputed at once. The branch's GraphQL list keeps a row object while its record, baseline and page stamp are unchanged (lib/queries/soup/graphql/items.ts:103-121), so an unchanged row keeps the label it was rendered with. The harness moves a Home check here only when the two mounted Homes show the same rows, order, unread state and text but for these labels, every mounted label is no older than the same row's label after that side's reload, and the two reloads agree (report.ts, lib/dom-held.ts onlyStaleTimeLabels). Instance: quiet seed 3401, lane v0, sequence 1 step 9: main's mounted labels 5m, 24m, 3h and the branch's now, 5m, 2h, for three mail rows whose reloads both read 11m, 30m, 3h; main's three labels lag the reload by the same 6 minutes (rendered together), the branch's by 11 and 25 (rendered apart).",
    outcome:
      "Visible, not a data difference: both sides show the same rows, order, buckets and unread state, and the same labels after a reload; only how stale a label can be differs. Main's labels are stale too (5m for an 11-minute-old notification) and refresh only when some notification makes its list refetch; the branch's refresh when that row changes. A ticking label is a fix for the card, not for this PR.",
  },
  {
    id: 'E1',
    fixedIn: '0a63dfa296a, 407d498ea34, 46c55570ce7, 54df1202765',
    match: /(^|\s)dom:stale-mail-label$/,
    title: "Fixed: a Home mail row with no open notification takes its time label from the thread's one cached updatedAt (T8, seen on screen)",
    cause:
      "The card labels a row by its first attached notification, else entity.updatedAt (features/next-soup/soup-view/views/inbox/inbox-card-layouts.tsx:141-155). GraphQL items attach only active notifications (crates/notification/src/domain/models/entity_query.rs:25-28, the edge's default states), so a thread whose notifications are all done is labelled by its updatedAt, and the GraphQL cache keeps one updatedAt per thread, written by whichever read or source wrote the record last (T8: Home's notified read gives email_threads.updated_at, an All-style read gives the latest eligible message time, crates/email/src/outbound/email_pg_repo/dynamic/query.rs:486-495). Main's REST Home list keeps its own copy of its read. The harness moves a Home check here only when the mounted Homes show the same rows, order and text but for labels, every label older than its reload's is on a mail row, and the reloads agree (report.ts, lib/dom-held.ts staleMailLabels). Instance: quiet seed 3401, lane v7, sequence 4 step 4: two mail threads whose notifications were all done read 3d and 1d on the branch's mounted Home and 5h on main and on both reloads; email_threads gives them updated_at 12:58 that day (5h) and latest_non_spam_message_ts 3 and 1 days before (3d, 1d).",
    outcome:
      "Fixed in 0a63dfa296a (fix(home): label notified mail rows from their own read), 407d498ea34 (fix(home): keep each notified page's mail times through a partial refresh), 46c55570ce7 (fix(home): keep notified mail times from a result replayed on subscribe) and 54df1202765 (fix(home): count an unmounted incoming page in the mail time bound): the Soup live query keeps the updatedAt each NOTIFIED_AT page's own latest network response gave its email threads, by input and page cursor (create-soup-live-query.ts recordNetworkEmailTimes, fetchedEmailUpdatedAt) and the item projection labels those rows with it (items.ts mapItem); a page's data cannot hold it, because its snapshot follows cache writes (graphql-cache/exchange/live-query.ts LiveQuery.replace). Tests (items.test.ts, \"email thread updatedAt on notified pages\"): \"labels a thread by its own page's updatedAt, not the shared record's\" fails on 215ea768c45 (expected 2026-11-21T09:00:00Z, received the cache write's 2026-11-17T08:00:00Z); \"keeps a later page's time while a refresh of the chain fails on it\" fails on 215ea768c45 and on 0a63dfa296a (expected 2026-11-20T09:00:00Z, received 2026-11-17T08:00:00Z: a page-1 response cleared page 2's capture); \"keeps the time of a result replayed while the list subscribes\" fails on 407d498ea34 (ReferenceError: Cannot access 'query' before initialization, caught by the observer, then the cache write's time); all three pass on 46c55570ce7 and later heads. Repro: dbg-email-label.ts on lane v7 with DBG_STEPS=move:v7-doc0,rename:v7-doc0,role:v7-doc11,move:v7-doc0 showed main 3025h, branch 3021d after the Mail backfill on 215ea768c45, and main and branch 3026h at every step and after reload with the fix. Runs on the fixed head must not reach this closure; one that does is a new difference.",
  },
  {
    id: 'P3',
    match: /^live:[a-z]+:new-past-loaded-pages(:[a-z-]+\/[a-z_-]+)?$/,
    title: 'A row pushed past the pages a mounted list loaded waits on its next page',
    cause:
      "The fresh read reads up to the spec's maxPages; the mounted list holds the pages it loaded when it opened (probe.ts openLive) and a re-read keeps that count: the branch's chain rebuild is query.refetch (lib/queries/soup/graphql/create-soup-live-query.ts:693), which reads Math.max(1, this.pages.length) pages (lib/urql-solid/infinite-query-observer.ts:684), as main's TanStack infinite query (lib/queries/soup/items.ts:344) refetches the pages it loaded. When a row joins above them, the last loaded page's last row moves to the next page. run.ts names this only when every new-side token is a missing row, the list is ungrouped, and its rows are its loaded pages in full, equal the fresh read's first rows, with a next page (lib/project.ts pastLoadedPages, harness test 'names rows pushed past the loaded pages'). Repro: quiet seed 3601, lane v5, sequence 2, step 7 (seen on a project; Home Signal with the read facet, limit 8): the branch's list holds 2 pages, 16 rows, hasNextPage true, the joined project among them; the fresh read has 17, the 17th the document the project pushed down.",
    outcome:
      "Invisible as a wrong row: the list shows the list's first rows, in order, and offers more. Scrolling loads the next page from the last row's cursor, which holds the pushed row; the same step reopened the list (checks.reopened, a fresh mount of the same query in the same tab), and it read 17 rows matching the fresh read (matchesFresh true).",
  },
  {
    id: 'P2',
    match: /(^|\s)field-order:channel\.participantIds$/,
    title: 'A channel lists the same participants in another order',
    cause:
      "Both transports read channels through ChannelListService::get_channels (crates/channels/src/domain/list_service.rs:78), whose CHANNEL_LIST_SELECT aggregates participants with ARRAY_AGG(json_build_object(...)) FROM comms_channel_participants and no ORDER BY (crates/channels/src/outbound/pg_channels_repo.rs:694-706), so the order is whatever the plan reads them in. The PR does not touch the channels crate. compare.ts unorderedParticipants compares the ids as a set: a different member still shows as a field difference and stays open.",
    outcome:
      'Invisible: every caller that reads a channel row\'s participantIds looks for the one id that is not the viewer, whatever the order: features/channel/channel-icon.tsx:28-29 (ids.find(id => id !== userId()) ?? ids[0], DMs only; other channels draw ChannelAvatar, which reads no participants), features/next-soup/soup-view/views/inbox/inbox-card-layouts.tsx:708, features/command/contact-items.ts:22 and features/agent-work/core/work-visibility.ts:15 (filters). Ordered avatar rows read call participants, not channel ones. ' +
      DOM_EVIDENCE,
  },
  {
    id: 'P4',
    match: /^live:[a-z]+:new-past-loaded-pages-behind-alike$/,
    title: 'A row both sides still show holds a slot in the loaded pages, so the next row waits on the next page',
    cause:
      "P3 with a stale row in the window. A write that no event announces leaves the row it removes on both mounted lists, alike: the harness's delete-notification deletes the notification rows in SQL, which publishes no patch (S1), and removing a participant from a public or team channel arrives as a channel update with isParticipant false, which neither main's Home nor the branch acts on (the PR body's leaving-a-channel bullet). The branch's list keeps the page count it loaded (lib/urql-solid/infinite-query-observer.ts:684 refetch reads Math.max(1, this.pages.length) pages), so with the stale row in it the fresh read's next row is one past its last page; main's REST list shows that row only because it holds more pages (P1). run.ts names this only when every new-side token is a missing row, the list is ungrouped and full pages with a next page, every row the fresh read lacks is on main's mounted list under the same notification time, and the list's other rows are the fresh read's first rows exactly (lib/project.ts staleSlotPastPages, harness test 'names a stale row both sides keep'). Instances, quiet seed 3701: lane v1 sequence 3 step 13 (delete-notification on a channel, limit 1, 3 pages: the branch shows [channel, document, chat], the fresh read [document, chat, document]; main shows the same channel at the same time), lane v11 sequence 0 step 12 and lane v8 sequence 1 step 18 (delete-notification on a document, limits 1 and 5), lane v13 sequence 3 step 15 (participant-remove on a public channel, limit 8, 3 pages, 24 rows: the stale thread on both, the 25th fresh row past the last page).",
    outcome:
      "Invisible as a wrong row, and not a branch-only staleness: the stale row is on main's list too, and every other row is the list's first rows, in order. Scrolling loads the next page from the last row's cursor, which returns the pushed row; the next read of the list (any notification, or a reload) drops the stale row on both sides.",
  },
  {
    id: 'T11',
    match: /^live:[a-z]+:new-rest-deadline$|(^|\s)error:new:rest-deadline$/,
    title: "A list the branch still reads with main's REST reader hit that reader's 12 s deadline under load",
    cause:
      "Home's Signal and Noise lists set emailView 'inbox' (features/home/queries/home-query.ts:175-177) and grouped GraphQL Soup refuses email views (lib/queries/soup/graphql/ast.ts:997-999), so the grouped input is undefined (graphql/grouped-items.ts:105-115) and the facade falls back to main's REST reader (lib/queries/soup/items.ts:434-443): every Home grouped read in the run is REST on both sides (reads.jsonl dims transport 'rest->rest', 443 of 443). Neither items.ts nor request-timeout.ts differs between main and the branch (git diff 6449317189c 328d999a060 on them is empty), and notification-soup.ts only adds the GraphQL re-read. So both sides ran the same REST code; on the branch's tab the refetch after the notification ran past the 12 s deadline (request-timeout.ts:5, T9) and failed with 'TimeoutError: signal timed out', which left in place the rows the notification had stamped and put at the top of the cached REST list (lib/queries/notification/notification-soup.ts:59 updateSoupForNotification, main's code, which the branch keeps; B1). Instance: quiet seed 3701, lane v11 sequence 1 step 0 (notify-burst on a thread; spec2 Home Signal grouped by project): the branch's list shows the three notified rows above the five the fresh read has, its state 'rest error ... TimeoutError: signal timed out'; main's tab answered in time and settled at 94 ms; the reopened list read the fresh five (checks.reopened matchesFresh true).",
    outcome:
      "Not the PR's code: main's REST reader on a slow stack, the same on either tab; on main it shows Home's error state with Retry exactly as here. The comparison stops at the error, and a fresh mount reads the right rows.",
  },
  {
    id: 'U1',
    match: /^live:[a-z]+:old-unsettled$/,
    title: "Main's mounted list showed its fresh read's rows but was still fetching at the bound",
    cause:
      "The probe counts a list as caught up only when it shows the fresh read's rows and is settled: not pending, loading or fetching (probe.ts:108-112). Main's REST notified lists are TanStack infinite queries (lib/queries/soup/items.ts:344) that refetch on every invalidation of an entity they hold (normalized-cache/operations.ts:256 invalidateSoupEntity) and after the probe reopens them on a storage reset. The class says nothing about the branch: its list at the same step is judged by its own classes, and a branch list that never settles is live:<tag>:new-unsettled, which stays open. Instance: quiet seed 3701, lane v22 sequence 0 step 0 (role on a document), the step after the run's only storage reset (resets.jsonl, both sides, 20:51:22): main's three lists showed the fresh rows (28, 4 and 0) and were still fetching (isFetching true, no error) when the 15 s bound ran out while each fresh read took 6.3 s; the branch's settled at 28, 52 and 61 ms. At the next step main's settled at 8, 28 and 32 ms.",
    outcome:
      "Main only, and invisible as rows: main's list already showed the right rows, with a refresh in flight. Nothing the branch shows differs.",
  },
  {
    id: 'W1',
    match: /^raced$/,
    title: 'Under load, rows notified while the two sides read: compared again without them',
    cause:
      "Not a reader: the load's notifiers write to the viewer a read compares, and main's read and the branch's are two requests, not one instant, so a row notified between them is newer, higher or new on one side only. Under load run.ts takes the database clock before each read and Home case and, after it, every entity the viewer was notified about since (user_notification.created_at, primary and secondary event item; lib/race.ts notifiedSince). The two snapshots are then compared again without those entities (lib/race.ts withoutRaced: a read stopped at its page limit is cut to the shorter side, and a grouped read's groups are not compared once a raced row was in it; Home rows likewise, dropping date headers left empty). Every other difference stays: harness tests 'still sees a fault on any entity no notification moved' plant drop-row, swap-order and alter-field beside a raced row. `raced` counts the reads where this set a class aside; reads.jsonl and dom.jsonl record each window (since, notifications, entities) and the classes it removed. Evidence that the earlier loaded run's differences were this race (chk-load-race.ts on seed 3702, which kept no windows): all 67 recorded notification-time differences are times of two real notifications for that viewer and entity, the newer one written by the load's queue ('notification' sender) during the read, with nothing between them in 57.",
    outcome:
      "Invisible: both readers show the newer notification on their next read; the quiet run, where nothing writes during a read, compares the same readers with no set-aside at all. Seen only under load, on the load's target viewers.",
  },
  {
    id: 'T12',
    match: /(^|\s)error:(old|new):network$/,
    title: 'A request the browser dropped in transport, on either side',
    cause:
      "fetch rejected with a TypeError, which main's REST client turns into 'Network error occurred' (lib/core/util/safeFetch.ts:383-390, not changed by the PR) and urql into '[Network] Failed to fetch' (@urql/core makeErrorMessage): Chromium answered net::ERR_EMPTY_RESPONSE (the local stack closed the connection under load) or net::ERR_INSUFFICIENT_RESOURCES (the tab had too many requests in flight). run.ts retries a read that fails this way twice (readUntilAnswered, NO_ANSWER) and names it only if every try failed. Instances, load seed 3702 sequences: lane v10 sequence 1 step 9, spec2 on the branch ('[Network] Failed to fetch', both sides 24 rows); lane v16 sequence 2 step 16, spec1 on main ('Network error occurred', both 5 rows): each a refetch that failed while the list already held the same rows on both sides.",
    outcome:
      "Invisible as rows: the list keeps the rows it holds, the same on both sides in every instance, and the next read answers. Seen once per side, only under load.",
  },
];

export function closureOf(cls: string): Closure | undefined {
  return CLOSURES.find((closure) => !closure.fixedIn && closure.match.test(cls));
}
