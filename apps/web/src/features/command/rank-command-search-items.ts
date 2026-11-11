import { createFreshSearch, NAME_MATCH_RANKING } from '@core/util/freshSort';
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

/** Keep the existing order within each group and the positions of other results. */
function prioritizeInternalPeople<T extends CommandMenuItem>(items: T[]): T[] {
  const people = items
    .filter(isPeopleItem)
    .sort(
      (left, right) =>
        Number(left.bucket === 'crm_contact') -
        Number(right.bucket === 'crm_contact')
    );
  let nextPerson = 0;
  return items.map((item) =>
    isPeopleItem(item) ? people[nextPerson++] : item
  );
}

function isMacroPerson(item: CommandMenuItem) {
  return item.bucket === 'dm' || item.bucket === 'person';
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
  }
): T[] {
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
  // Match quality decides first. Among equally good matches Macro users and
  // DMs come before documents and channels.
  const scored = search(eligible, query).sort(
    (left, right) =>
      right.nameMatchRank - left.nameMatchRank ||
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
  const nameRank = (item: T) => nameRanks.get(item.id) ?? -Infinity;
  const preserved = (item: CommandMenuItem) =>
    options.preservedIds?.has(item.id) ||
    (options.preserveAdditionalEntityMatches && item.kind === 'entity');
  if (!options.preserveAdditionalEntityMatches && !options.preservedIds?.size)
    return preservePersonOrder(
      prioritizeInternalPeople(ranked),
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
    prioritizeInternalPeople([...ranked, ...additional]),
    items,
    nameRank
  );
}
