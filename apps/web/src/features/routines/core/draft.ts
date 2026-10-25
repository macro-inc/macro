import type { RoutineTarget } from './routine-target';
import type { RoutineTriggerDraft } from './routine-triggers';

export type ScheduleFrequency = 'week' | 'month' | 'once';

/**
 * Whether a routine's runs appear in Home and the Agents list. Unlisted runs
 * stay in the routine's history, and Agents shows them on request.
 */
export type RunVisibility = 'listed' | 'unlisted';

/** Runs start unlisted, so a routine that runs often buries nothing. */
export const DEFAULT_RUN_VISIBILITY: RunVisibility = 'unlisted';

export type ScheduleDraft = {
  id?: string;
  triggers?: RoutineTriggerDraft[];
  enabled?: boolean;
  /** Absent from drafts saved before the setting existed. */
  runVisibility?: RunVisibility;
  name: string;
  prompt: string;
  frequency: ScheduleFrequency;
  time: string;
  /** Day-of-week values using the cron crate's 1-7 numbering (1=Sun). */
  daysOfWeek: string[];
  /** 1-31 day-of-month when frequency === "month". */
  dayOfMonth: string;
  target: RoutineTarget;
  onceAt?: string;
  timezone?: string;
};
