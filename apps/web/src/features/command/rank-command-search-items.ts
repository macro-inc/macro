import { emailToMacroId } from '@core/user/macroId';
import { deepEqual } from '@core/util/compareUtils';
import {
  createFreshSearch,
  NAME_MATCH_RANKING,
  NAME_STARTS_WITH_QUERY_RANK,
} from '@core/util/freshSort';
import { ANY_SCRIPT_FUZZY_OPTIONS } from '@core/util/fuzzy';
import { normalizeNameText, startsWordsOf } from '@core/util/name-match-score';
import { preservePersonOrder } from '@core/util/ordered-window';
import { crmContactEmailKey } from '@entity/types/entity';
import uFuzzy from '@leeoniya/ufuzzy';
import { match } from 'ts-pattern';
import { directMessageRecipient } from './contact-items';
import type { CommandMenuItem } from './useCommandItems';

// Command keyword eligibility is not a database-person lookup. Keep its existing
// matcher for commands and ordinary entities; personal windows retain core order.
const COMMAND_MATCHER = new uFuzzy(ANY_SCRIPT_FUZZY_OPTIONS);

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

/** The viewer's team, which decides who is outside it. */
type TeamScope = {
  /** Members of the viewer's team. While the roster loads, or when the
   * viewer has no team, it is empty and nobody is outside the team. */
  teammateIds?: ReadonlySet<string>;
  viewerId?: string;
};

/** A row that stands for one person: a person, a CRM contact, or a
 * one-to-one DM. Group DMs are conversations, like channels. */
function isPersonRow(item: CommandMenuItem, viewerId: string | undefined) {
  return (
    item.kind === 'user' ||
    item.bucket === 'crm_contact' ||
    directMessageRecipient(item, viewerId) !== undefined
  );
}

/** The Macro user a person row stands for: the person, the user a CRM
 * contact's email names, or the other person in a one-to-one DM. */
function rowPersonId(item: CommandMenuItem, viewerId: string | undefined) {
  if (item.kind === 'user') return item.id;
  if (item.kind === 'entity' && item.data.type === 'crm_contact') {
    const email = item.data.email;
    return email ? emailToMacroId(crmContactEmailKey(email)) : undefined;
  }
  return directMessageRecipient(item, viewerId);
}

function isTeammateRow(item: CommandMenuItem, team: TeamScope) {
  if (!team.teammateIds?.size) return false;
  const person = rowPersonId(item, team.viewerId);
  return person !== undefined && team.teammateIds.has(person);
}

/** A person row for someone outside the viewer's team: an email contact, a
 * CRM contact, a Macro user from elsewhere, or a one-to-one DM with them. */
function isOutsidePerson(item: CommandMenuItem, team: TeamScope) {
  if (!team.teammateIds?.size) return false;
  return isPersonRow(item, team.viewerId) && !isTeammateRow(item, team);
}

/**
 * Whether the query is exactly one of the names or the email address a row
 * is known by. It counts only for an email address or a name of two or more
 * words: a single word is usually a first name, which many people share.
 */
function isNamedExactly(item: CommandMenuItem, term: string) {
  if (!term.includes('@') && !term.includes(' ')) return false;
  return item.searchText
    .split('|')
    .some((name) => normalizeNameText(name) === term);
}

/** With no query, rows keep their order, except that people outside the
 * viewer's team follow the team's rows and the commands the viewer used
 * among them. The command catalog that ends the list stays last, so these
 * people are not buried under it. */
export function listOutsidePeopleLast<T extends CommandMenuItem>(
  items: T[],
  team: TeamScope
): T[] {
  const outside = (item: T) => isOutsidePerson(item, team);
  const teamRows = items.filter((item) => !outside(item));
  // The catalog starts at the first never-used command after the team's last
  // other row. Go To commands are listed after the others, so the used ones
  // that follow it stay in it, below these people, as they sit below every
  // recent row without them.
  const lastOther = teamRows.findLastIndex((item) => item.kind !== 'command');
  const catalogStart = teamRows.findIndex(
    (item, index) => index > lastOther && !(item.sortTimestamp > 0)
  );
  const at = catalogStart === -1 ? teamRows.length : catalogStart;
  return [
    ...teamRows.slice(0, at),
    ...items.filter(outside),
    ...teamRows.slice(at),
  ];
}

