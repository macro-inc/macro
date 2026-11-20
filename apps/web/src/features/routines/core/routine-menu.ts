import {
  groupMenuItems,
  type MenuGroup,
} from '../../../lib/core/menu/group-menu-items';
import type { RoutineRow } from './types';

/** Entries of a routine row's context menu. */
export type RoutineMenuItem =
  | 'open-in-split'
  | 'open-in-tab'
  | 'run-now'
  | 'turn-off'
  | 'turn-on'
  | 'duplicate'
  | 'keep'
  | 'copy-link'
  | 'copy-id'
  | 'share'
  | 'delete';

/** What the host can offer; an entry it can't is left out, not disabled. */
export type RoutineMenuSurface = {
  /** The row is a sub-routine, listed under the routine whose run created it. */
  nested: boolean;
  splits: boolean;
  tabs: boolean;
  share: boolean;
};

/** The permitted entries in semantic action order, shared by desktop and phone. */
export function routineMenuGroups(
  row: Pick<RoutineRow, 'editable' | 'enabled'>,
  surface: RoutineMenuSurface
): RoutineMenuItem[][] {
  const owned = row.editable;
  const items: RoutineMenuItem[] = [
    ...(surface.splits ? (['open-in-split'] as const) : []),
    ...(surface.tabs ? (['open-in-tab'] as const) : []),
    ...(owned ? (['run-now'] as const) : []),
    ...(owned && surface.share ? (['share'] as const) : []),
    'copy-link',
    'copy-id',
    ...(owned ? (['duplicate'] as const) : []),
    ...(owned && surface.nested ? (['keep'] as const) : []),
    ...(owned ? ([row.enabled ? 'turn-off' : 'turn-on'] as const) : []),
    ...(owned ? (['delete'] as const) : []),
  ];
  return groupMenuItems(items, (item): MenuGroup => {
    if (item === 'open-in-split' || item === 'open-in-tab') return 'open';
    if (item === 'run-now' || item === 'share') return 'most-used';
    if (item === 'copy-link' || item === 'copy-id') return 'copy';
    if (item === 'duplicate' || item === 'keep') return 'modify';
    if (item === 'delete') return 'delete';
    return 'state';
  }).map((group) => group.items);
}

/**
 * Whether its owner can switch the routine on or off now: not while a change
 * is saving, and a routine that is running or has finished its schedule can
 * only be switched off.
 */
export function canToggleRoutine(
  row: Pick<RoutineRow, 'editable' | 'enabled' | 'status'>,
  pending: boolean
): boolean {
  if (!row.editable || pending) return false;
  return (
    row.enabled || (row.status !== 'Running' && row.status !== 'Completed')
  );
}

/** Whether "Run now" can start a run: one at a time, its owner only. */
export function canRunRoutine(
  row: Pick<RoutineRow, 'editable' | 'status'>,
  runPending: boolean
): boolean {
  return row.editable && !runPending && row.status !== 'Running';
}
