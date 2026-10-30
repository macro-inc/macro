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
/** One exact test on an external delivery's JSON payload, as the editor holds it. */
export const payloadTestSchema = z.object({
  /** Keys from the payload's root, joined with dots; `*` steps into every array item. */
  path: z.string(),
  op: z.enum(['equals', 'in', 'notIn', 'glob', 'exists', 'missing']),
  /** A value, or a comma-separated list for `in` and `notIn`. */
  value: z.string(),
});
export type PayloadTestDraft = z.infer<typeof payloadTestSchema>;
export type PayloadTestOp = PayloadTestDraft['op'];

/** Which GitHub App deliveries a `github` trigger watches; empty lists match everything. */
export const githubSelectorSchema = z.object({
  events: z.array(z.string()),
  actions: z.array(z.string()),
  /** `owner/name`. */
  repositories: z.array(z.string()),
  includeBots: z.boolean(),
});
export type GithubSelectorDraft = z.infer<typeof githubSelectorSchema>;

/** The repositories a GitHub trigger can choose from. */
export type GithubRepositoryOptions = {
  /** `owner/name` of every repository Macro's GitHub app reaches for you. */
  names: string[];
  loading: boolean;
  error: boolean;
};

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
          'github',
        ])
      )
      .min(1),
    ids: z.array(z.string().uuid()).optional(),
    /** Only for `github`. */
    github: githubSelectorSchema.optional(),
    /** Only for `github`: payload tests that must all pass. */
    match: z.array(payloadTestSchema).optional(),
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
  'GitHub',
] as const;
export type RoutineEventGroup = (typeof routineEventGroups)[number];
type ExternalPreset = Pick<EventTriggerDraft, 'github' | 'match'>;

function github(
  events: string[],
  actions: string[] = [],
  match?: PayloadTestDraft[]
): ExternalPreset {
  return {
    github: { events, actions, repositories: [], includeBots: false },
    ...(match ? { match } : {}),
  };
}

export const routineEvents: {
  value: RoutineEventName;
  label: string;
  group: RoutineEventGroup;
  description: string;
  /** What choosing this item fills in, for events from outside Macro. */
  preset?: ExternalPreset;
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
  {
    value: 'github',
    label: 'Workflow failed',
    group: 'GitHub',
    description:
      'A GitHub Actions workflow finishes without passing. Test workflow_run.name to watch one workflow.',
    preset: github(
      ['workflow_run'],
      ['completed'],
      [
        {
          path: 'workflow_run.conclusion',
          op: 'in',
          value: 'failure, timed_out',
        },
      ]
    ),
  },
  {
    value: 'github',
    label: 'Workflow finished',
    group: 'GitHub',
    description: 'A GitHub Actions workflow finishes, whatever its result.',
    preset: github(['workflow_run'], ['completed']),
  },
  {
    value: 'github',
    label: 'Pull request opened',
    group: 'GitHub',
    description: 'Someone opens a pull request.',
    preset: github(['pull_request'], ['opened']),
  },
  {
    value: 'github',
    label: 'Pull request merged',
    group: 'GitHub',
    description: 'A pull request is merged.',
    preset: github(
      ['pull_request'],
      ['closed'],
      [{ path: 'pull_request.merged', op: 'equals', value: 'true' }]
    ),
  },
  {
    value: 'github',
    label: 'Review requested',
    group: 'GitHub',
    description: 'Someone asks for a review on a pull request.',
    preset: github(['pull_request'], ['review_requested']),
  },
  {
    value: 'github',
    label: 'Review submitted',
    group: 'GitHub',
    description:
      'Someone approves, comments on, or requests changes to a pull request.',
    preset: github(['pull_request_review'], ['submitted']),
  },
  {
    value: 'github',
    label: 'Issue opened',
    group: 'GitHub',
    description: 'Someone opens an issue.',
    preset: github(['issues'], ['opened']),
  },
  {
    value: 'github',
    label: 'Comment added',
    group: 'GitHub',
    description: 'Someone comments on an issue or pull request.',
    preset: github(['issue_comment'], ['created']),
  },
  {
    value: 'github',
    label: 'Code pushed',
    group: 'GitHub',
    description:
      'Commits are pushed. Test ref, e.g. refs/heads/main, to watch one branch.',
    preset: github(['push']),
  },
  {
    value: 'github',
    label: 'Release published',
    group: 'GitHub',
    description: 'A release is published.',
    preset: github(['release'], ['published']),
  },
  {
    value: 'github',
    label: 'Any GitHub event',
    group: 'GitHub',
    description:
      'Any event Macro’s GitHub app receives, narrowed by the event names, actions, and payload tests you choose.',
    preset: github([]),
  },
];

// Preserve saved selectors while keeping the creation menu focused on the
// supported product catalog. Editing another field must not drop old triggers.
const legacyEventLabels: Partial<Record<RoutineEventName, string>> = {
  'document.updated': 'Document details changed',
  'channel.message_patched': 'Message edited',
  'channel.message_attachment_created': 'Attachment added',
};

