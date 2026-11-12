import type { PlaceTransition } from './location-trigger';

export type HistoryResource = { type: 'chat' | 'agent'; id: string };
/** Why a trigger's condition kept a run from starting. */
export type HistorySkip =
  | { reason: 'not_met'; probability: number }
  | { reason: 'unavailable' };
/** How one SDK call a code step made ended. */
export type CallStatus =
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'refused'
  | 'unknown';
/** One SDK call a code step made, without its arguments or results. */
export type HistoryCall = {
  /** The SDK operation, e.g. `email.archiveThread`. */
  operation: string;
  /** Its generic label, e.g. "Archive Thread". */
  label: string;
  write: boolean;
  status: CallStatus;
  /** Milliseconds after the step started. */
  startedMs: number;
  durationMs?: number;
};
/** What one step did in a run, in the order it happened. */
export type HistoryStep =
  | { path: string; kind: 'agent'; error?: string }
  | {
      path: string;
      kind: 'code';
      calls: HistoryCall[];
      callsTruncated: boolean;
      /** What `main` returned, as JSON. */
      output?: unknown;
      error?: string;
    };
/** What started a run. */
export type HistoryStart =
  | { kind: 'schedule'; schedule: string; timezone: string }
  | { kind: 'event'; event: string; entityId?: string }
  /** `place` is the name the owner gave it. */
  | { kind: 'location'; place: string; on: PlaceTransition }
  /** `by` is the person's user id. */
  | { kind: 'manual'; by: string };
/** Whose name a run's code steps wrote under. */
export type CodeActsAs = 'agent' | 'owner';
/** When a run counts as happening, what started it, and the run before it. */
export type HistoryRun = {
  /** The trigger's time, which code reads as the run's time. */
  at: string;
  timezone?: string;
  start: HistoryStart;
  /** When the previous finished run started; absent on the first run. */
  previousAt?: string;
  /** Whom code steps wrote as; absent on runs recorded before the setting. */
  codeActsAs?: CodeActsAs;
};
export type HistoryRecord = {
  id?: string | null;
  resource?: HistoryResource;
  startedAt?: string | null;
  endedAt?: string | null;
  success?: boolean | null;
  skipped?: HistorySkip;
  /** Present for runs of routines with steps. */
  steps?: HistoryStep[];
  /** Present for runs recorded since runs kept what started them. */
  run?: HistoryRun;
  /**
   * The routine configuration the run used. Its step paths only name the
   * same steps in that configuration.
   */
  revision?: number;
  error?: string;
};
