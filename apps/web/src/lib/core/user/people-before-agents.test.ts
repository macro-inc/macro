import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import { MACRO_NEW_PRINCIPAL_ID } from '@core/constant/macroNew';
import { expect, it } from 'vitest';
import {
  peopleBeforeAgents,
  placeAgentsAfterPeople,
} from './people-before-agents';

const viewer = 'macro|viewer@example.com';
const person = 'macro|person@example.com';
const codex = 'bot|00000000-0000-0000-0000-000000000101';
const self = (id: string) => id;

it.each([MACRO_AGENT_PRINCIPAL_ID, MACRO_NEW_PRINCIPAL_ID])(
  'lists Macro (%s) first in @ menus and first among the agents in assignee menus',
  (macro) => {
    const rows = [codex, person, macro, viewer];
    expect(peopleBeforeAgents(rows, self, { viewerId: viewer })).toEqual([
      viewer,
      person,
      macro,
      codex,
    ]);
    expect(
      peopleBeforeAgents(rows, self, { viewerId: viewer, mention: true })
    ).toEqual([macro, viewer, person, codex]);
  }
);

it('leads an @ search with Macro only while its name starts with the query', () => {
  const macro = MACRO_NEW_PRINCIPAL_ID;
  const ranks = new Map([
    [person, 3],
    [macro, 1],
    [codex, 1],
  ]);
  const rank = (id: string) => ranks.get(id) ?? -1;
  expect(placeAgentsAfterPeople([person], [codex, macro], rank, self)).toEqual([
    person,
    codex,
    macro,
  ]);
  expect(
    placeAgentsAfterPeople([person], [codex, macro], rank, self, {
      mention: true,
    })
  ).toEqual([macro, person, codex]);

  ranks.set(macro, 0);
  expect(
    placeAgentsAfterPeople([person], [codex, macro], rank, self, {
      mention: true,
    })
  ).toEqual([person, codex, macro]);
});
