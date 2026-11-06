import { describe, expect, it } from 'vitest';
import type { HistoryRun } from './history';
import { describeRunStart, runItem, runStartLine } from './run-start';

const person = (id: string) => (id === 'macro|me' ? 'you' : 'Dana');
const time = (iso: string) => iso.slice(11, 16);

describe('what started a run', () => {
  it('names the schedule with its zone, the event, or who ran it', () => {
    expect(
      describeRunStart(
        {
          kind: 'schedule',
          schedule: '0 0 9 * * *',
          timezone: 'Europe/Paris',
        },
        person
      )
    ).toBe('Every day at 9:00 AM (Europe/Paris)');
    expect(
      describeRunStart(
        { kind: 'schedule', schedule: '0 15 10 1 3 * 2027', timezone: 'UTC' },
        person
      )
    ).toBe('On its schedule (UTC)');
    expect(
      describeRunStart(
        { kind: 'event', event: 'email.message_received', entityId: 't' },
        person
      )
    ).toBe('New email received');
    expect(describeRunStart({ kind: 'manual', by: 'macro|me' }, person)).toBe(
      'Run by you'
    );
  });

  it('says since when, and when it counts as happening only when it started late', () => {
    const scheduled: HistoryRun = {
      at: '2026-11-01T09:00:00Z',
      start: { kind: 'schedule', schedule: '0 0 9 * * *', timezone: 'UTC' },
      previousAt: '2026-10-31T09:00:00Z',
    };
    expect(runStartLine(scheduled, '2026-11-01T09:00:02Z', person, time)).toBe(
      'Every day at 9:00 AM (UTC) · since 09:00'
    );
    expect(
      runStartLine(
        { ...scheduled, previousAt: undefined },
        '2026-11-01T09:20:00Z',
        person,
        time
      )
    ).toBe('Every day at 9:00 AM (UTC) · due 09:00 · first run');
  });

  it('opens the item of an email, channel or task event', () => {
    expect(
      runItem({ kind: 'event', event: 'email.message_received', entityId: 't' })
    ).toEqual({ block: 'email', id: 't' });
    expect(
      runItem({ kind: 'event', event: 'task.status_changed', entityId: 'd' })
    ).toEqual({ block: 'task', id: 'd' });
    expect(
      runItem({ kind: 'event', event: 'document.created', entityId: 'd' })
    ).toBeUndefined();
    expect(runItem({ kind: 'event', event: 'channel.mentioned' })).toBe(
      undefined
    );
    expect(runItem({ kind: 'manual', by: 'macro|me' })).toBeUndefined();
  });
});
