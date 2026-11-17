import type { MentionItem } from '../../../../utils/mentionsUtils';
import { rankMentions } from './mention-ranking';

/**
 * How many entries from {@link topUserCandidates} get pinned above the rest
 * of the mobile mention hits. Mirrors desktop's user bucket without a visual
 * separator — user mentions are the common case, so we keep the freshest
 * couple within easy reach even when docs/channels would otherwise out-rank
 * them in the blended sort.
 */
const TOP_USERS = 2;

/**
 * The blended sort decides where the other candidates sit among docs and
 * channels; they fill those slots in candidate order, so phones keep the order
 * of desktop's People bucket.
 */
export function sortMobileMentions(
  items: MentionItem[],
  query: string,
  topUserCandidates: MentionItem[] = [],
  preserveMatches = false
): MentionItem[] {
  const pinned = topUserCandidates.slice(0, TOP_USERS);
  const pinnedIds = new Set(pinned.map((item) => item.id));

  const rest = rankMentions(items, query, preserveMatches).filter(
    (item) => !pinnedIds.has(item.id)
  );

  const restIds = new Set(rest.map((item) => item.id));
  const candidateIds = new Set(topUserCandidates.map((item) => item.id));
  const listedCandidates = topUserCandidates.filter(
    (item) => !pinnedIds.has(item.id) && restIds.has(item.id)
  );
  let next = 0;
  return [
    ...pinned,
    ...rest.map((item) =>
      candidateIds.has(item.id) ? (listedCandidates[next++] ?? item) : item
    ),
  ];
}
