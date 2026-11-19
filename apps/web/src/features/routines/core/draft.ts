import type { RoutineInput } from '@service-scheduled-action/generated/schemas';
import type { StepDraft } from './routine-steps';
import type { RoutineTarget } from './routine-target';
import type { RoutineTriggerDraft } from './routine-triggers';

/** A Pipedream app, as stored on the routine's task. */
export type RoutineApp = { app_slug: string; server_name: string };

export type ScheduleFrequency = 'week' | 'month' | 'once';

/**
 * Work a routine's runs schedule once per item, written once with the
 * routine: its code schedules a copy with
 * `macro.routines.schedule(name, { trigger, inputs })`, and each copy runs
 * these steps as they are when it runs.
 */
export type SubRoutineDraft = {
  /** How the routine's code names it; fixed, since that code calls it. */
  name: string;
  /** What a copy does, in a few words; copies are named after it. */
  title: string;
  /** The values each copy is given, declared without values; kept as stored. */
  inputs: RoutineInput[];
  steps: StepDraft[];
  /** Apps a copy's Ask AI step requires; kept as stored. */
  apps: RoutineApp[];
};

/** The definition a sub-routine's copy runs, and the values it was given. */
export type SubRoutineCopyDraft = {
  subRoutine: string;
  inputs: Record<string, unknown>;
};

/**
 * Whether a routine's runs appear in Home and the Agents list. Unlisted runs
 * stay in the routine's history, and Agents shows them on request.
 */
export type RunVisibility = 'listed' | 'unlisted';

/** Runs start unlisted, so a routine that runs often buries nothing. */
export const DEFAULT_RUN_VISIBILITY: RunVisibility = 'unlisted';

/**
 * Something AI created while drafting a routine, such as a database, and
 * whether the routine uses it. One it doesn't use was made for nothing, or
 * is the routine's own work done early.
 */
export type CreatedRoutineItem = {
  entityType: string;
  entityId: string;
  used: boolean;
};

export type ScheduleDraft = {
  id?: string;
  /**
   * What AI created for the routine while drafting it. These exist whether
   * or not the routine is created, so the new routine's page lists them.
   */
  created?: CreatedRoutineItem[];
  triggers?: RoutineTriggerDraft[];
  enabled?: boolean;
  /** Absent from drafts saved before the setting existed. */
  runVisibility?: RunVisibility;
  name: string;
  /** What the routine is for; absent from drafts saved before descriptions. */
  description?: string;
  /** The routine suggestion a new routine starts from, recorded on save. */
  suggestionId?: string;
  prompt: string;
  /**
   * Instructions a single agent routine written through the API stores ahead
   * of `prompt`. Kept as they are, and joined to `prompt` if steps are added.
   */
  basePrompt?: string;
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
   * Whether code steps write as the owner, with no Agent badge, instead of as
   * the agent. Ask AI steps stay the agent's. Absent means off.
   */
  dangerouslyOperateAsUser?: boolean;
  /**
   * The routine's program. Absent for a single agent routine, which keeps its
   * instructions in `prompt` and its model or agent in `target`.
   */
  steps?: StepDraft[];
  /** Work the program's runs schedule once per item. Absent means none. */
  subRoutines?: SubRoutineDraft[];
  /**
   * Values the program's code reads as `inputs`, which a sub-routine's copy
   * kept when it became a routine of its own. Kept as stored.
   */
  inputs?: RoutineInput[];
  /**
   * Set on a sub-routine's copy: the definition it runs, which its parent
   * holds, and its values. Only its trigger and settings are its own.
   */
  copy?: SubRoutineCopyDraft;
  onceAt?: string;
  timezone?: string;
};