/** Caches a per-row answer for one ranking pass; the sort asks each row
 * many times. */
function perRow<T extends object>(test: (item: T) => boolean) {
  const answers = new Map<T, boolean>();
  return (item: T) => {
    const known = answers.get(item);
    if (known !== undefined) return known;
    const answer = test(item);
    answers.set(item, answer);
    return answer;
  };
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
     * conversations lead other rows that match equally well, and people
     * outside the team follow every row from it. */
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
  const team: TeamScope = {
    teammateIds: options.teammateIds,
    viewerId: options.viewerId,
  };
  const withTeammate = perRow<CommandMenuItem>((item) =>
    isTeammateRow(item, team)
  );
  const outsidePerson = perRow<CommandMenuItem>((item) =>
    isOutsidePerson(item, team)
  );
  // Someone outside the team whose email address or full name the query
  // spells out is the person the viewer is looking for: they rank among the
  // team's results as a stranger, after every row a stranger follows there,
  // even when the viewer messages them.
  const namedOutsider = perRow<CommandMenuItem>(
    (item) => outsidePerson(item) && isNamedExactly(item, term)
  );
  const outside = (item: CommandMenuItem) =>
    outsidePerson(item) && !namedOutsider(item);
  // People the viewer never talked to (no teammate and no direct message),
  // and those exactly named people outside the team.
  const isStranger = perRow<CommandMenuItem>(
    (item) =>
      namedOutsider(item) ||
      (isPeopleItem(item) && !withTeammate(item) && !hasDirectMessage(item))
  );
  // Among names with a word starting with each typed term, the viewer's own
  // results and people they know come first, then strangers, however exactly
  // a stranger's name matches. Names that only contain the query follow,
  // strangers last in each tier. People outside the team follow all of that,
  // in the same groups among themselves.
  const relationshipGroup = (
    item: CommandMenuItem,
    nameMatchRank: number,
    stranger: boolean
  ) => {
    const teamOffset = outside(item) ? 0 : 3;
    const startsWords =
      nameMatchRank >= NAME_STARTS_WITH_QUERY_RANK ||
      startsWordsOf(displayName(item), term);
    if (!startsWords) return teamOffset;
    return teamOffset + (stranger ? 1 : 2);
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
  // Rows only a server search matched have no group; people outside the team
  // among them still never share one with the team's.
  const groupOf = (item: T) => groups.get(item.id) ?? (outside(item) ? -1 : -2);
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
    const key =
      rank === undefined
        ? `unranked:${groupOf(item)}`
        : `${groupOf(item)}:${rank}:${closeness(item)}`;
    const tier = tiers.get(key) ?? tiers.size;
    tiers.set(key, tier);
    return tier;
  };
  const preserved = (item: CommandMenuItem) =>
    options.preservedIds?.has(item.id) ||
    (options.preserveAdditionalEntityMatches && item.kind === 'entity');
  // Cache search accepts broader subsequences than the menu's fuzzy matcher.
  // Keep these additional matches reachable after the regular ranked results,
  // and people outside the team after the team's additional matches too.
  const matchedIds = new Set(ranked.map((item) => item.id));
  const additional =
    options.preserveAdditionalEntityMatches || options.preservedIds?.size
      ? items
          .filter((item) => preserved(item) && !matchedIds.has(item.id))
          .sort(compareRecency)
      : [];
  const listed = [...ranked, ...additional];
  // Each side keeps its window order on its own, so a person the window
  // holds but the ranking left out stays on their side of the team.
  const side = (isOutside: boolean) =>
    preservePersonOrder(
      prioritizeInternalPeople(
        listed.filter((item) => outside(item) === isOutside),
        groupOf
      ),
      items.filter((item) => outside(item) === isOutside),
      nameRank
    );
  return [...side(false), ...side(true)];
}
