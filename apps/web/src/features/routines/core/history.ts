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
  | { path: string; kind: 'if'; answer: boolean; probability: number }
  | { path: string; kind: 'choose'; choices?: string[]; probability?: number }
  | { path: string; kind: 'tool'; tool: string; error?: string }
  | { path: string; kind: 'agent'; error?: string }
  | {
      path: string;
      kind: 'code';
      calls: HistoryCall[];
      callsTruncated: boolean;
      error?: string;
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
  /**
   * The routine configuration the run used. Its step paths only name the
   * same steps in that configuration.
   */
  revision?: number;
  error?: string;
};
