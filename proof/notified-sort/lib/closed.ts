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
    id: 'B1',
    match: /^live:[a-z]+:old-behind:[a-z-]+\/[a-z_-]+$|(^|\s)dom:old-behind-reload$/,
    title: "Main's mounted list stays behind its own reload where the branch's has caught up",
    cause:
      "The class holds only when the branch's mounted list shows, row for row, the fresh read of both sides (run.ts live check; for Home on screen, the branch's mounted rows equal its reload and the two reloads agree), so only main is behind. Main's REST notified lists change on a notification only through updateSoupForNotification (main's lib/queries/notification/notification-soup.ts:52-94: stamp notifiedAt, prepend to lists missing the row) and the per-tag invalidations of features/notifications/use-notification-updates.ts:74-246; they never re-read the server. The class is named for the write that first put the list behind (kind/entity kind), and each is traced:\n" +
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
];

export function closureOf(cls: string): Closure | undefined {
  return CLOSURES.find((closure) => closure.match.test(cls));
}
