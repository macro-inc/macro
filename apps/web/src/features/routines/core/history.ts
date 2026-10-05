export type HistoryResource = { type: 'chat' | 'agent'; id: string };
export type HistoryRecord = {
  id?: string | null;
  resource?: HistoryResource;
  startedAt?: string | null;
  endedAt?: string | null;
  success?: boolean | null;
};
