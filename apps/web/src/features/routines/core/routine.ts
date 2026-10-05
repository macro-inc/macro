import type { ScheduleDraft } from './draft';

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
};
