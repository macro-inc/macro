import { isBotPrincipalId, isMacroAgentId } from '@core/constant/macroAgent';
import { isMacroNewId } from '@core/constant/macroNew';
import type { FreshSortResult } from '@core/util/freshSort';
import { normalizeNameText } from '@core/util/name-match-score';

function browseGroup(id: string, viewerId: string | undefined): number {
  if (viewerId !== undefined && id === viewerId) return 0;
  if (!isBotPrincipalId(id)) return 1;
  if (isMacroAgentId(id) || isMacroNewId(id)) return 2;
  return 3;
}

/**
 * Menus that offer people and agents together (assignee pickers and filters,
 * @ mentions) list the viewer, then everyone else who is a person, then agents
 * and bots with Macro first. Rows keep their order within each group.
 */
export function peopleBeforeAgents<T>(
  rows: readonly T[],
  id: (row: T) => string,
  viewerId?: string
): T[] {
  return [...rows].sort(
    (left, right) =>
      browseGroup(id(left), viewerId) - browseGroup(id(right), viewerId)
  );
}

/** Letters scattered through a name are not a match for an agent: it must hold every typed word. */
export function agentMatchesQuery(text: string, query: string): boolean {
  const normalized = normalizeNameText(text);
  return normalizeNameText(query)
    .split(/[\s,]+/)
    .filter(Boolean)
    .every((word) => normalized.includes(word));
}

/**
 * The same menus while a query is typed: people keep the order they were
 * ranked in, and each matching agent goes after the last person whose name
 * matches at least as well (a `rank` as high or higher), so it can lead only
 * people it matches better than.
 */
export function placeAgentsAfterPeople<T>(
  people: readonly T[],
  agents: readonly T[],
  rank: (row: T) => number
): T[] {
  const ranked = [...agents].sort((left, right) => rank(right) - rank(left));
  const slots = ranked.map((agent) => {
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

/** A search's results, keeping its people in order and placing only the agents that match by {@link placeAgentsAfterPeople}. */
export function rankAgentsAfterPeople<T>(
  results: readonly FreshSortResult<T>[],
  id: (row: T) => string,
  text: (row: T) => string,
  query: string
): T[] {
  const ranks = new Map(
    results.map((result) => [result.item, result.nameMatchRank])
  );
  const isAgent = (row: T) => isBotPrincipalId(id(row));
  const rows = results.map((result) => result.item);
  return placeAgentsAfterPeople(
    rows.filter((row) => !isAgent(row)),
    rows.filter((row) => isAgent(row) && agentMatchesQuery(text(row), query)),
    (row) => ranks.get(row) ?? -1
  );
}
