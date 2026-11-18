import { deepEqual } from '@core/util/compareUtils';
import {
  createFreshSearch,
  NAME_MATCH_RANKING,
  NAME_STARTS_WITH_QUERY_RANK,
} from '@core/util/freshSort';
import { normalizeNameText, startsWordsOf } from '@core/util/name-match-score';
import { preservePersonOrder } from '@core/util/ordered-window';
import uFuzzy from '@leeoniya/ufuzzy';
import { match } from 'ts-pattern';
import type { CommandMenuItem } from './useCommandItems';

// Command keyword eligibility is not a database-person lookup. Keep its existing
// matcher for commands and ordinary entities; personal windows retain core order.
const COMMAND_MATCHER = new uFuzzy({});

/** The label a row shows; its search text can add emails, aliases, or command keywords. */
function displayName(item: CommandMenuItem): string {
  return match(item)
    .with({ kind: 'entity' }, { kind: 'user' }, (row) => row.data.name)
    .with({ kind: 'command' }, ({ data }) =>
      typeof data.description === 'function'
        ? data.description()
        : data.description
    )
    .with(
      { kind: 'search' },
      { kind: 'ask-ai' },
      { kind: 'new-project' },
      (row) => row.searchText
    )
    .exhaustive();
}

/**
 * A command's label is a verb and what it acts on ("Go to Settings", "Change
 * theme"), and people type the latter. A label ending in the query from a
 * later word names the command after it: it ranks under exact names and above
 * names that only start with the query. A later word starting with the query
 * ranks with names starting with it.
 */
function commandNameRank(label: string, term: string): number {
  if (!term) return 0;
  const name = normalizeNameText(label);
  if (name.endsWith(` ${term}`)) return 2;
  return name.includes(` ${term}`) ? 1 : 0;
}

function compareRecency(left: CommandMenuItem, right: CommandMenuItem) {
  return (
    right.sortTimestamp - left.sortTimestamp || left.id.localeCompare(right.id)
  );
}

function isPeopleItem(item: CommandMenuItem) {
  return (
    item.bucket === 'dm' ||
    item.bucket === 'person' ||
    item.bucket === 'crm_contact'
  );
}

/** Within each run of adjacent people in one relationship group, Macro users
 * and DMs lead CRM contacts. Each keeps its order, and no person moves past
 * another result or into a better group. */
function prioritizeInternalPeople<T extends CommandMenuItem>(
  items: T[],
  groupOf: (item: T) => number | undefined
): T[] {
  const ordered: T[] = [];
  let run: T[] = [];
  let runGroup: number | undefined;
  const flushRun = () => {
    ordered.push(
      ...run.filter((item) => item.bucket !== 'crm_contact'),
      ...run.filter((item) => item.bucket === 'crm_contact')
    );
    run = [];
  };

  for (const item of items) {
    if (!isPeopleItem(item)) {
      flushRun();
      ordered.push(item);
      continue;
    }

    const group = groupOf(item);
    if (group !== runGroup) flushRun();
    runGroup = group;
    run.push(item);
  }
  flushRun();
  return ordered;
}

function isMacroPerson(item: CommandMenuItem) {
  return item.bucket === 'dm' || item.bucket === 'person';
}

/** Whether the viewer has a direct message with this person, as the people
 * window decides it: a DM row, or a person with an interaction time, which
 * comes only from DMs. CRM contacts are email correspondents and never count. */
function hasDirectMessage(item: CommandMenuItem) {
  if (item.bucket === 'dm') return true;
  if (item.kind !== 'user') return false;

  const interaction = item.timestamps.lastInteraction;
  return interaction != null && new Date(interaction).getTime() > 0;
}

/**
 * Sources republish their lists on cache refreshes and page reads, often with
 * new objects that hold the same data. Rows that are the same object or hold
 * equal data rank the same, so such a list needs no new ranking. Commands
 * carry handlers and are compared by identity only.
 */
export function sameRankInput(
  previous: readonly CommandMenuItem[],
  next: readonly CommandMenuItem[]
): boolean {
  if (previous.length !== next.length) return false;

  return previous.every((item, index) => {
    const other = next[index];
    if (item === other) return true;
    if (item.kind === 'command' || other.kind === 'command') return false;
    return deepEqual(item, other);
  });
}

