import { formatTimeLabel, getDefaultTimezone } from '@core/util/cron';
import { match } from 'ts-pattern';
import { z } from 'zod';

export const scheduleTriggerSchema = z.object({
  id: z.string(),
  kind: z.literal('schedule'),
  frequency: z.enum(['hour', 'day', 'week', 'month', 'once', 'custom']),
  time: z.string(),
  daysOfWeek: z.array(z.string()),
  dayOfMonth: z.string(),
  timezone: z.string(),
  onceAt: z.string(),
  cron: z.string(),
});
export const routineTriggerSchema = z.discriminatedUnion('kind', [
  scheduleTriggerSchema,
  z.object({
    id: z.string(),
    kind: z.literal('event'),
    events: z
      .array(
        z.enum([
          'document.created',
          'document.updated',
          'document.deleted',
          'task.created',
          'task.status_changed',
          'task.priority_changed',
          'task.property_changed',
          'email.message_received',
          'channel.created',
          'channel.message_posted',
          'channel.mentioned',
          'channel.message_patched',
          'channel.message_attachment_created',
          'call.started',
          'call.ended',
        ])
      )
      .min(1),
    ids: z.array(z.string().uuid()).optional(),
    /** Yes/no question the event's content must answer with yes. */
    condition: z.string().optional(),
  }),
]);
export type ScheduleTriggerDraft = z.infer<typeof scheduleTriggerSchema>;
export type RoutineTriggerDraft = z.infer<typeof routineTriggerSchema>;
export type EventTriggerDraft = Extract<RoutineTriggerDraft, { kind: 'event' }>;
export type RoutineEventName = EventTriggerDraft['events'][number];
export const routineEventGroups = [
  'Channels',
  'Documents',
  'Tasks',
  'Email',
  'Calls',
] as const;
export type RoutineEventGroup = (typeof routineEventGroups)[number];
export const routineEvents: {
  value: RoutineEventName;
  label: string;
  group: RoutineEventGroup;
  description: string;
}[] = [
  {
    value: 'channel.created',
    label: 'Channel created',
    group: 'Channels',
    description: 'A channel you can access is created.',
  },
  {
    value: 'channel.message_posted',
    label: 'Message sent in channel',
    group: 'Channels',
    description: 'Someone sends a message in a selected channel.',
  },
  {
    value: 'channel.mentioned',
    label: '@ mentioned in channel',
    group: 'Channels',
    description: 'You are @ mentioned in a selected channel.',
  },
  {
    value: 'document.created',
    label: 'Document created',
    group: 'Documents',
    description:
      'A document you can access is created. Tasks have their own trigger.',
  },
  {
    value: 'document.deleted',
    label: 'Document deleted',
    group: 'Documents',
    description: 'A selected document is deleted.',
  },
  {
    value: 'task.created',
    label: 'Task created',
    group: 'Tasks',
    description: 'A task you can access is created.',
  },
  {
    value: 'task.status_changed',
    label: 'Status changed',
    group: 'Tasks',
    description: 'The status of a selected task changes.',
  },
  {
    value: 'task.priority_changed',
    label: 'Priority changed',
    group: 'Tasks',
    description: 'The priority of a selected task changes.',
  },
  {
    value: 'task.property_changed',
    label: 'Any property changed',
    group: 'Tasks',
    description:
      'Any property on a selected task changes, including status and priority.',
  },
  {
    value: 'email.message_received',
    label: 'New email received',
    group: 'Email',
    description:
      'New mail arrives in your inbox. Excludes spam, trash, drafts and historical imports.',
  },
  {
    value: 'call.started',
    label: 'Call started',
    group: 'Calls',
    description:
      'A call you start begins. The routine gets the call and who has joined so far.',
  },
  {
    value: 'call.ended',
    label: 'Call ended',
    group: 'Calls',
    description:
      'A call you joined ends. The routine gets the call’s participants and transcript.',
  },
];

