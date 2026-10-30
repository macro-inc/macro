import type { StepDraft } from './routine-steps';
import type { RoutineTarget } from './routine-target';
import type { RoutineTriggerDraft } from './routine-triggers';

/** A Pipedream app, as stored on the routine's task. */
export type RoutineApp = { app_slug: string; server_name: string };

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
  /** Apps every run requires, added to the target's own. Each must be connected. */
  apps: RoutineApp[];
  /**
   * The routine's program. Absent for a single agent routine, which keeps its
   * instructions in `prompt` and its model or agent in `target`.
   */
  steps?: StepDraft[];
  onceAt?: string;
  timezone?: string;
};