export type EventScopeKind =
  | 'TASK'
  | 'DOCUMENT'
  | 'THREAD'
  | 'CALL_RECORD'
  | 'CHANNEL'
  | 'GITHUB';

export function eventScopeKind(trigger: EventTriggerDraft): EventScopeKind {
  if (trigger.events.includes('github')) return 'GITHUB';
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
    .with('GITHUB', () => 'Does this failure look like a flaky test?')
    .exhaustive();
}

export function isGlobalEvent(events: readonly RoutineEventName[]) {
  return events.every(
    (event) =>
      event.endsWith('.created') ||
      event === 'email.message_received' ||
      event === 'call.started' ||
      event === 'call.ended' ||
      event === 'github'
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

function sameNames(left: readonly string[], right: readonly string[]) {
  const sorted = right.toSorted();
  return (
    left.length === right.length &&
    left.toSorted().every((name, index) => name === sorted[index])
  );
}

/** A preset's label while the selector is still that preset's, else its events. */
function githubTriggerLabel(selector: GithubSelectorDraft | undefined) {
  const preset = routineEvents.find(
    (item) =>
      item.preset?.github !== undefined &&
      selector !== undefined &&
      sameNames(item.preset.github.events, selector.events) &&
      sameNames(item.preset.github.actions, selector.actions)
  );
  if (preset) return preset.label;
  if (!selector?.events.length) return 'Any GitHub event';
  return `GitHub ${selector.events.join(', ')}`;
}

/** What the trigger's events are, for its settings panel. */
export function eventTriggerDescription(trigger: EventTriggerDraft) {
  if (trigger.events.includes('github')) {
    const label = githubTriggerLabel(trigger.github);
    const github = routineEvents.filter((item) => item.value === 'github');
    return (
      github.find((item) => item.label === label) ??
      github.find((item) => item.preset?.github?.events.length === 0)
    )?.description;
  }
  return trigger.events
    .map(
      (name) => routineEvents.find((item) => item.value === name)?.description
    )
    .join(' ');
}

export function eventTriggerLabel(trigger: EventTriggerDraft) {
  if (trigger.events.includes('github'))
    return githubTriggerLabel(trigger.github);
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
  return (
    validateGithubSelector(trigger.github) ??
    validatePayloadTests(trigger.match)
  );
}

const GITHUB_NAME = /^[a-z_]{1,64}$/;
const GITHUB_REPOSITORY = /^[^/\s]+\/[^/\s]+$/;
export const MAX_PAYLOAD_TESTS = 16;
const MAX_PAYLOAD_VALUES = 50;
const MAX_PAYLOAD_VALUE_CHARS = 500;

function validateGithubSelector(
  selector: GithubSelectorDraft | undefined
): string | null {
  if (!selector) return null;
  if (selector.events.length > 32 || selector.actions.length > 32)
    return 'Choose up to 32 GitHub events and 32 actions.';
  if (
    ![...selector.events, ...selector.actions].every((name) =>
      GITHUB_NAME.test(name)
    )
  )
    return 'GitHub event and action names are lowercase words joined by underscores, like workflow_run.';
  if (selector.repositories.length > 100)
    return 'Choose up to 100 repositories.';
  if (!selector.repositories.every((name) => GITHUB_REPOSITORY.test(name)))
    return 'Name repositories as owner/name.';
  return null;
}

/** A test's values: its list for `in` and `notIn`, split on commas. */
export function payloadTestValues(test: PayloadTestDraft): string[] {
  return test.value
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function validatePayloadTests(
  tests: PayloadTestDraft[] | undefined
): string | null {
  if (!tests) return null;
  if (tests.length > MAX_PAYLOAD_TESTS)
    return `Add up to ${MAX_PAYLOAD_TESTS} payload tests.`;
  for (const test of tests) {
    const segments = test.path.split('.');
    if (segments.length > 16 || segments.some((segment) => !segment.trim()))
      return 'Write each payload field as keys joined by dots, like workflow_run.conclusion.';
    if (test.op === 'exists' || test.op === 'missing') continue;
    if (!test.value.trim()) return `Give ${test.path} a value to test.`;
    if ([...test.value].length > MAX_PAYLOAD_VALUE_CHARS)
      return `Keep payload test values under ${MAX_PAYLOAD_VALUE_CHARS} characters.`;
    if (
      (test.op === 'in' || test.op === 'notIn') &&
      payloadTestValues(test).length > MAX_PAYLOAD_VALUES
    )
      return `List up to ${MAX_PAYLOAD_VALUES} values per payload test.`;
  }
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
  | 'call'
  | 'github';

export function triggerKind(trigger: RoutineTriggerDraft): TriggerKind {
  if (trigger.kind === 'schedule') return 'schedule';
  return match(eventScopeKind(trigger))
    .returnType<TriggerKind>()
    .with('THREAD', () => 'email')
    .with('TASK', () => 'task')
    .with('DOCUMENT', () => 'document')
    .with('CALL_RECORD', () => 'call')
    .with('CHANNEL', () => 'channel')
    .with('GITHUB', () => 'github')
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
