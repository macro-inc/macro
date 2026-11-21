import { isBotPrincipalId, isMacroAgentId } from '@core/constant/macroAgent';
import { isMacroNewId } from '@core/constant/macroNew';
import {
  type FreshSortResult,
  NAME_STARTS_WITH_QUERY_RANK,
} from '@core/util/freshSort';

/** How a menu that offers people and agents together orders them. */
export type MenuOrder = {
  /** The signed-in user, listed before everyone else who is a person. */
  viewerId?: string;
  /**
   * @ menus list Macro first, because mentioning Macro is how people call the
   * agent. Assignee menus leave it first among the agents.
   */
  mention?: boolean;
};

function isMacro(id: string): boolean {
  return isMacroAgentId(id) || isMacroNewId(id);
}

/**
 * Whether a row leads every person in the menu, wherever the people land:
 * Macro in @ menus while browsing (no `rank`), or while its name starts with
 * the query.
 */
export function leadsPeople(
  id: string,
  order: MenuOrder,
  rank?: number
): boolean {
  if (!order.mention || !isMacro(id)) return false;
  return rank === undefined || rank >= NAME_STARTS_WITH_QUERY_RANK;
}

function browseGroup(id: string, order: MenuOrder): number {
  if (leadsPeople(id, order)) return 0;
  if (id === order.viewerId) return 1;
  if (!isBotPrincipalId(id)) return 2;
  if (isMacro(id)) return 3;
  return 4;
}

/**
 * Menus that offer people and agents together (assignee pickers and filters,
 * @ mentions) list the viewer, then everyone else who is a person, then agents
 * and bots with Macro first; @ menus lift Macro above the viewer. Rows keep
 * their order within each group.
 */
export function peopleBeforeAgents<T>(
  rows: readonly T[],
  id: (row: T) => string,
  order: MenuOrder = {}
): T[] {
  return [...rows].sort(
    (left, right) =>
      browseGroup(id(left), order) - browseGroup(id(right), order)
  );
}

/** A menu's row limit applies to its people; its few agents always stay listed. */
export function capPeople<T>(
  rows: readonly T[],
  id: (row: T) => string,
  limit: number
): T[] {
  let people = 0;
  return rows.filter((row) => isBotPrincipalId(id(row)) || people++ < limit);
}

/**
 * The same menus while a query is typed: people keep the order they were
 * ranked in, and each matching agent goes after the last person whose name
 * matches at least as well (a `rank` as high or higher), so it can lead only
 * people it matches better than. In @ menus, Macro leads every row while its
 * name starts with the query.
 */
export function placeAgentsAfterPeople<T>(
  people: readonly T[],
  agents: readonly T[],
  rank: (row: T) => number,
  id: (row: T) => string,
  order: MenuOrder = {}
): T[] {
  const leads = (agent: T) => leadsPeople(id(agent), order, rank(agent));
  const ranked = [...agents].sort(
    (left, right) =>
      Number(leads(right)) - Number(leads(left)) || rank(right) - rank(left)
  );
  const slots = ranked.map((agent) => {
    if (leads(agent)) return 0;
    let slot = 0;
    people.forEach((person, index) => {
      if (rank(person) >= rank(agent)) slot = index + 1;
    });
    return slot;
  });

  const result: T[] = [];
  for (let index = 0; index <= people.length; index++) {
    ranked.forEach((agent, position) => {
      if (slots[position] === index) result.push(agent);
    });
    if (index < people.length) result.push(people[index]);
  }
  return result;
}

/**
 * A `NAME_MATCH_RANKING` search's results, keeping its people in order and
 * placing its agents by {@link placeAgentsAfterPeople}. An agent whose text
 * holds the typed letters only scattered (rank -1) is no match and is dropped.
 */
export function rankAgentsAfterPeople<T>(
  results: readonly FreshSortResult<T>[],
  id: (row: T) => string,
  order: MenuOrder = {}
): T[] {
  const ranks = new Map(
    results.map((result) => [result.item, result.nameMatchRank])
  );
  const isAgent = (row: T) => isBotPrincipalId(id(row));
  const rows = results.map((result) => result.item);
  const rank = (row: T) => ranks.get(row) ?? -1;
  return placeAgentsAfterPeople(
    rows.filter((row) => !isAgent(row)),
    rows.filter((row) => isAgent(row) && rank(row) >= 0),
    rank,
    id,
    order
  );
}