/** Rank cached and local candidates together using the command menu's rules. */
export function rankCommandSearchItems<T extends CommandMenuItem>(
  items: T[],
  query: string,
  options: {
    preserveAdditionalEntityMatches: boolean;
    /** Rows a server search already matched, kept even when the menu's
     * fuzzy matcher would not match them. */
    preservedIds?: ReadonlySet<string>;
    /** Members of the viewer's team. Their people rows and one-to-one
     * conversations lead other rows that match equally well. */
    teammateIds?: ReadonlySet<string>;
    viewerId?: string;
  }
): T[] {
  const term = normalizeNameText(query);
  const search = createFreshSearch<T>({
    config: {
      ...NAME_MATCH_RANKING,
      useViewedAt: true,
      channelBoost: 3,
      dmBoost: 1.8,
      fuzzyWeight: 0.7,
      timeWeight: 0.7,
      minFuzzyThreshold: 0.1,
      commaSeparatedChannelMatch: true,
    },
    getName: (item) => item.searchText,
    getDisplayName: displayName,
    isChannelItem: (item) => item.bucket === 'channel' || item.bucket === 'dm',
    isDmItem: (item) => item.bucket === 'dm',
    isPersonItem: (item) => item.bucket === 'dm' || item.bucket === 'person',
    getTimestamp: (item) => item.timestamps,
  });

  const commands = items.filter((item) => item.kind === 'command');
  const commandMatches = new Set(
    (
      COMMAND_MATCHER.filter(
        commands.map((item) => item.searchText),
        query
      ) ?? []
    ).map((index) => commands[index].id)
  );
  const eligible = items.filter(
    (item) => item.kind !== 'command' || commandMatches.has(item.id)
  );
  const withTeammate = (item: CommandMenuItem) => {
    const team = options.teammateIds;
    if (!team?.size) return false;
    if (item.kind === 'user') return team.has(item.id);
    if (item.kind !== 'entity' || item.data.type !== 'channel') return false;
    if (item.data.channelType !== 'direct_message') return false;
    const others = (item.data.participantIds ?? []).filter(
      (id) => id !== options.viewerId
    );
    return others.length === 1 && team.has(others[0]);
  };
  // People the viewer never talked to: no teammate and no direct message.
  const isStranger = (item: CommandMenuItem) =>
    isPeopleItem(item) && !withTeammate(item) && !hasDirectMessage(item);
  // Among names with a word starting with each typed term, the viewer's own
  // results and people they know come first, then strangers, however exactly
  // a stranger's name matches. Names that only contain the query follow,
  // strangers last in each tier.
  const relationshipGroup = (
    item: CommandMenuItem,
    nameMatchRank: number,
    stranger: boolean
  ) => {
    const startsWords =
      nameMatchRank >= NAME_STARTS_WITH_QUERY_RANK ||
      startsWordsOf(displayName(item), term);
    if (!startsWords) return 0;
    return stranger ? 1 : 2;
  };
  // Match quality decides next. Among equally good matches, teammates and
  // conversations with them lead, then other Macro users and DMs, then
  // documents and channels.
  const scored = search(eligible, query)
    .map((result) => {
      const nameMatchRank =
        result.item.kind === 'command'
          ? Math.max(
              result.nameMatchRank,
              commandNameRank(displayName(result.item), term)
            )
          : result.nameMatchRank;
      const stranger = isStranger(result.item);
      return {
        ...result,
        nameMatchRank,
        stranger,
        group: relationshipGroup(result.item, nameMatchRank, stranger),
      };
    })
    .sort(
      (left, right) =>
        right.group - left.group ||
        right.nameMatchRank - left.nameMatchRank ||
        Number(left.stranger) - Number(right.stranger) ||
        Number(withTeammate(right.item)) - Number(withTeammate(left.item)) ||
        Number(isMacroPerson(right.item)) - Number(isMacroPerson(left.item)) ||
        right.combinedScore - left.combinedScore ||
        compareRecency(left.item, right.item)
    );
  const ranked = scored.map(({ item }) => item);
  // People keep their window order only among equally good name matches, so
  // a recent weak match cannot take the slot an exact name earned.
  const nameRanks = new Map(
    scored.map(({ item, nameMatchRank }) => [item.id, nameMatchRank])
  );
  const groups = new Map(scored.map(({ item, group }) => [item.id, group]));
  const groupOf = (item: T) => groups.get(item.id);
  // Window order holds among people in the same group who match equally well
  // and are equally close to the viewer, so a teammate or someone the viewer
  // messages keeps the lead the sort gave them.
  const closeness = (item: T) => {
    if (withTeammate(item)) return 'teammate';
    return isStranger(item) ? 'stranger' : 'known';
  };
  const tiers = new Map<string, number>();
  const nameRank = (item: T) => {
    const rank = nameRanks.get(item.id);
    if (rank === undefined) return -Infinity;

    const key = `${groupOf(item)}:${rank}:${closeness(item)}`;
    const tier = tiers.get(key) ?? tiers.size;
    tiers.set(key, tier);
    return tier;
  };
  const preserved = (item: CommandMenuItem) =>
    options.preservedIds?.has(item.id) ||
    (options.preserveAdditionalEntityMatches && item.kind === 'entity');
  if (!options.preserveAdditionalEntityMatches && !options.preservedIds?.size)
    return preservePersonOrder(
      prioritizeInternalPeople(ranked, groupOf),
      items,
      nameRank
    );

  // Cache search accepts broader subsequences than the menu's fuzzy matcher.
  // Keep these additional matches reachable after the regular ranked results.
  const matchedIds = new Set(ranked.map((item) => item.id));
  const additional = items
    .filter((item) => preserved(item) && !matchedIds.has(item.id))
    .sort(compareRecency);
  return preservePersonOrder(
    prioritizeInternalPeople([...ranked, ...additional], groupOf),
    items,
    nameRank
  );
}
