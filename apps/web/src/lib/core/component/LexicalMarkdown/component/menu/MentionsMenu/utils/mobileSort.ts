import type { EntityItem } from '@core/context/quickAccess';
import { searchLikeQuickAccess } from '@core/context/quickAccess/entity-search';
import { createFreshSearch, type FreshSortConfig } from '@core/util/freshSort';
import type {
  MentionItem,
  ProjectMentionItem,
} from '../../../../utils/mentionsUtils';

function getMentionName(item: MentionItem): string {
  if (item.kind === 'date') return item.data.displayText;
  if (item.kind === 'group') return item.data.groupAlias;
  return item.searchText;
}

function getMentionTimestamps(item: MentionItem) {
  if (item.kind === 'date' || item.kind === 'group') return {};
  return item.timestamps;
}

function isDmItem(item: MentionItem): boolean {
  return item.kind === 'entity' && item.bucket === 'dm';
}

/**
 * Per-kind boost. With a query, the user is usually targeting a specific
 * person, so users beat group DMs/channels that merely contain that name —
 * the command menu sidesteps this by excluding persons from its "all" view,
 * but the mention menu must include them. Without a query we keep the boost
 * small so freshness dominates.
 */
function mentionBoost(hasQuery: boolean) {
  return (item: MentionItem): number => {
    if (item.kind === 'user') return hasQuery ? 0.4 : 0.2;
    if (item.kind === 'group') return hasQuery ? 0.2 : 0.1;
    return 0;
  };
}

function createMobileSearchConfig(
  hasQuery: boolean
): FreshSortConfig<MentionItem> {
  return {
    useViewedAt: true,
    fuzzyWeight: hasQuery ? 0.5 : 0,
    timeWeight: hasQuery ? 0.4 : 0.9,
    brevityWeight: hasQuery ? 0.1 : 0,
    minFuzzyThreshold: hasQuery ? 0.1 : 0,
    dmBoost: hasQuery ? 1.4 : 1.2,
    commaSeparatedChannelMatch: true,
    gapPenaltyWeight: hasQuery ? 0.4 : 0,
    startBonusDecay: hasQuery ? 0.4 : 0,
    boostFn: mentionBoost(hasQuery),
  };
}

/**
 * How many entries from {@link topUserCandidates} get pinned above the rest
 * of the mobile mention hits. Mirrors desktop's user bucket without a visual
 * separator — user mentions are the common case, so we keep the freshest
 * couple within easy reach even when docs/channels would otherwise out-rank
 * them in the blended sort.
 */
const TOP_USERS = 2;

export function sortMobileMentions(
  items: MentionItem[],
  query: string,
  topUserCandidates: MentionItem[] = []
): MentionItem[] {
  const pinned = topUserCandidates.slice(0, TOP_USERS);
  const pinnedIds = new Set(pinned.map((item) => item.id));

  const hasQuery = query.trim().length > 0;
  const search = createFreshSearch<MentionItem>({
    config: createMobileSearchConfig(hasQuery),
    getName: getMentionName,
    isDmItem,
    getTimestamp: getMentionTimestamps,
  });
  const rest = search(items, query)
    .map(({ item }) => item)
    .filter((item) => !pinnedIds.has(item.id));

  return [...pinned, ...rest];
}

type RecencyRankable = Extract<
  MentionItem,
  { searchText: string; sortTimestamp: number }
>;

/**
 * Rank with the documents' own ordering: recency (viewed, else updated) with
 * no query, otherwise the quick access fuzzy ranking.
 */
function rankLikeDocuments(
  items: RecencyRankable[],
  query: string
): RecencyRankable[] {
  if (query.trim()) return searchLikeQuickAccess(items, query);
  return [...items].sort((a, b) => b.sortTimestamp - a.sortTimestamp);
}

/**
 * Slot projects into the ranked documents list without reordering it: each
 * project follows exactly as many documents as outrank it in the shared
 * ranking. When `docs` came from that same ranking this is their combined
 * order; server-ranked documents keep the server's order.
 */
export function mergeIntoDocuments(
  docs: EntityItem[],
  projects: ProjectMentionItem[],
  query: string
): MentionItem[] {
  if (projects.length === 0) return docs;
  const docIds = new Set(docs.map((doc) => doc.id));
  const slots = new Map<number, MentionItem[]>();
  const placed = new Set<string>();
  let docsAbove = 0;
  for (const item of rankLikeDocuments([...docs, ...projects], query)) {
    if (docIds.has(item.id)) {
      docsAbove++;
      continue;
    }
    slots.set(docsAbove, [...(slots.get(docsAbove) ?? []), item]);
    placed.add(item.id);
  }
  const out: MentionItem[] = [];
  docs.forEach((doc, index) => {
    out.push(...(slots.get(index) ?? []), doc);
  });
  out.push(...(slots.get(docs.length) ?? []));
  // The server matched these even if the fuzzy ranking dropped them.
  out.push(...projects.filter((project) => !placed.has(project.id)));
  return out;
}
