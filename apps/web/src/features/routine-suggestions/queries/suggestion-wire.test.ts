import { describe, expect, it } from 'vitest';
import { serializeTriggers } from '../../routines/queries/routine-trigger-mapping';
import { toRoutineSuggestions, type WireSuggestion } from './suggestion-wire';

function wire(overrides: Partial<WireSuggestion>): WireSuggestion {
  return {
    surface: 'email',
    title: 'Tag invoices',
    summary: 'Labels invoices as they arrive.',
    reason: 'You get invoices from Acme weekly',
    instructions: 'Label every invoice from Acme as Finance.',
    icon: 'tag',
    keepProbability: 0.5,
    affectsOthers: false,
    notify: false,
    trigger: {
      kind: 'event',
      event: 'email.message_received',
      condition: 'Is this email an invoice?',
    },
    ...overrides,
  };
}

describe('toRoutineSuggestions', () => {
  it('turns event and schedule suggestions into routine triggers', () => {
    const [event, weekly, daily, monthly, hourly] = toRoutineSuggestions(
      [
        wire({}),
        wire({
          surface: 'calendar',
          title: 'Morning brief',
          trigger: {
            kind: 'schedule',
            schedule: {
              frequency: 'week',
              time: '08:30',
              weekdays: ['mon', 'fri'],
            },
          },
        }),
        wire({
          surface: 'chat',
          title: 'Channel digest',
          trigger: {
            kind: 'schedule',
            schedule: { frequency: 'day', time: '17:00' },
          },
        }),
        wire({
          surface: 'crm',
          title: 'Pipeline audit',
          trigger: {
            kind: 'schedule',
            schedule: { frequency: 'month', time: '09:00', dayOfMonth: 2 },
          },
        }),
        wire({
          surface: 'agents',
          title: 'Watch the queue',
          trigger: { kind: 'schedule', schedule: { frequency: 'hour' } },
        }),
      ],
      'America/New_York'
    );
    expect(serializeTriggers([event.trigger])).toEqual({
      type: 'events',
      filters: [
        {
          events: ['email.message_received'],
          condition: 'Is this email an invoice?',
        },
      ],
    });
    expect(event.when).toBe('When a new email arrives');
    expect(serializeTriggers([weekly.trigger])).toEqual({
      type: 'cron',
      schedule: '0 30 8 * * 2,6',
      timezone: 'America/New_York',
    });
    expect(serializeTriggers([daily.trigger])).toEqual({
      type: 'cron',
      schedule: '0 0 17 * * 1,2,3,4,5,6,7',
      timezone: 'America/New_York',
    });
    expect(serializeTriggers([monthly.trigger])).toEqual({
      type: 'cron',
      schedule: '0 0 9 2 * *',
      timezone: 'America/New_York',
    });
    expect(hourly.when).toBe('Every hour');
    expect(hourly.trigger).toMatchObject({
      kind: 'schedule',
      frequency: 'hour',
      timezone: 'America/New_York',
    });
  });

  it('keys each suggestion by surface and title', () => {
    const [email, tasks] = toRoutineSuggestions(
      [wire({}), wire({ surface: 'tasks', title: 'Tag Invoices' })],
      'UTC'
    );
    expect(email.id).toBe('["email","tag invoices"]');
    expect(tasks.id).toBe('["tasks","tag invoices"]');
  });

  it('skips a trigger shape this build does not know', () => {
    const unknown = JSON.parse(
      '{"kind":"webhook","url":"https://example.com"}'
    ) as WireSuggestion['trigger'];
    const decoded = toRoutineSuggestions(
      [wire({ title: 'From a newer server', trigger: unknown }), wire({})],
      'UTC'
    );
    expect(decoded.map((suggestion) => suggestion.title)).toEqual([
      'Tag invoices',
    ]);
  });
});
