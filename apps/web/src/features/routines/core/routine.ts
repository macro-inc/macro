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
  /** Whether the latest finished run failed; unknown outside the list. */
  lastRunFailed?: boolean;
  revision: number;
  configurationKey: string;
  draft?: ScheduleDraft;
  /** The shared template this routine was activated from. */
  templateId?: string;
};