// Preserve saved selectors while keeping the creation menu focused on the
// supported product catalog. Editing another field must not drop old triggers.
const legacyEventLabels: Partial<Record<RoutineEventName, string>> = {
  'document.updated': 'Document details changed',
  'channel.message_patched': 'Message edited',
  'channel.message_attachment_created': 'Attachment added',
};

export function eventScopeKind(trigger: EventTriggerDraft) {
  if (trigger.events.every((event) => event.startsWith('task.'))) return 'TASK';
  if (trigger.events.every((event) => event.startsWith('document.')))
    return 'DOCUMENT';
  if (trigger.events.every((event) => event.startsWith('email.')))
    return 'THREAD';
  if (trigger.events.every((event) => event.startsWith('call.')))
    return 'CALL_RECORD';
  return 'CHANNEL';
}

export const MAX_CONDITION_CHARS = 500;

export function conditionPlaceholder(trigger: EventTriggerDraft) {
  return match(eventScopeKind(trigger))
    .with('THREAD', () => 'Is this email an invoice or a receipt?')
    .with('TASK', () => 'Is this task a bug report?')
    .with('DOCUMENT', () => 'Is this document meeting notes?')
    .with('CHANNEL', () => 'Is someone asking for help?')
    .with('CALL_RECORD', () => 'Was this a call with a customer?')
    .exhaustive();
}

export function isGlobalEvent(events: readonly RoutineEventName[]) {
  return events.every(
    (event) =>
      event.endsWith('.created') ||
      event === 'email.message_received' ||
      event === 'call.started' ||
      event === 'call.ended'
  );
}

/** Chip label for a call trigger's global scope. */
export function callEventScopeLabel(events: readonly RoutineEventName[]) {
  const started = events.includes('call.started');
  const ended = events.includes('call.ended');
  if (started && ended) return 'Your calls';
  if (started) return 'Calls you start';
  return 'Calls you join';
}

export function eventTriggerLabel(trigger: EventTriggerDraft) {
  return trigger.events
    .map(
      (event) =>
        routineEvents.find((item) => item.value === event)?.label ??
        legacyEventLabels[event] ??
        event
    )
    .join(', ');
}
export type TriggerFrequency = ScheduleTriggerDraft['frequency'];
export const triggerFrequencies: { value: TriggerFrequency; label: string }[] =
  [
    { value: 'hour', label: 'Hourly' },
    { value: 'day', label: 'Daily' },
    { value: 'week', label: 'Weekly' },
    { value: 'month', label: 'Monthly' },
    { value: 'once', label: 'Once' },
    { value: 'custom', label: 'Custom (cron)' },
  ];
