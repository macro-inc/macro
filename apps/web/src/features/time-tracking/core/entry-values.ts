/** Values a person types for an entry. Dates are `YYYY-MM-DD`, instants ISO strings. */
export type TimeEntryValues = {
  date: string;
  minutes: number;
  note: string | null;
  startedAt: string | null;
  endedAt: string | null;
};
