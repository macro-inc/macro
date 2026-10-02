import type { ReminderEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { reminderScheduleLabel, reminderScheduleState } from './row-schedule';

const now = Date.parse('2026-10-01T12:00:00Z');
const reminder: ReminderEntity = {
  type: 'reminder',
  id: 'test',
  name: 'Review',
  description: 'Review',
  ownerId: '',
  enabled: true,
  scheduleType: 'once',
  nextRunAt: '2026-10-02T13:00:00Z',
};

describe('independent reminder occurrence and schedule state', () => {
  it.each([
    [{}, 'scheduled'],
    [{ nextRunAt: '2026-10-01T12:00:00Z' }, 'due'],
    [{ enabled: false }, 'paused'],
    [{ enabled: false, nextRunAt: '2026-10-01T11:00:00Z' }, 'due'],
    [
      {
        scheduleType: 'recurring',
        enabled: false,
        nextRunAt: '2026-10-01T11:00:00Z',
      },
      'paused',
    ],
    [{ completedAt: '2026-10-01T11:00:00Z' }, 'completed'],
    [
      { scheduleType: 'recurring', completedAt: '2026-10-01T11:00:00Z' },
      'scheduled',
    ],
    [
      {
        scheduleType: 'recurring',
        enabled: false,
        completedAt: '2026-10-01T11:00:00Z',
      },
      'completed',
    ],
  ] as const)('represents %j as %s', (patch, state) => {
    expect(reminderScheduleState({ ...reminder, ...patch }, now)).toBe(state);
  });

  it('labels a disabled past recurring occurrence as paused', () => {
    expect(
      reminderScheduleLabel(
        {
          ...reminder,
          scheduleType: 'recurring',
          enabled: false,
          nextRunAt: '2026-10-01T11:00:00Z',
          cron: '0 0 9 * * *',
        },
        now,
        'UTC'
      )
    ).toBe('Paused: Oct 1, 2026 at 11:00 AM · Repeats daily');
  });

  it('shows a compact date, one foreign zone and a readable recurrence', () => {
    const label = reminderScheduleLabel(
      {
        ...reminder,
        scheduleType: 'recurring',
        cron: '0 0 9 * * MON-FRI',
        timezone: 'America/New_York',
      },
      now,
      'UTC'
    );
    expect(label).not.toContain('Friday');
    expect(label).toContain('Oct 2');
    expect(label).toContain('2026');
    expect(label).toContain('9:00');
    expect(label).toContain('EDT');
    expect(label).not.toContain('America/New_York');
    expect(label).toContain('Repeats on weekdays');
    expect(label.match(/9:00/g)).toHaveLength(1);
    expect(label).toContain(' · ');
  });

  it('does not mislabel an unsupported monthly rule as weekdays', () => {
    const label = reminderScheduleLabel(
      {
        ...reminder,
        scheduleType: 'recurring',
        cron: '0 0 9 1,15 * *',
        timezone: 'America/New_York',
      },
      now
    );
    expect(label).toContain('Repeats monthly on the 1st and 15th');
    expect(label).not.toContain('0 0 9 1,15 * *');
    expect(label).not.toContain('Weekdays');
  });
});

it('omits the zone for a local schedule and retains a different year', () => {
  const label = reminderScheduleLabel(
    { ...reminder, nextRunAt: '2027-10-02T13:00:00Z', timezone: 'UTC' },
    now,
    'UTC'
  );
  expect(label).toContain('2027');
  expect(label).not.toContain('UTC');
});
