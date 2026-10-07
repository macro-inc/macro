import { describe, expect, it } from 'vitest';
import {
  formatReminderInstant,
  reminderQuickPresets,
} from './reminder-schedule';

describe('reminderQuickPresets', () => {
  it('shows actual common times and hides Later today after 5pm', () => {
    const morning = reminderQuickPresets(new Date(2026, 8, 21, 10, 12, 45));

    expect(morning.map((preset) => preset.id)).toEqual([
      'in-30-minutes',
      'later-today',
      'tomorrow-morning',
      'next-week',
    ]);
    expect(morning[0]?.date).toEqual(new Date(2026, 8, 21, 10, 42, 45));
    expect(morning[1]?.date).toEqual(new Date(2026, 8, 21, 17));
    expect(morning[2]?.date).toEqual(new Date(2026, 8, 22, 9));
    expect(morning[3]?.date).toEqual(new Date(2026, 8, 28, 9));

    expect(
      reminderQuickPresets(new Date(2026, 8, 21, 17, 1)).map(
        (preset) => preset.id
      )
    ).not.toContain('later-today');
  });

  it('makes Next week the following Monday when opened on Monday', () => {
    const presets = reminderQuickPresets(new Date(2026, 8, 21, 10));
    expect(presets.find((preset) => preset.id === 'next-week')?.date).toEqual(
      new Date(2026, 8, 28, 9)
    );
  });

  it('adds 30 elapsed minutes across the daylight-saving fall-back hour', () => {
    const beforeFallback = new Date('2026-11-01T01:45:00-04:00');
    const inThirty = reminderQuickPresets(beforeFallback)[0]?.date;
    if (!inThirty) throw new Error('Expected In 30m preset');

    expect(inThirty.getTime() - beforeFallback.getTime()).toBe(30 * 60 * 1000);
    expect(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(inThirty)
    ).toBe('1:15 AM EST');
  });
});

describe('formatReminderInstant', () => {
  it('includes an exact date and time without repeating the local timezone', () => {
    const described = formatReminderInstant(
      new Date('2026-09-22T09:00:00.000Z'),
      'UTC'
    );

    expect(described).not.toContain('Tomorrow');
    expect(described).toContain('Sep 22');
    expect(described).toMatch(/9:00\sAM/);
    expect(described).not.toContain('(UTC)');
  });
});
