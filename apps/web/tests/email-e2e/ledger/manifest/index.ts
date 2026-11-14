// The coverage manifest: one file per group of surfaces, so that changes to
// different parts of the email UI do not meet in one file.

import { compose } from './compose';
import { elsewhere } from './elsewhere';
import { list } from './list';
import { organise } from './organise';
import { savedViews } from './saved-views';
import { send } from './send';
import { settings } from './settings';
import { thread } from './thread';
import type { Group } from './types';

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

const actions = new Set<string>(
  GROUPS.flatMap((group) => group.actions.map((row) => row.id))
);
const states = new Set<string>(
  GROUPS.flatMap((group) => group.states.map((row) => row.id))
);

export function isActionId(id: string): id is ActionId {
  return actions.has(id);
}

export function isStateId(id: string): id is StateId {
  return states.has(id);
}
