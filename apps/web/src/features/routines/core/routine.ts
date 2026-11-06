import type { ScheduleDraft } from './draft';
import type { HistoryRecord } from './history';

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
};
