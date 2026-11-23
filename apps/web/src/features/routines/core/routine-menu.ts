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

/**
 * The entries a row offers, in separator-delimited groups: opening, running,
 * copying, links, then delete. Routines run as their owner, so everyone else
 * gets only opening and links.
 */
export function routineMenuGroups(
  row: Pick<RoutineRow, 'editable' | 'enabled'>,
  surface: RoutineMenuSurface
): RoutineMenuItem[][] {
  const owned = row.editable;
  const groups: RoutineMenuItem[][] = [
    [
      ...(surface.splits ? (['open-in-split'] as const) : []),
      ...(surface.tabs ? (['open-in-tab'] as const) : []),
    ],
    owned ? ['run-now', row.enabled ? 'turn-off' : 'turn-on'] : [],
    owned ? ['duplicate', ...(surface.nested ? (['keep'] as const) : [])] : [],
    [
      'copy-link',
      'copy-id',
      ...(owned && surface.share ? (['share'] as const) : []),
    ],
    owned ? ['delete'] : [],
  ];
  return groups.filter((group) => group.length > 0);
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
