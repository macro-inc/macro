import type { RoutineTarget } from './routine-target';
import type { RoutineTriggerDraft } from './routine-triggers';

export type ScheduleFrequency = 'week' | 'month' | 'once';

export type ScheduleDraft = {
  id?: string;
  triggers?: RoutineTriggerDraft[];
  enabled?: boolean;
  name: string;
  prompt: string;
  frequency: ScheduleFrequency;
  time: string;
  /** Day-of-week values using the cron crate's 1-7 numbering (1=Sun). */
  daysOfWeek: string[];
  /** 1-31 day-of-month when frequency === "month". */
  dayOfMonth: string;
  target: RoutineTarget;
  onceAt?: string;
  timezone?: string;
};
