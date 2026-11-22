// Contract differences with a known cause, taken out of the strict contract
// comparison and counted per class, never dropped silently. A class names the
// reader, the cause at file:line, and why no caller behaves differently (or,
// for contact facts, why main is the wrong side, checked against the primary
// on every occurrence). Anything a rule does not match stays a difference.
//
// Each class keeps a strict check next to it: the parsed DM time
// (lists.dmActivitySort), the favorite icon (perId.<id>.favoriteIcon), and
// opening a DM (dmOpen) for the viewer's own id, are compared unclassified.

export const CAUSES = {
  'dm activity: same instant, other spelling':
    "useDmActivityByUserId (core/context/channels.ts) maps a DM peer to the record's updatedAt, which the GraphQL record spells +00:00 and REST spells Z. Every reader parses it to milliseconds: QuickAccessSource.tsx:279 (equalActivityMaps), person-items.ts contactUserItem, rank-command-search-items.ts:201, RecipientSelector.tsx:505 into freshSort.ts:103-130, dmActivity.ts, crm record-adapter.ts:88 and :187. lists.dmActivitySort, the parsed value, stays strict.",
  'favorite: unknown saved type, same icon':
    "FavoriteIcon.tsx:35 falls back to savedChannelType(saved), which maps a saved type it does not know to undefined (FavoriteIcon.tsx:19-25); main passed the raw string. ChannelIcon reads the type only as `=== 'direct_message'` (channel-icon.tsx:96), and both sides agree on that; favoriteIcon, which is that test, stays strict.",
  "dm lookup: the viewer's own id":
    "existingDirectMessage(viewer, viewer). Its one caller, openDirectMessage, returns before the lookup when the recipient is the viewer (open-direct-message.ts:43, the lookup at :51); dmOpen for the viewer stays strict and is 'skipped' on both.",
  'dm lookup: a bot principal':
    "existingDirectMessage / openDirectMessage with a `bot|` id. No production caller passes one: UserIcon.tsx's bot Match has no open handler (:193), userCardActions.tsx:82 canDirectMessage excludes bots, a channel's member rows do list bots (main's REST list keeps every active participant row, pg_channels_repo.rs:1368-1378 on main, and the branch lists them from botParticipants), but a bot row opens nothing, and call participants and contact rows are people. Agent DMs open through openTeamAgentDirectMessage (open-team-agent-direct-message.ts:22).",
  'contact facts: main targets a DM a bot or a third person is in':
    "Main reads the cached record's participantIds, which list people only, before the REST row (context-facts.ts:53 on main), so a bot in a DM is invisible there; given the REST row alone main refuses the same DM. The branch never targets a DM with a bot or with more than one other person (context-facts.ts:40-46). Every occurrence is checked against the primary's current participants (left_at is null). Red on main, green on the branch: red-green/facts-bot-main.log, red-green/facts-bot-branch.log.",
};

const isBot = (id) => typeof id === 'string' && id.startsWith('bot|');
const instant = (value) => (typeof value === 'string' ? Date.parse(value) : Number.NaN);
const isDm = (type) => type === 'direct_message';
const FACT_TARGET = /^facts\.facts\[(\d+)\]\[1\]\.directMessage$/;
const FAVORITE_TYPE = /^perId\.[^.]+\.favorite\[\d+\]\.channelType$/;
const DM_ACTIVITY_TIME = /^lists\.dmActivity\[\d+\]\[1\]$/;

/**
 * Splits one pair's contract diffs into the ones left (strict) and the ones a
 * class explains. `mainFacts` is main's facts entries ([peer, fact] pairs);
 * `members(channelId)` answers the channel's current participants on the
 * primary.
 */
export async function classifyContract(diffs, { viewer, mainFacts, members }) {
  const kept = {};
  const classified = [];
  for (const [section, list] of Object.entries(diffs)) {
    for (const d of list) {
      const found = await classOf(d, { viewer, mainFacts, members });
      if (found) classified.push({ class: found.class, path: d.path, a: d.a, b: d.b, ...(found.evidence ? { evidence: found.evidence } : {}) });
      else (kept[section] ??= []).push(d);
    }
  }
  return { kept, classified };
}

async function classOf(d, { viewer, mainFacts, members }) {
  if (DM_ACTIVITY_TIME.test(d.path)) {
    const a = instant(d.a);
    if (!Number.isNaN(a) && a === instant(d.b)) return { class: 'dm activity: same instant, other spelling' };
    return null;
  }
  if (FAVORITE_TYPE.test(d.path)) {
    if (isDm(d.a) === isDm(d.b)) return { class: 'favorite: unknown saved type, same icon' };
    return null;
  }
  if (d.path === `dm.${viewer}`) return { class: "dm lookup: the viewer's own id" };
  if (/^dm\.bot\|[0-9a-f-]{36}$/.test(d.path) || /^dmOpen\.bot\|[0-9a-f-]{36}\.(existing|id)$/.test(d.path)) {
    return { class: 'dm lookup: a bot principal' };
  }
  const target = FACT_TARGET.exec(d.path);
  if (target && d.a && typeof d.a === 'object' && typeof d.a.id === 'string' && d.b === null) {
    const peer = mainFacts?.[Number(target[1])]?.[0];
    const current = await members(d.a.id);
    if (!current || !peer) return null;
    const self = viewer.toLowerCase();
    const bots = current.filter(isBot);
    const others = current.filter((id) => !isBot(id) && id.toLowerCase() !== self);
    if (!others.some((id) => id.toLowerCase() === String(peer).toLowerCase())) return null;
    if (bots.length > 0 || others.length > 1) {
      return { class: 'contact facts: main targets a DM a bot or a third person is in', evidence: { channel: d.a.id, bots: bots.length, otherPeople: others.length } };
    }
  }
  return null;
}

/** Adds classified diffs to per-class counts with the first examples. */
export function summarizeClassified(classified, into = {}, context = {}) {
  for (const c of classified) {
    into[c.class] ??= { count: 0, examples: [] };
    into[c.class].count++;
    if (into[c.class].examples.length < 3) into[c.class].examples.push({ ...context, path: c.path, a: c.a, b: c.b, ...(c.evidence ? { evidence: c.evidence } : {}) });
  }
  return into;
}
