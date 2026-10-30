import {
  describeCron,
  formatTimeLabel,
  getDefaultTimezone,
} from '@core/util/cron';
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
/** One trigger as a sentence, such as "Every Monday at 9:00 AM", without its time zone. */
export function describeTrigger(trigger: RoutineTriggerDraft): string {
  if (trigger.kind === 'event') return `When: ${eventTriggerLabel(trigger)}`;
  return match(trigger.frequency)
    .with('week', 'month', (frequency) => {
      const text = describeCron({
        frequency,
        time: trigger.time,
        daysOfWeek: trigger.daysOfWeek,
        dayOfMonth: trigger.dayOfMonth,
      });
      return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
    })
    .with('day', () => `Every day at ${formatTimeLabel(trigger.time)}`)
    .with('hour', () => 'Every hour')
    .with('once', () => 'Once')
    .with('custom', () => `Custom schedule (${trigger.cron})`)
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
