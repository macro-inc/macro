import { DEFAULT_MODEL } from '@core/component/AI/constant';
import type { Model } from '@core/component/AI/types';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { ThrownResultError } from '@core/util/result';
import type {
  AgentTask,
  CreateScheduledAction,
  ScheduledAction,
  UpdateScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import type { ScheduleDraft, ScheduleFrequency } from './types';

export const INPUT_CLASS =
  'w-full border border-edge-muted rounded-sm bg-surface px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink/30 focus:border-accent/20 cursor-default';
export const DEFAULT_TIME = '09:00';

export const FREQUENCY_OPTIONS: Array<{
  value: ScheduleFrequency;
  label: string;
}> = [
  { value: 'week', label: 'Every week' },
  { value: 'month', label: 'Every month' },
];

// Day-of-week values match the `cron` Rust crate convention:
//   1 = Sun, 2 = Mon, 3 = Tue, 4 = Wed, 5 = Thu, 6 = Fri, 7 = Sat
export const WEEKDAY_OPTIONS = [
  { value: '1', label: 'Sun', fullLabel: 'Sunday' },
  { value: '2', label: 'Mon', fullLabel: 'Monday' },
  { value: '3', label: 'Tue', fullLabel: 'Tuesday' },
  { value: '4', label: 'Wed', fullLabel: 'Wednesday' },
  { value: '5', label: 'Thu', fullLabel: 'Thursday' },
  { value: '6', label: 'Fri', fullLabel: 'Friday' },
  { value: '7', label: 'Sat', fullLabel: 'Saturday' },
];

const DOW_VALUES = WEEKDAY_OPTIONS.map((option) => option.value);
const DEFAULT_WEEKDAYS = ['2', '3', '4', '5', '6']; // Mon-Fri

export function getDefaultTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function normalizePrompt(value: string) {
  return value
    .trim()
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

function deriveScheduleName(prompt: string) {
  const summary = normalizePrompt(prompt);
  if (!summary) return blockNameToDefaultFile('automation');
  return summary.length > 72 ? `${summary.slice(0, 71)}…` : summary;
}

export function isValidTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function toTimeValue(hour: string, minute: string) {
  const safeHour = Number(hour);
  const safeMinute = Number(minute);
  if (
    Number.isNaN(safeHour) ||
    Number.isNaN(safeMinute) ||
    safeHour < 0 ||
    safeHour > 23 ||
    safeMinute < 0 ||
    safeMinute > 59
  ) {
    return DEFAULT_TIME;
  }

  return `${String(safeHour).padStart(2, '0')}:${String(safeMinute).padStart(2, '0')}`;
}

function formatTimeLabel(value: string) {
  if (!isValidTime(value)) return value;
  const [hour, minute] = value.split(':').map(Number);
  const date = new Date(2026, 0, 1, hour, minute);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function formatDayList(daysOfWeek: string[]): string {
  if (daysOfWeek.length === 0) return 'no days';
  const sorted = [...daysOfWeek].sort(
    (a, b) => DOW_VALUES.indexOf(a) - DOW_VALUES.indexOf(b)
  );
  if (sorted.length === 7) return 'every day';
  if (
    sorted.length === 5 &&
    sorted.every((d) => DEFAULT_WEEKDAYS.includes(d))
  ) {
    return 'weekdays';
  }
  if (sorted.length === 2 && sorted.includes('1') && sorted.includes('7')) {
    return 'weekends';
  }
  return sorted
    .map((d) => WEEKDAY_OPTIONS.find((opt) => opt.value === d)?.fullLabel)
    .filter(Boolean)
    .join(', ');
}

function nthSuffix(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

export function describeSchedule(draft: ScheduleDraft, timezone: string) {
  const timeLabel = formatTimeLabel(draft.time);
  if (draft.frequency === 'week') {
    return `${formatDayList(draft.daysOfWeek)} at ${timeLabel} (${timezone})`;
  }
  const day = Number(draft.dayOfMonth);
  if (Number.isInteger(day) && day >= 1 && day <= 31) {
    return `${day}${nthSuffix(day)} of each month at ${timeLabel} (${timezone})`;
  }
  return `Each month at ${timeLabel} (${timezone})`;
}

type ParsedCron = Pick<
  ScheduleDraft,
  'frequency' | 'time' | 'daysOfWeek' | 'dayOfMonth'
>;

export function parseCron(cron: string): ParsedCron {
  const fallback: ParsedCron = {
    frequency: 'week',
    time: DEFAULT_TIME,
    daysOfWeek: [...DEFAULT_WEEKDAYS],
    dayOfMonth: '1',
  };

  const fields = cron.trim().split(/\s+/);
  // The Rust `cron` crate requires 6 (`sec min hour dom mon dow`) or
  // 7 (with year) fields.
  if (fields.length !== 6 && fields.length !== 7) return fallback;

  const [, minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const time = toTimeValue(hour, minute);

  if (month !== '*') return { ...fallback, time };

  // Weekly-ish: dom="*" with a dow list/range.
  if (dayOfMonth === '*') {
    if (dayOfWeek === '*') {
      return {
        frequency: 'week',
        time,
        daysOfWeek: [...DOW_VALUES],
        dayOfMonth: '1',
      };
    }
    const days = expandDowExpression(dayOfWeek);
    if (days.length > 0) {
      return {
        frequency: 'week',
        time,
        daysOfWeek: days,
        dayOfMonth: '1',
      };
    }
    return { ...fallback, time };
  }

  // Monthly: specific day-of-month, dow="*".
  if (dayOfWeek === '*' && /^(?:[1-9]|[12]\d|3[01])$/.test(dayOfMonth)) {
    return {
      frequency: 'month',
      time,
      daysOfWeek: [...DEFAULT_WEEKDAYS],
      dayOfMonth,
    };
  }

  return { ...fallback, time };
}

/**
 * Expands a day-of-week cron expression like "2,4,6" or "2-6" into a list of
 * single DOW values. Returns `[]` if anything in the expression can't be
 * interpreted — caller should fall back to defaults.
 */
function expandDowExpression(expr: string): string[] {
  const parts = expr.split(',');
  const set = new Set<string>();
  for (const raw of parts) {
    const part = raw.trim();
    if (/^[1-7]$/.test(part)) {
      set.add(part);
      continue;
    }
    const range = part.match(/^([1-7])-([1-7])$/);
    if (range) {
      const [, lo, hi] = range;
      const loN = Number(lo);
      const hiN = Number(hi);
      if (loN <= hiN) {
        for (let n = loN; n <= hiN; n++) set.add(String(n));
        continue;
      }
    }
    return [];
  }
  return [...set].sort((a, b) => DOW_VALUES.indexOf(a) - DOW_VALUES.indexOf(b));
}

function buildCron(draft: ScheduleDraft) {
  const [hour, minute] = (isValidTime(draft.time) ? draft.time : DEFAULT_TIME)
    .split(':')
    .map((value) => Number(value));

  // 6-field format required by the Rust `cron` crate:
  //   sec min hour dayOfMonth month dayOfWeek
  if (draft.frequency === 'week') {
    const days = draft.daysOfWeek.length
      ? [...draft.daysOfWeek]
          .sort((a, b) => DOW_VALUES.indexOf(a) - DOW_VALUES.indexOf(b))
          .join(',')
      : '*';
    return `0 ${minute} ${hour} * * ${days}`;
  }
  const day = Number(draft.dayOfMonth);
  const safeDay = Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1;
  return `0 ${minute} ${hour} ${safeDay} * *`;
}

export function createEmptyDraft(): ScheduleDraft {
  return {
    name: '',
    prompt: '',
    frequency: 'week',
    time: DEFAULT_TIME,
    daysOfWeek: [...DEFAULT_WEEKDAYS],
    dayOfMonth: '1',
    model: DEFAULT_MODEL,
    enabled: true,
  };
}

function getAgentTask(schedule: ScheduledAction): AgentTask {
  // Backend stores task as a JSON object; for kind === "Agent" it is shaped
  // like AgentTask. Cast through unknown to satisfy the open-ended type.
  return schedule.task as unknown as AgentTask;
}

export function draftFromSchedule(schedule: ScheduledAction): ScheduleDraft {
  const parsed = parseCron(schedule.schedule);
  const task = getAgentTask(schedule);

  return {
    id: schedule.id ?? undefined,
    name: schedule.name,
    prompt: task.user_prompt ?? '',
    frequency: parsed.frequency,
    time: parsed.time,
    daysOfWeek: parsed.daysOfWeek,
    dayOfMonth: parsed.dayOfMonth,
    model: (task.model as Model) ?? undefined,
    enabled: schedule.enabled,
  };
}

function buildAgentTask(draft: ScheduleDraft): AgentTask {
  return {
    model: draft.model,
    prompt: '',
    user_prompt: draft.prompt.trim(),
  };
}

export function draftToCreateBody(draft: ScheduleDraft): CreateScheduledAction {
  return {
    name: draft.name.trim() || deriveScheduleName(draft.prompt),
    schedule: buildCron(draft),
    kind: 'Agent',
    timezone: getDefaultTimezone(),
    task: buildAgentTask(draft) as unknown as CreateScheduledAction['task'],
    enabled: draft.enabled,
  };
}

export function draftToUpdateBody(
  draft: ScheduleDraft,
  previous: ScheduledAction
): UpdateScheduledAction {
  return {
    name: draft.name.trim() || deriveScheduleName(draft.prompt),
    schedule: buildCron(draft),
    kind: 'Agent',
    timezone: previous.timezone || getDefaultTimezone(),
    task: buildAgentTask(draft) as unknown as UpdateScheduledAction['task'],
    enabled: draft.enabled,
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

export function getErrorMessage(error: unknown) {
  if (error instanceof ThrownResultError) {
    return error.errors.map((item) => item.message).join(', ');
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return 'Please try again.';
}
