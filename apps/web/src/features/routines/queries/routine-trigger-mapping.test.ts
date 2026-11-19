import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@property/identifiers';
import { describe, expect, it } from 'vitest';
import {
  eventTriggerLabel,
  newScheduleTrigger,
  routineEvents,
  routineTriggerSchema,
  taskTriggerProperty,
  validateTriggers,
  withPropertyValues,
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
    const config = { type: 'once' as const, at: '2040-11-12T09:15:30.000Z' };
    const triggers = parseRoutineTriggers(config)!;
    expect(triggers[0]).toMatchObject({ frequency: 'once' });
    expect(serializeTriggers(triggers)).toEqual(config);
    // One-offs saved before the once trigger existed keep their instant.
    const legacy = parseRoutineTriggers({
      type: 'cron',
      schedule: '30 15 9 12 11 * 2040',
      timezone: 'UTC',
    })!;
    expect(serializeTriggers(legacy)).toEqual(config);
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

describe('call triggers', () => {
  it('fire on every call the owner starts or joins, without choosing items', async () => {
    const { callEventScopeLabel, eventScopeKind, isGlobalEvent } = await import(
      '../core/routine-triggers'
    );
    for (const event of ['call.started', 'call.ended'] as const) {
      const trigger = {
        id: 'call',
        kind: 'event' as const,
        events: [event],
      };
      expect(isGlobalEvent(trigger.events)).toBe(true);
      expect(eventScopeKind(trigger)).toBe('CALL_RECORD');
      expect(validateTriggers([trigger], true)).toBeNull();
      expect(serializeTriggers([trigger])).toEqual({
        type: 'events',
        filters: [{ events: [event] }],
      });
    }
    expect(callEventScopeLabel(['call.started'])).toBe('Calls you start');
    expect(callEventScopeLabel(['call.ended'])).toBe('Calls you join');
    expect(callEventScopeLabel(['call.started', 'call.ended'])).toBe(
      'Your calls'
    );
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

describe('GitHub triggers', () => {
  const workflowFailed = routineEvents.find(
    (event) => event.label === 'Workflow failed'
  )!;

  it('sends a GitHub preset as its selector and typed payload tests', () => {
    const trigger = {
      id: 'g',
      kind: 'event' as const,
      events: [workflowFailed.value],
      ...structuredClone(workflowFailed.preset),
    };
    trigger.github!.repositories = ['macro-inc/macro'];
    trigger.match!.push(
      { path: 'workflow_run.name', op: 'equals', value: 'CI' },
      { path: 'workflow_run.run_attempt', op: 'equals', value: '1' },
      { path: 'workflow_run.head_branch', op: 'glob', value: 'release/*' },
      { path: 'workflow_run.pull_requests', op: 'exists', value: '' }
    );

    const serialized = serializeTriggers([trigger]);

    expect(serialized).toEqual({
      type: 'events',
      filters: [
        {
          events: ['github'],
          github: {
            events: ['workflow_run'],
            actions: ['completed'],
            repositories: ['macro-inc/macro'],
            includeBots: false,
          },
          match: [
            {
              path: ['workflow_run', 'conclusion'],
              in: ['failure', 'timed_out'],
            },
            { path: ['workflow_run', 'name'], equals: 'CI' },
            { path: ['workflow_run', 'run_attempt'], equals: 1 },
            { path: ['workflow_run', 'head_branch'], glob: 'release/*' },
            { path: ['workflow_run', 'pull_requests'], exists: true },
          ],
        },
      ],
    });
    expect(parseRoutineTriggers(serialized)).toEqual([
      {
        ...trigger,
        id: expect.any(String),
        ids: undefined,
        condition: undefined,
      },
    ]);
  });

  it('labels a GitHub trigger by its preset until its events change', () => {
    const trigger = {
      id: 'g',
      kind: 'event' as const,
      events: [workflowFailed.value],
      ...structuredClone(workflowFailed.preset),
    };
    expect(eventTriggerLabel(trigger)).toBe('Workflow failed');
    trigger.github!.events = ['check_suite'];
    expect(eventTriggerLabel(trigger)).toBe('GitHub check_suite');
  });

  it('rejects names GitHub never sends and incomplete payload tests', () => {
    const github = (patch: object) => [
      {
        id: 'g',
        kind: 'event' as const,
        events: ['github' as const],
        github: {
          events: [],
          actions: [],
          repositories: [],
          includeBots: false,
          ...patch,
        },
      },
    ];
    expect(validateTriggers(github({}))).toBeNull();
    expect(validateTriggers(github({ events: ['Workflow Run'] }))).toMatch(
      /lowercase/
    );
    expect(validateTriggers(github({ repositories: ['macro'] }))).toMatch(
      /owner\/name/
    );
    expect(
      validateTriggers([
        {
          id: 'w',
          kind: 'event',
          events: ['github'],
          match: [{ path: 'status', op: 'equals', value: ' ' }],
        },
      ])
    ).toMatch(/value/);
    expect(
      validateTriggers([
        {
          id: 'w',
          kind: 'event',
          events: ['github'],
          match: [{ path: 'alert..severity', op: 'exists', value: '' }],
        },
      ])
    ).toMatch(/dots/);
  });
});

describe('task property selectors', () => {
  const STATUS = SYSTEM_PROPERTY_IDS.STATUS;
  const COMPLETED = PROPERTY_OPTION_IDS.STATUS.COMPLETED;

  it('round trips a value test and keeps its event’s label', () => {
    const config = {
      type: 'events' as const,
      filters: [
        {
          events: ['task.status_changed' as const],
          property: { definitionId: STATUS, values: [COMPLETED] },
        },
      ],
    };
    const [trigger] = parseRoutineTriggers(config)!;
    expect(routineTriggerSchema.safeParse(trigger).success).toBe(true);
    expect(serializeTriggers([trigger])).toEqual(config);
    expect(trigger.kind === 'event' && eventTriggerLabel(trigger)).toBe(
      'Status changed'
    );
  });

  it('names a preset property apart from any property', () => {
    const preset = routineEvents.find(
      (item) => item.label === 'Assignees changed'
    )!;
    const base = {
      id: 'trigger',
      kind: 'event' as const,
      events: [preset.value],
    };
    expect(eventTriggerLabel({ ...base, ...preset.preset })).toBe(
      'Assignees changed'
    );
    expect(eventTriggerLabel(base)).toBe('Any property changed');
    expect(
      eventTriggerLabel({
        ...base,
        property: {
          definitionId: '00000002-0000-7000-8000-000000000001',
          values: [],
        },
      })
    ).toBe('Property changed');
  });

  it('keeps a status event’s wire shape until a value is chosen', () => {
    const trigger = {
      id: 'trigger',
      kind: 'event' as const,
      events: ['task.status_changed' as const],
    };
    const chosen = withPropertyValues(trigger, STATUS, [COMPLETED]);
    expect(chosen.property).toEqual({
      definitionId: STATUS,
      values: [COMPLETED],
    });
    expect(withPropertyValues(chosen, STATUS, []).property).toBeUndefined();
    expect(taskTriggerProperty(chosen)?.kind).toBe('options');
  });

  it('keeps a preset property when its values are cleared', () => {
    const trigger = {
      id: 'trigger',
      kind: 'event' as const,
      events: ['task.property_changed' as const],
    };
    expect(
      withPropertyValues(trigger, SYSTEM_PROPERTY_IDS.ASSIGNEES, []).property
    ).toEqual({ definitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES, values: [] });
    expect(taskTriggerProperty(trigger)).toBeUndefined();
  });
});

describe('webhook triggers', () => {
  it('sends a webhook trigger with its JSON body tests and reads it back', () => {
    const trigger = {
      id: 'w',
      kind: 'event' as const,
      events: ['webhook' as const],
      match: [{ path: 'status', op: 'equals' as const, value: 'failed' }],
      condition: 'Is this alert about production?',
    };

    const serialized = serializeTriggers([trigger]);

    expect(serialized).toEqual({
      type: 'events',
      filters: [
        {
          events: ['webhook'],
          match: [{ path: ['status'], equals: 'failed' }],
          condition: 'Is this alert about production?',
        },
      ],
    });
    expect(parseRoutineTriggers(serialized)).toEqual([
      {
        ...trigger,
        id: expect.any(String),
        ids: undefined,
        github: undefined,
        property: undefined,
      },
    ]);
    expect(eventTriggerLabel(trigger)).toBe('Webhook received');
    expect(validateTriggers([trigger], true)).toBeNull();
  });
});
