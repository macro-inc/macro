import { describe, expect, it } from 'vitest';
import { formatClockRange, formatClockTime } from './clock-format';

describe('clock display', () => {
  it('pads 24-hour times and uses zero for midnight', () => {
    expect(formatClockTime(new Date(2030, 0, 1, 0, 0), '24-hour')).toBe(
      '00:00'
    );
    expect(formatClockTime(new Date(2030, 0, 1, 9, 5), '24-hour')).toBe(
      '09:05'
    );
    expect(formatClockTime(new Date(2030, 0, 1, 15, 30), '24-hour')).toBe(
      '15:30'
    );
  });

  it('compacts whole hours without dropping nonzero minutes', () => {
    expect(formatClockTime(new Date(2030, 0, 1, 14, 0), '12-hour', true)).toBe(
      '2pm'
    );
    expect(formatClockTime(new Date(2030, 0, 1, 11, 30), '12-hour', true)).toBe(
      '11:30am'
    );
    expect(formatClockTime(new Date(2030, 0, 1, 14, 0), '12-hour')).toBe(
      '2:00pm'
    );
  });

  it('omits only a shared meridiem and preserves noon and midnight crossings', () => {
    expect(
      formatClockRange(
        new Date(2030, 0, 1, 11),
        new Date(2030, 0, 1, 11, 45),
        '12-hour'
      )
    ).toBe('11 – 11:45am');
    expect(
      formatClockRange(
        new Date(2030, 0, 1, 11, 30),
        new Date(2030, 0, 1, 12, 30),
        '12-hour'
      )
    ).toBe('11:30am – 12:30pm');
    expect(
      formatClockRange(
        new Date(2030, 0, 1, 22),
        new Date(2030, 0, 2, 1),
        '12-hour'
      )
    ).toBe('10pm – 1am');
    expect(
      formatClockRange(
        new Date(2030, 0, 1, 9, 30),
        new Date(2030, 0, 1, 10),
        '24-hour'
      )
    ).toBe('09:30 – 10:00');
  });

  it('keeps locale formatting when no explicit preference is supplied', () => {
    const date = new Date(2030, 0, 1, 15, 30);
    expect(formatClockTime(date)).toBe(
      new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(date)
    );
  });
});
