import { parseCron } from '@core/util/cron';
import { TZDate } from '@date-fns/tz';
import type {
  ActionTrigger,
  EventFilter,
  PayloadCondition,
  PayloadScalar,
} from '@service-scheduled-action/generated/schemas';
import { match } from 'ts-pattern';
import {
  type EventTriggerDraft,
  newScheduleTrigger,
  type PayloadTestDraft,
  payloadTestValues,
  type RoutineTriggerDraft,
} from '../core/routine-triggers';

/** Typed text as the JSON scalar it names; anything else stays text. */
function scalar(text: string): PayloadScalar {
  const value = text.trim();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function serializePayloadTest(test: PayloadTestDraft): PayloadCondition {
  const path = test.path.split('.').map((segment) => segment.trim());
  return match(test.op)
    .with('equals', () => ({ path, equals: scalar(test.value) }))
    .with('in', () => ({ path, in: payloadTestValues(test).map(scalar) }))
    .with('notIn', () => ({
      path,
      notIn: payloadTestValues(test).map(scalar),
    }))
    .with('glob', () => ({ path, glob: test.value.trim() }))
    .with('exists', () => ({ path, exists: true }))
    .with('missing', () => ({ path, exists: false }))
    .exhaustive(() => {
      throw new Error('Choose how to test the payload field.');
    });
}

function parsePayloadTest(condition: PayloadCondition): PayloadTestDraft {
  const path = condition.path.join('.');
  const list = (values: PayloadScalar[]) => values.map(String).join(', ');
  if (condition.in != null)
    return { path, op: 'in', value: list(condition.in) };
  if (condition.notIn != null)
    return { path, op: 'notIn', value: list(condition.notIn) };
  if (condition.glob != null)
    return { path, op: 'glob', value: condition.glob };
  if (condition.exists != null)
    return { path, op: condition.exists ? 'exists' : 'missing', value: '' };
  return { path, op: 'equals', value: String(condition.equals ?? null) };
}

function serializeFilter(trigger: EventTriggerDraft): EventFilter {
  const condition = trigger.condition?.trim();
  return {
    events: trigger.events,
    ...(trigger.ids === undefined ? {} : { ids: trigger.ids }),
    ...(trigger.github ? { github: trigger.github } : {}),
    ...(trigger.match?.length
      ? { match: trigger.match.map(serializePayloadTest) }
      : {}),
    ...(condition ? { condition } : {}),
  };
}

export function serializeTrigger(trigger: RoutineTriggerDraft) {
  if (trigger.kind === 'event')
    return {
      type: 'events' as const,
      filters: [serializeFilter(trigger)],
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
    .exhaustive(() => {
      throw new Error('Choose how often the routine runs.');
    });
  return { type: 'cron' as const, schedule, timezone: trigger.timezone };
}
export function serializeTriggers(
  triggers: RoutineTriggerDraft[]
): ActionTrigger {
  const schedules = triggers
    .filter((trigger) => trigger.kind === 'schedule')
    .map(serializeTrigger);
  const filters = triggers.flatMap((trigger) =>
    trigger.kind === 'event' ? [serializeFilter(trigger)] : []
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
        github: filter.github
          ? {
              events: filter.github.events ?? [],
              actions: filter.github.actions ?? [],
              repositories: filter.github.repositories ?? [],
              includeBots: filter.github.includeBots ?? false,
            }
          : undefined,
        match: filter.match?.map(parsePayloadTest),
        condition: filter.condition ?? undefined,
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
