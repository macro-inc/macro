import { getDefaultTimezone } from '@core/util/cron';
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
          'channel.created',
          'channel.message_posted',
          'channel.mentioned',
          'channel.message_patched',
          'channel.message_attachment_created',
        ])
      )
      .min(1),
    ids: z.array(z.string().uuid()).optional(),
  }),
]);
export type ScheduleTriggerDraft = z.infer<typeof scheduleTriggerSchema>;
export type RoutineTriggerDraft = z.infer<typeof routineTriggerSchema>;
export type EventTriggerDraft = Extract<RoutineTriggerDraft, { kind: 'event' }>;
export type RoutineEventName = EventTriggerDraft['events'][number];
export const routineEvents: {
  value: RoutineEventName;
  label: string;
  group: 'Documents' | 'Channels';
  description: string;
}[] = [
  {
    value: 'document.created',
    label: 'Document created',
    group: 'Documents',
    description: 'A document or task is created.',
  },
  {
    value: 'document.updated',
    label: 'Document details changed',
    group: 'Documents',
    description: 'A document’s name, location, or sharing changes.',
  },
  {
    value: 'channel.message_posted',
    label: 'Message sent',
    group: 'Channels',
    description: 'Someone sends a message in a channel.',
  },
  {
    value: 'channel.mentioned',
    label: 'Mention added',
    group: 'Channels',
    description: 'A channel message contains a mention.',
  },
  {
    value: 'channel.message_patched',
    label: 'Message edited',
    group: 'Channels',
    description: 'Someone edits a channel message.',
  },
  {
    value: 'channel.message_attachment_created',
    label: 'Attachment added',
    group: 'Channels',
    description: 'An attachment is added to a channel message.',
  },
  {
    value: 'channel.created',
    label: 'Channel created',
    group: 'Channels',
    description: 'A channel you can access is created.',
  },
];
export function eventTriggerLabel(trigger: EventTriggerDraft) {
  return trigger.events
    .map(
      (event) =>
        routineEvents.find((item) => item.value === event)?.label ?? event
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
      if (!trigger.events.length) return 'Choose an activity event.';
      if (creating && trigger.ids?.length === 0)
        return 'Choose at least one item for this event trigger.';
      if ((trigger.ids?.length ?? 0) > 100)
        return 'Choose up to 100 items per event trigger.';
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
