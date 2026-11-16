import { describe, expect, it } from 'vitest';
import { calendarPeriodParams } from './calendar-url';

describe('calendar route period input', () => {
  it('accepts Agenda without changing existing grid routes', () => {
    expect(calendarPeriodParams.parse({ period: 'agenda' })).toEqual({
      period: 'agenda',
    });
    expect(calendarPeriodParams.parse({ period: 'week' })).toEqual({
      period: 'timeGridWeek',
    });
    expect(
      calendarPeriodParams.safeParse({ period: 'agenda-v2' }).success
    ).toBe(false);
  });
});
