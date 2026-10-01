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

  it('exposes the full date, time zone and recurring rule', () => {
    const label = reminderScheduleLabel(
      {
        ...reminder,
        scheduleType: 'recurring',
        cron: '0 0 9 * * MON-FRI',
        timezone: 'America/New_York',
      },
      now
    );
    expect(label).toContain('Friday');
    expect(label).toContain('October');
    expect(label).toContain('2026');
    expect(label).toContain('9:00');
    expect(label).toContain('America/New_York');
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
    expect(label).toContain('Custom repeat: 0 0 9 1,15 * *');
    expect(label).not.toContain('Weekdays');
  });
});
