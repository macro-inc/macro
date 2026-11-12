import { isClaimActive } from './claim';
import type { ScheduleDraft } from './draft';
import type { HistoryRecord } from './history';
import { hasOnlyScheduledTriggers } from './routine-triggers';

/** The editor's view of a routine, independent of scheduled-action wire fields. */
export type RoutineSnapshot = {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  enabled: boolean;
  nextRunAt?: string | null;
  claimedAt?: string | null;
  revision: number;
  configurationKey: string;
  draft?: ScheduleDraft;
  /** The shared template this routine was activated from. */
  templateId?: string;
  /** Its latest run, where the list carries one. */
  lastRun?: HistoryRecord;
  /** Set when one of another routine's runs created it. */
  parent?: RoutineParent;
};

/** How a sub-routine belongs to the routine whose run created it. */
export type RoutineParent = {
  /** The routine it follows: paused and deleted with it. */
  id: string;
  /** The run that created it, by that run's history id. */
  createdByRunId: string;
  /** It is off because its parent was switched off. */
  pausedByParent: boolean;
};

/**
 * A routine that only runs on schedules and has none left: a one-time
 * sub-routine that has run leaves its parent's active list.
 */
export function isFinished(routine: RoutineSnapshot): boolean {
  return (
    hasOnlyScheduledTriggers(routine.draft?.triggers) &&
    !routine.nextRunAt &&
    !isClaimActive(routine.claimedAt)
  );
}
