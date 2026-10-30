export type HistoryResource = { type: 'chat' | 'agent'; id: string };
/** Why a trigger's condition kept a run from starting. */
export type HistorySkip =
  | { reason: 'not_met'; probability: number }
  | { reason: 'unavailable' };
/** What one step did in a run, in the order it happened. */
export type HistoryStep =
  | { path: string; kind: 'if'; answer: boolean; probability: number }
  | { path: string; kind: 'choose'; choices?: string[]; probability?: number }
  | { path: string; kind: 'tool'; tool: string; error?: string }
  | { path: string; kind: 'agent'; error?: string };
export type HistoryRecord = {
  id?: string | null;
  resource?: HistoryResource;
  startedAt?: string | null;
  endedAt?: string | null;
  success?: boolean | null;
  skipped?: HistorySkip;
  /** Present for runs of routines with steps. */
  steps?: HistoryStep[];
  error?: string;
};
