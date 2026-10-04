import {
  buildCron as buildCronExpression,
  type CronParts,
  DEFAULT_TIME,
  DEFAULT_WEEKDAYS,
  describeCron,
  getDefaultTimezone,
  isValidTime,
  parseCron as parseCronParts,
} from '@core/util/cron';
import type { ScheduleDraft } from './draft';
import { routineTargetSchema } from './routine-target';
import { describeTriggers, validateTriggers } from './routine-triggers';

export {
  DEFAULT_TIME,
  getDefaultTimezone,
  isValidTime,
  WEEKDAY_OPTIONS,
} from '@core/util/cron';

type ParsedCron = Pick<
  ScheduleDraft,
  'frequency' | 'time' | 'daysOfWeek' | 'dayOfMonth'
>;
function normalizePrompt(value: string) {
  return value
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

export function deriveScheduleName(prompt: string) {
  const summary = normalizePrompt(prompt);
  if (!summary) return 'Untitled routine';
  return summary.length > 72 ? `${summary.slice(0, 71)}…` : summary;
}

export function cronParts(draft: ScheduleDraft): CronParts {
  return {
    frequency: draft.frequency === 'once' ? 'week' : draft.frequency,
    time: draft.time,
    daysOfWeek: draft.daysOfWeek,
    dayOfMonth: draft.dayOfMonth,
  };
}

export function describeSchedule(draft: ScheduleDraft, timezone: string) {
  if (draft.triggers) return describeTriggers(draft.triggers);
  if (draft.frequency === 'once') {
    return draft.onceAt && !Number.isNaN(new Date(draft.onceAt).getTime())
      ? `Once on ${formatDateTime(new Date(draft.onceAt).toISOString())}`
      : 'Choose a date and time for a single run.';
  }
  return describeCron(cronParts(draft), draft.timezone ?? timezone);
}

export function parseCron(cron: string): ParsedCron {
  return parseCronParts(cron);
}

export function buildCron(draft: ScheduleDraft) {
  return buildCronExpression(cronParts(draft));
}

export function createEmptyDraft(model: string): ScheduleDraft {
  return {
    name: '',
    prompt: '',
    frequency: 'week',
    time: DEFAULT_TIME,
    daysOfWeek: [...DEFAULT_WEEKDAYS],
    dayOfMonth: '1',
    target: { kind: 'model', model },
  };
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Never';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function validateRoutineDraft(
  draft: ScheduleDraft,
  creating = false
): string | null {
  if (!draft.prompt.trim()) return 'Instructions are required.';
  if (!routineTargetSchema.safeParse(draft.target).success)
    return 'Choose a valid model or agent.';
  if (draft.triggers) return validateTriggers(draft.triggers, creating);
  if (draft.frequency === 'once') {
    const at = new Date(draft.onceAt ?? '').getTime();
    if (!Number.isFinite(at)) return 'Choose a date and time.';
    if (creating && at <= Date.now()) return 'Choose a time in the future.';
    return null;
  }
  if (!isValidTime(draft.time)) return 'Choose a valid time.';
  if (draft.frequency === 'week' && !draft.daysOfWeek.length)
    return 'Select at least one day.';
  if (
    draft.frequency === 'month' &&
    (!Number.isInteger(Number(draft.dayOfMonth)) ||
      Number(draft.dayOfMonth) < 1 ||
      Number(draft.dayOfMonth) > 31)
  )
    return 'Pick a day between 1 and 31.';
  try {
    new Intl.DateTimeFormat(undefined, {
      timeZone: draft.timezone ?? getDefaultTimezone(),
    });
  } catch {
    return 'Choose a valid time zone, such as America/New_York.';
  }
  return null;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Please try again.';
}
