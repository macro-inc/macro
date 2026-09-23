import type { ActionTrigger } from '@service-scheduled-action/generated/schemas';

type CronCompatibleAction = {
  trigger?: ActionTrigger;
  schedule?: string | null;
  timezone?: string | null;
};

type CronTrigger = Extract<ActionTrigger, { type: 'cron' }>;

/** Accept pre-trigger cached cron responses only when no tagged trigger exists. */
export function getCronTrigger(
  action: CronCompatibleAction
): CronTrigger | undefined {
  if (action.trigger !== undefined) {
    return action.trigger?.type === 'cron' ? action.trigger : undefined;
  }
  if (!action.schedule || !action.timezone) return undefined;
  return {
    type: 'cron',
    schedule: action.schedule,
    timezone: action.timezone,
  };
}
