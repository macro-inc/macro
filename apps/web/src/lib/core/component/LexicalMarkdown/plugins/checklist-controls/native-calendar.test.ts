import { describe, expect, it } from 'vitest';
import { observeChecklistCalendar } from './native-calendar';

describe('native checklist raw calendar observations', () => {
  it('preserves actual instants and local fields without mutating or bucketing', () => {
    const today = new Date(2030, 4, 14, 12, 34, 56, 789);
    const before = today.getTime();
    const due = new Date(2030, 4, 15, 9).toISOString();
    const result = observeChecklistCalendar(today, [due, due, 'not-a-date']);
    const midnight = new Date(before);
    midnight.setHours(0, 0, 0, 0);
    expect(today.getTime()).toBe(before);
    expect(result.today).toEqual({
      instantMs: before,
      local: {
        year: 2030,
        month: 5,
        day: 14,
        hour: 12,
        minute: 34,
        second: 56,
        millisecond: 789,
      },
      startOfDay: {
        kind: 'valid',
        instantMs: midnight.getTime(),
        local: {
          year: 2030,
          month: 5,
          day: 14,
          hour: 0,
          minute: 0,
          second: 0,
          millisecond: 0,
        },
      },
    });
    expect(Object.keys(result.dueDates)).toEqual([due, 'not-a-date']);
    expect(result.dueDates['not-a-date']).toEqual({ kind: 'invalid' });
    expect(result.dueDates[due]).toMatchObject({
      kind: 'valid',
      observation: { instantMs: new Date(due).getTime() },
    });
  });

  it('retains full TimeClip endpoints and refuses an invalid current date', () => {
    const min = new Date(-8640000000000000);
    const max = new Date(8640000000000000);
    const result = observeChecklistCalendar(min, [
      min.toISOString(),
      max.toISOString(),
    ]);
    expect(result.today.instantMs).toBe(-8640000000000000);
    expect(result.dueDates[max.toISOString()]).toMatchObject({
      kind: 'valid',
      observation: { instantMs: 8640000000000000 },
    });
    expect(() => observeChecklistCalendar(new Date(NaN), [])).toThrow(
      'Invalid checklist host date'
    );
  });
});
