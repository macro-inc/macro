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
    cause: `${MAPPER}:2031-2034 maps each item's notification edges (e.g. :2116, :2141); REST Soup items have none.`,
    outcome: `Callers read an item's own notifications first and fall back to the global source (features/soup/entity-notifications.ts:117-128), so the open/done state they decide on is the same. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T2',
    match: field('[a-z_]+\\.(deletedAt|editedAt|viewedAt|interactedAt|senderPhotoUrl|thread\\.editedAt|thread\\.deletedAt)'),
    title: 'Missing optional timestamps: null on REST, undefined on GraphQL',
    cause: `${MAPPER} maps absent values with \`?? undefined\` (:2136-2137 documents, :2174-2175 chats, :2195-2196 projects, :2219 and :2228 email, :2288-2289 channels); REST sends null.`,
    outcome: `Callers test these with \`!= null\` or truthiness, so both read as "not set". ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T3',
    match: field('(document|initiative)\\.appearance'),
    title: 'appearance absent on REST, null on GraphQL',
    cause: `${MAPPER}:2109 and :2129 set appearance from readEntityAppearance, which returns null when the entity has none; REST omits the key.`,
    outcome: `Both mean "default appearance" (the icon falls back on a missing value). ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T4',
    match: field('document\\.(documentVersionId|sha)'),
    title: 'Document version id and sha are not on the GraphQL list item',
    cause: `${MAPPER}:2138 sets documentVersionId to 0 and the GraphQL document fragment has no sha; REST sends both.`,
    outcome: `List rows do not use either; opening a document loads its version from the document service. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T5',
    match: field('document\\.properties\\[\\]\\.(definition\\.(created_at|updated_at|owner\\.scope|owner\\.user_id)|value|value\\.value\\[\\]\\.specific_message_id)'),
    title: 'Property definitions and empty values are shaped differently',
    cause: `${MAPPER}:1171-1173 fills a GraphQL property definition with owner {scope: 'system'} and empty created_at/updated_at; :1175 and :1154 give an empty value as null (REST omits it); :1146 maps a missing specificMessageId to undefined.`,
    outcome: `Rows show a property's display name and value, not its definition's owner or dates. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T6',
    match: field('email\\.(hasReceivedMail|labels\\[\\]\\.labelListVisibility)'),
    title: 'Email thread fields: hasReceivedMail, label visibility spelling',
    cause: `${MAPPER}:2214 adds hasReceivedMail (REST omits it), :2254 passes the GraphQL label visibility enum ('label_show') where REST sends Gmail's 'labelShow'.`,
    outcome: `Rows do not show label visibility, and hasReceivedMail only gates mail actions on the thread view. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T7',
    match: field('channel_thread\\.(latestReplyAt|thread\\.latestReplyAt)'),
    title: 'Thread latestReplyAt: null on REST, the thread time on GraphQL',
    cause: `${MAPPER}:2333 fills latest_reply_at from effectiveUpdatedAt; REST leaves it null for a thread whose replies it does not count.`,
    outcome: `Home orders and buckets threads by sortTs and notifiedAt, which match. ${DOM_EVIDENCE}`,
    needsRefAgreement: true,
  },
  {
    id: 'T8',
    match: field('email\\.updatedAt'),
    title: "Email updatedAt is whichever read last wrote the thread into GraphQL's cache",
    cause: "Soup gives an email thread's updatedAt per read: the row's updated_at on notified reads, the latest eligible message time on All Mail-style reads (crates/email/src/outbound/email_pg_repo/dynamic/query.rs:487-494). GraphQL's normalized cache keeps one updatedAt per GraphqlSoupEmailThread id, so a GraphQL list shows the value of whichever query (Home's update-time witness, a mail list) wrote the thread last. REST lists keep their own copy. Repro: dbg-email.ts and dbg-case.ts (seed 1310 case 7): the same thread reads 2026-11-20 on REST and 2026-11-19 on GraphQL in one page, and main's GraphQL reader shows the same mix.",
    outcome: 'Home sorts and buckets email by sortTs and notifiedAt (features/home/queries/home-results.ts:19-36), and the inbox row shows notifiedAt or sortTs (features/next-soup/soup-view/soup-view.tsx:1283-1296), all of which match. ' + DOM_EVIDENCE,
  },
  {
    id: 'D2',
    match: field('calendar_event\\.notifiedAt'),
    title: 'Calendar events in grouped notified lists carry their reminder time on GraphQL',
    cause: "Grouped Soup pages carry no notified_at on either transport. For calendar events the client falls back to the attached reminder's delivery time (lib/queries/soup/transform-utils.ts:1080-1089), which needs the item's own notifications: GraphQL items have them, REST items do not, so main's REST grouped list leaves notifiedAt unset. Repro: dbg-case.ts seed 1300 case 21 (grouped by date) and seed 1310 case 35 (grouped by type).",
    outcome: "Visible, intended: in a grouped notified view the inbox shows and buckets these rows by their reminder time instead of their update time (features/next-soup/soup-view/soup-view.tsx:1286-1293, soup-view-context.tsx:1354-1361), which is what the fallback's comment asks for and what main with the flag off (GraphQL) already does (the reference read agrees on every one). Flat notified lists are unchanged: the server stamps them on both sides.",
    needsRefAgreement: true,
  },
];

export function closureOf(cls: string): Closure | undefined {
  return CLOSURES.find((closure) => closure.match.test(cls));
}
