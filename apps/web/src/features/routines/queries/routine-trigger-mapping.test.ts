import { describe, expect, it } from 'vitest';
import {
  newScheduleTrigger,
  routineEvents,
  routineTriggerSchema,
  validateTriggers,
} from '../core/routine-triggers';
import {
  parseRoutineTriggers,
  serializeTriggers,
} from './routine-trigger-mapping';

// Conversion must preserve independently authored schedules and API expressions.
describe('routine trigger mapping', () => {
  it.each(routineEvents)(
    'round trips $value without confusing its scope',
    (event) => {
      const config = {
        type: 'events' as const,
        filters: [{ events: [event.value] }],
      };
      const triggers = parseRoutineTriggers(config)!;
      expect(routineTriggerSchema.safeParse(triggers[0]).success).toBe(true);
      expect(serializeTriggers(triggers)).toEqual(config);
    }
  );

  it('round trips multiple schedules with different time zones and Macro events', () => {
    const configuration = {
      type: 'multiple' as const,
      triggers: [
        {
          type: 'cron' as const,
          schedule: '0 30 9 * * *',
          timezone: 'America/New_York',
        },
        {
          type: 'cron' as const,
          schedule: '0 45 17 * * 2,6',
          timezone: 'Europe/London',
        },
        {
          type: 'events' as const,
          filters: [
            {
              events: ['channel.message_posted' as const],
              ids: ['01912345-1234-7123-8123-123456789abc'],
            },
          ],
        },
      ],
    };
    const triggers = parseRoutineTriggers(configuration)!;
    expect(triggers).toMatchObject([
      { kind: 'schedule', frequency: 'day', time: '09:30' },
      {
        kind: 'schedule',
        frequency: 'week',
        time: '17:45',
        daysOfWeek: ['2', '6'],
      },
      { kind: 'event', events: ['channel.message_posted'] },
    ]);
    expect(serializeTriggers(triggers)).toEqual(configuration);
    expect(validateTriggers(triggers)).toBeNull();
  });
  it.each([
    '15 */5 1-3 * JUN MON-FRI',
    '0 0 9 * * * 2040',
    '0 0 9 12 11 3 2040',
  ])('retains an arbitrary cron expression exactly: %s', (schedule) => {
    const config = { type: 'cron' as const, schedule, timezone: 'UTC' };
    const triggers = parseRoutineTriggers(config)!;
    expect(triggers[0]).toMatchObject({ frequency: 'custom' });
    expect(serializeTriggers(triggers)).toEqual(config);
  });
  it('restores a one-off instant as an editable local date', () => {
    const config = {
      type: 'cron' as const,
      schedule: '30 15 9 12 11 * 2040',
      timezone: 'UTC',
    };
    const triggers = parseRoutineTriggers(config)!;
    expect(triggers[0]).toMatchObject({ frequency: 'once' });
    expect(serializeTriggers(triggers)).toEqual(config);
  });

  it('preserves the full backend event-filter capacity and empty selectors', () => {
    const configuration = {
      type: 'events' as const,
      filters: Array.from({ length: 32 }, () => ({
        events: ['document.updated' as const],
        ids: [],
      })),
    };
    const triggers = parseRoutineTriggers(configuration)!;
    expect(validateTriggers(triggers)).toBeNull();
    expect(serializeTriggers(triggers)).toEqual(configuration);
    expect(validateTriggers([...triggers, triggers[0]])).toMatch(/32/);
  });
  it('requires valid configuration for every schedule', () => {
    const valid = newScheduleTrigger('day');
    expect(validateTriggers([])).toMatch(/Add a trigger/);
    expect(
      validateTriggers([valid, { ...valid, timezone: 'Invalid/Zone' }])
    ).toMatch(/time zone/);
    expect(
      validateTriggers([{ ...valid, frequency: 'week', daysOfWeek: [] }])
    ).toMatch(/day/);
    expect(
      validateTriggers(
        [{ ...valid, frequency: 'once', onceAt: '2000-01-01T09:00' }],
        true
      )
    ).toMatch(/future/);
    expect(validateTriggers(Array.from({ length: 17 }, () => valid))).toMatch(
      /16/
    );
    expect(
      validateTriggers(
        [
          {
            id: 'event',
            kind: 'event',
            events: ['channel.message_posted'],
            ids: [],
          },
        ],
        true
      )
    ).toMatch(/Choose at least one/);
  });
});

describe('trigger conditions', () => {
  it('round trips a condition with its filter', () => {
    const config = {
      type: 'events' as const,
      filters: [
        {
          events: ['email.message_received' as const],
          condition: 'Is this email an invoice?',
        },
      ],
    };
    const triggers = parseRoutineTriggers(config)!;
    expect(triggers[0]).toMatchObject({
      kind: 'event',
      condition: 'Is this email an invoice?',
    });
    expect(routineTriggerSchema.safeParse(triggers[0]).success).toBe(true);
    expect(serializeTriggers(triggers)).toEqual(config);
  });

  it('trims conditions and drops blank ones', () => {
    const trigger = {
      id: 'trigger',
      kind: 'event' as const,
      events: ['task.created' as const],
    };
    expect(
      serializeTriggers([{ ...trigger, condition: '  Is it a bug?  ' }])
    ).toEqual({
      type: 'events',
      filters: [{ events: ['task.created'], condition: 'Is it a bug?' }],
    });
    expect(serializeTriggers([{ ...trigger, condition: '   ' }])).toEqual({
      type: 'events',
      filters: [{ events: ['task.created'] }],
    });
  });

  it('rejects conditions longer than the backend accepts', () => {
    const trigger = {
      id: 'trigger',
      kind: 'event' as const,
      events: ['task.created' as const],
    };
    expect(
      validateTriggers([{ ...trigger, condition: 'é'.repeat(500) }])
    ).toBeNull();
    expect(
      validateTriggers([{ ...trigger, condition: 'é'.repeat(501) }])
    ).toMatch(/500 characters/);
  });
});

describe('completed routine classification', () => {
  it('recognizes exhausted multiple and custom schedules, but not Macro events', async () => {
    const { hasOnlyScheduledTriggers } = await import(
      '../core/routine-triggers'
    );
    expect(
      hasOnlyScheduledTriggers([
        newScheduleTrigger('once'),
        newScheduleTrigger('once'),
      ])
    ).toBe(true);
    expect(hasOnlyScheduledTriggers([newScheduleTrigger('custom')])).toBe(true);
    expect(
      hasOnlyScheduledTriggers([
        newScheduleTrigger('once'),
        { kind: 'event', id: 'event', events: ['document.created'] },
      ])
    ).toBe(false);
    expect(hasOnlyScheduledTriggers([])).toBe(false);
  });
});