export function newScheduleTrigger(
  frequency: TriggerFrequency
): ScheduleTriggerDraft {
  return {
    id: crypto.randomUUID(),
    kind: 'schedule',
    frequency,
    time: '09:00',
    daysOfWeek: ['2'],
    dayOfMonth: '1',
    timezone: getDefaultTimezone(),
    onceAt: '',
    cron: '0 0 9 * * *',
  };
}
function validateEventTrigger(
  trigger: EventTriggerDraft,
  creating: boolean
): string | null {
  if (!trigger.events.length) return 'Choose an activity event.';
  if (creating && trigger.ids?.length === 0)
    return 'Choose at least one item for this event trigger.';
  if ((trigger.ids?.length ?? 0) > 100)
    return 'Choose up to 100 items per event trigger.';
  if ([...(trigger.condition?.trim() ?? '')].length > MAX_CONDITION_CHARS)
    return `Keep the condition under ${MAX_CONDITION_CHARS} characters.`;
  return null;
}
export function validateTriggers(
  triggers: RoutineTriggerDraft[],
  creating = false
): string | null {
  if (!triggers.length)
    return 'Add a trigger to tell this routine when to run.';
  const events = triggers.filter((trigger) => trigger.kind === 'event');
  const scheduleCount = triggers.length - events.length;
  if (scheduleCount + Number(events.length > 0) > 16)
    return 'A routine can have up to 16 schedule and activity trigger groups.';
  if (events.length > 32)
    return 'A routine can have up to 32 activity filters.';
  for (const trigger of triggers) {
    if (trigger.kind === 'event') {
      const error = validateEventTrigger(trigger, creating);
      if (error) return error;
      continue;
    }
    if (trigger.frequency === 'once') {
      const at = new Date(trigger.onceAt).getTime();
      if (!Number.isFinite(at))
        return 'Choose a date and time for the one-off trigger.';
      if (creating && at <= Date.now())
        return 'Choose a future time for the one-off trigger.';
      continue;
    }
    if (trigger.frequency === 'custom') {
      const parts = trigger.cron.trim().split(/\s+/);
      if (
        parts.length < 6 ||
        parts.length > 7 ||
        parts.some((part) => !/^[-\w*/?,]+$/.test(part))
      )
        return 'Use a cron expression with seconds, minutes, hours, day, month, weekday, and an optional year.';
    } else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.time))
      return 'Choose a valid time.';
    if (trigger.frequency === 'week' && !trigger.daysOfWeek.length)
      return 'Select at least one day for the weekly trigger.';
    if (
      trigger.frequency === 'month' &&
      (!/^\d+$/.test(trigger.dayOfMonth) ||
        Number(trigger.dayOfMonth) < 1 ||
        Number(trigger.dayOfMonth) > 31)
    )
      return 'Choose a day between 1 and 31.';
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: trigger.timezone });
    } catch {
      return 'Choose a valid time zone.';
    }
  }
  return null;
}
/** Cron day numbers (1 is Sunday) in the order a week reads, Monday first. */
const WEEK_ORDER = ['2', '3', '4', '5', '6', '7', '1'];
const DAY_NAMES: Record<string, { short: string; plural: string }> = {
  '1': { short: 'Sun', plural: 'Sundays' },
  '2': { short: 'Mon', plural: 'Mondays' },
  '3': { short: 'Tue', plural: 'Tuesdays' },
  '4': { short: 'Wed', plural: 'Wednesdays' },
  '5': { short: 'Thu', plural: 'Thursdays' },
  '6': { short: 'Fri', plural: 'Fridays' },
  '7': { short: 'Sat', plural: 'Saturdays' },
};
const CRON_DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** Weekly days in words: "Weekdays", "Mondays", "Mon, Wed and Fri". */
function describeDays(days: readonly string[]): string {
  const sorted = WEEK_ORDER.filter((day) => days.includes(day));
  const key = sorted.join(',');
  if (sorted.length === 7) return 'Every day';
  if (key === '2,3,4,5,6') return 'Weekdays';
  if (key === '7,1') return 'Weekends';
  const [only] = sorted;
  if (sorted.length === 1 && only) return DAY_NAMES[only]?.plural ?? '';
  const names = sorted.map((day) => DAY_NAMES[day]?.short ?? day);
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function ordinal(day: number): string {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${match(day % 10)
    .with(1, () => 'st')
    .with(2, () => 'nd')
    .with(3, () => 'rd')
    .otherwise(() => 'th')}`;
}

/** A cron day-of-week field as day numbers, or undefined if it isn't one. */
function cronDays(field: string): string[] | undefined {
  if (field === '*' || field === '?') return [...WEEK_ORDER];
  const value = (part: string) => {
    const index = CRON_DAY_NAMES.indexOf(part.toUpperCase());
    const day = index >= 0 ? index + 1 : Number(part);
    return Number.isInteger(day) && day >= 1 && day <= 7 ? day : undefined;
  };
  const days = new Set<string>();
  for (const part of field.split(',')) {
    const [from, to = from] = part.split('-');
    const start = value(from ?? '');
    const end = value(to ?? '');
    if (start === undefined || end === undefined || start > end) return;
    for (let day = start; day <= end; day++) days.add(String(day));
  }
  return [...days];
}

const pad = (value: string) => value.padStart(2, '0');

/**
 * A cron expression in words when it is a plain daily, weekly or monthly
 * schedule, such as one written with a day range ("2-6") through the API.
 */
function describeCronExpression(cron: string): string | undefined {
  const [second, minute, hour, day, month, weekday, year] = cron
    .trim()
    .split(/\s+/);
  if (second !== '0' || month !== '*' || (year && year !== '*')) return;
  if (!minute || !/^\d+$/.test(minute) || weekday === undefined) return;
  if (hour === '*' && day === '*' && (weekday === '*' || weekday === '?'))
    return minute === '0' ? 'Every hour' : `Every hour at :${pad(minute)}`;
  if (!hour || !/^\d+$/.test(hour)) return;
  const time = formatTimeLabel(`${pad(hour)}:${pad(minute)}`);
  if (day && /^\d+$/.test(day) && (weekday === '*' || weekday === '?'))
    return `Monthly on the ${ordinal(Number(day))} at ${time}`;
  if (day !== '*' && day !== '?') return;
  const days = cronDays(weekday);
  return days?.length ? `${describeDays(days)} at ${time}` : undefined;
}

/** A one-off time in the viewer's words, such as "Oct 31 at 9:00 AM". */
function describeOnce(onceAt: string): string {
  const at = new Date(onceAt);
  if (!onceAt || Number.isNaN(at.getTime())) return 'Once';
  const sameYear = at.getFullYear() === new Date().getFullYear();
  const date = at.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const time = at.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date} at ${time}`;
}

/**
 * One trigger as it reads in a list, such as "Weekdays at 9:00 AM" or "New
 * email received", without its time zone.
 */
export function describeTrigger(trigger: RoutineTriggerDraft): string {
  if (trigger.kind === 'event') return eventTriggerLabel(trigger);
  const time = formatTimeLabel(trigger.time);
  return match(trigger.frequency)
    .with('week', () => `${describeDays(trigger.daysOfWeek)} at ${time}`)
    .with('month', () => {
      const day = Number(trigger.dayOfMonth);
      return Number.isInteger(day) && day >= 1 && day <= 31
        ? `Monthly on the ${ordinal(day)} at ${time}`
        : `Monthly at ${time}`;
    })
    .with('day', () => `Every day at ${time}`)
    .with('hour', () => 'Every hour')
    .with('once', () => describeOnce(trigger.onceAt))
    .with(
      'custom',
      () =>
        describeCronExpression(trigger.cron) ??
        `Custom schedule (${trigger.cron.trim()})`
    )
    .exhaustive();
}

/** What kind of thing starts a trigger, for the icon beside it. */
export type TriggerKind =
  | 'schedule'
  | 'email'
  | 'task'
  | 'document'
  | 'channel'
  | 'call';

export function triggerKind(trigger: RoutineTriggerDraft): TriggerKind {
  if (trigger.kind === 'schedule') return 'schedule';
  return match(eventScopeKind(trigger))
    .returnType<TriggerKind>()
    .with('THREAD', () => 'email')
    .with('TASK', () => 'task')
    .with('DOCUMENT', () => 'document')
    .with('CALL_RECORD', () => 'call')
    .with('CHANNEL', () => 'channel')
    .exhaustive();
}

export function describeTriggers(triggers: RoutineTriggerDraft[]): string {
  return triggers
    .map((trigger) =>
      trigger.kind === 'event'
        ? eventTriggerLabel(trigger)
        : (triggerFrequencies.find((f) => f.value === trigger.frequency)
            ?.label ?? 'Scheduled')
    )
    .join(' · ');
}

export function hasOnlyScheduledTriggers(
  triggers: RoutineTriggerDraft[] | undefined
): boolean {
  return (
    triggers !== undefined &&
    triggers.length > 0 &&
    triggers.every((trigger) => trigger.kind === 'schedule')
  );
}
