export type HistoryResource = { type: 'chat' | 'agent'; id: string };
/** Why a trigger's condition kept a run from starting. */
export type HistorySkip =
  | { reason: 'not_met'; probability: number }
  | { reason: 'unavailable' };
export type HistoryRecord = {
  id?: string | null;
  resource?: HistoryResource;
  startedAt?: string | null;
  endedAt?: string | null;
  success?: boolean | null;
  skipped?: HistorySkip;
};
