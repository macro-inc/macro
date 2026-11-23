// The coverage manifest: the functions of email, and one file per group of
// surfaces with the rows that are their variants, so that changes to
// different parts of the email UI do not meet in one file.

import { compose } from './compose';
import { elsewhere } from './elsewhere';
import { FUNCTIONS } from './functions';
import { list } from './list';
import { organise } from './organise';
import { savedViews } from './saved-views';
import { send } from './send';
import { settings } from './settings';
import { thread } from './thread';
import type { Action, Group, State } from './types';

export const GROUPS = [
  list,
  thread,
  organise,
  savedViews,
  compose,
  send,
  settings,
  elsewhere,
] as const satisfies readonly Group[];

export type ActionId = (typeof GROUPS)[number]['actions'][number]['id'];
export type StateId = (typeof GROUPS)[number]['states'][number]['id'];
/** `F-012`, a row of `../functions.tsv`. */
export type FunctionId = `F-${string}`;

const actions = new Map<string, Action>(
  GROUPS.flatMap((group) => group.actions.map((row: Action) => [row.id, row]))
);
const states = new Map<string, State>(
  GROUPS.flatMap((group) => group.states.map((row: State) => [row.id, row]))
);
const functions = new Set(FUNCTIONS.map((each) => each.id));

export function isActionId(id: string): id is ActionId {
  return actions.has(id);
}

export function isStateId(id: string): id is StateId {
  return states.has(id);
}

export function isFunctionId(id: string): id is FunctionId {
  return functions.has(id);
}

/** The functions a row is a variant of, or shows the result of. */
export function functionsOf(row: string): readonly string[] {
  return (actions.get(row) ?? states.get(row))?.fn ?? [];
}
