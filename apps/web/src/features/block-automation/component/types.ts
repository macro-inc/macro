import type { RoutineTarget } from '../core/routine-target';

export type ScheduleFrequency = 'week' | 'month';

export type ScheduleDraft = {
  id?: string;
  name: string;
  prompt: string;
  frequency: ScheduleFrequency;
  time: string;
  /** Day-of-week values using the cron crate's 1-7 numbering (1=Sun). */
  daysOfWeek: string[];
  /** 1-31 day-of-month when frequency === "month". */
  dayOfMonth: string;
  target: RoutineTarget;
  enabled: boolean;
};
