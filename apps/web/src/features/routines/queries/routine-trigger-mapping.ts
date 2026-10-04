import { parseCron } from '@core/util/cron';
import { TZDate } from '@date-fns/tz';
import type { ActionTrigger } from '@service-scheduled-action/generated/schemas';
import { match } from 'ts-pattern';
import {
  newScheduleTrigger,
  type RoutineTriggerDraft,
} from '../core/routine-triggers';

export function serializeTrigger(trigger: RoutineTriggerDraft) {
  if (trigger.kind === 'event')
    return {
      type: 'events' as const,
      filters: [
        {
          events: trigger.events,
          ...(trigger.ids === undefined ? {} : { ids: trigger.ids }),
        },
      ],
    };
  const [hour, minute] = trigger.time.split(':').map(Number);
  if (trigger.frequency === 'once') {
    const date = new Date(trigger.onceAt);
    if (!Number.isFinite(date.getTime()))
      throw new Error('Choose a date and time.');
    return {
      type: 'cron' as const,
      timezone: 'UTC',
      schedule: `${date.getUTCSeconds()} ${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} * ${date.getUTCFullYear()}`,
    };
  }
  const schedule = match(trigger.frequency)
    .with('hour', () => '0 0 * * * *')
    .with('day', () => `0 ${minute} ${hour} * * *`)
    .with(
      'week',
      () => `0 ${minute} ${hour} * * ${trigger.daysOfWeek.toSorted().join(',')}`
    )
    .with('month', () => `0 ${minute} ${hour} ${trigger.dayOfMonth} * *`)
    .with('custom', () => trigger.cron.trim())
    .exhaustive();
  return { type: 'cron' as const, schedule, timezone: trigger.timezone };
}
export function serializeTriggers(
  triggers: RoutineTriggerDraft[]
): ActionTrigger {
  const schedules = triggers
    .filter((trigger) => trigger.kind === 'schedule')
    .map(serializeTrigger);
  const filters = triggers.flatMap((trigger) =>
    trigger.kind === 'event'
      ? [
          {
            events: trigger.events,
            ...(trigger.ids === undefined ? {} : { ids: trigger.ids }),
          },
        ]
      : []
  );
  const values = [
    ...schedules,
    ...(filters.length ? [{ type: 'events' as const, filters }] : []),
  ];
  if (values.length === 1) return values[0];
  return { type: 'multiple', triggers: values };
}
export function parseRoutineTriggers(
  trigger: ActionTrigger
): RoutineTriggerDraft[] | undefined {
  const values = trigger.type === 'multiple' ? trigger.triggers : [trigger];
  if (
    !values.every((value) => value.type === 'cron' || value.type === 'events')
  )
    return undefined;
  return values.flatMap((value): RoutineTriggerDraft[] => {
    if (value.type === 'events')
      return value.filters.map((filter) => ({
        id: crypto.randomUUID(),
        kind: 'event',
        events: filter.events,
        ids: filter.ids ?? undefined,
      }));
    const draft = {
      ...newScheduleTrigger('custom'),
      timezone: value.timezone,
      cron: value.schedule,
    };
    const once = onceFromCron(value.schedule, value.timezone);
    if (once && value.schedule.split(/\s+/)[5] === '*')
      return [{ ...draft, ...once }];
    const parsed = parseCron(value.schedule);
    // Only use a visual preset when serializing it produces the exact schedule.
    // Arbitrary API-written expressions stay editable as cron without losing fields.
    for (const frequency of ['hour', 'day', 'week', 'month'] as const) {
      const candidate = { ...draft, ...parsed, frequency };
      const serialized = serializeTrigger(candidate);
      if (serialized.type === 'cron' && serialized.schedule === value.schedule)
        return [candidate];
    }
    return [draft];
  });
}
export function onceFromCron(
  cron: string,
  timezone = 'UTC'
): { frequency: 'once'; onceAt: string } | undefined {
  const parts = cron.trim().split(/\s+/);
  if (
    parts.length !== 7 ||
    !/^\d{4}$/.test(parts[6]) ||
    !parts.slice(0, 5).every((part) => /^\d+$/.test(part))
  )
    return;
  const [second, minute, hour, day, month, , year] = parts.map(Number);
  const date = new TZDate(year, month - 1, day, hour, minute, second, timezone);
  if (Number.isNaN(date.getTime())) return;
  const instant = new Date(date.getTime());
  const local = new Date(
    instant.getTime() - instant.getTimezoneOffset() * 60000
  );
  return { frequency: 'once', onceAt: local.toISOString().slice(0, 19) };
}
