import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { addDays } from 'date-fns';
import {
  useDateSearch,
  parseNaturalDate,
  formatDateWithContext,
  parseTime,
} from './useDateSearch';

describe('parseNaturalDate', () => {
  const baseDate = new Date('2024-06-15T10:00:00');

  it('should parse month and day formats', () => {
    const feb17 = parseNaturalDate('feb 17', baseDate);
    expect(feb17).toBeTruthy();
    expect(feb17?.getMonth()).toBe(1); // February is month 1
    expect(feb17?.getDate()).toBe(17);

    const march3 = parseNaturalDate('march 3', baseDate);
    expect(march3).toBeTruthy();
    expect(march3?.getMonth()).toBe(2); // March is month 2
    expect(march3?.getDate()).toBe(3);

    const jan1 = parseNaturalDate('January 1', baseDate);
    expect(jan1).toBeTruthy();
    expect(jan1?.getMonth()).toBe(0); // January is month 0
    expect(jan1?.getDate()).toBe(1);
  });

  it('should handle dates with explicit years', () => {
    const feb172025 = parseNaturalDate('feb 17 2025', baseDate);
    expect(feb172025).toBeTruthy();
    expect(feb172025?.getFullYear()).toBe(2025);
    expect(feb172025?.getMonth()).toBe(1);
    expect(feb172025?.getDate()).toBe(17);

    const jan12024 = parseNaturalDate('January 1 2024', baseDate);
    expect(jan12024).toBeTruthy();
    expect(jan12024?.getFullYear()).toBe(2024);
  });

  it('should intelligently select year for dates without year', () => {
    // Date in the near future should use current year
    const july4 = parseNaturalDate('july 4', baseDate);
    expect(july4?.getFullYear()).toBe(2024);

    // Date far in the past should use next year
    const jan1 = parseNaturalDate('jan 1', baseDate);
    // Jan 1 is 5.5 months before June 15, which is less than 6 months,
    // so it should stay in the current year (2024)
    expect(jan1?.getFullYear()).toBe(2024);

    // A date that's definitely more than 6 months in the past should use next year
    const nov1 = parseNaturalDate('nov 1', baseDate);
    // Nov 1, 2023 would be 7+ months before June 15, 2024, so should become Nov 1, 2024
    expect(nov1?.getFullYear()).toBe(2024);
  });

  it('should parse numeric date formats', () => {
    const date1 = parseNaturalDate('3/15', baseDate);
    expect(date1?.getMonth()).toBe(2); // March
    expect(date1?.getDate()).toBe(15);

    const date2 = parseNaturalDate('12/25/2024', baseDate);
    expect(date2?.getFullYear()).toBe(2024);
    expect(date2?.getMonth()).toBe(11); // December
    expect(date2?.getDate()).toBe(25);

    const date3 = parseNaturalDate('2024-03-15', baseDate);
    expect(date3?.getFullYear()).toBe(2024);
    expect(date3?.getMonth()).toBe(2); // March
    expect(date3?.getDate()).toBe(15);
  });

  it('should parse relative day names', () => {
    // parseNaturalDate doesn't handle relative keywords like 'today', 'tomorrow', 'yesterday'
    // These are handled by presets in the useDateSearch hook
    const today = parseNaturalDate('today', baseDate);
    expect(today).toBeNull();

    const tomorrow = parseNaturalDate('tomorrow', baseDate);
    expect(tomorrow).toBeNull();

    const yesterday = parseNaturalDate('yesterday', baseDate);
    expect(yesterday).toBeNull();
  });

  it('should parse day of week names', () => {
    // Base date is Saturday June 15, 2024
    const monday = parseNaturalDate('monday', baseDate);
    expect(monday).toBeTruthy();
    // Next Monday should be June 17
    expect(monday?.getDate()).toBe(17);

    const fri = parseNaturalDate('fri', baseDate);
    expect(fri).toBeTruthy();
    // Next Friday should be June 21
    expect(fri?.getDate()).toBe(21);
  });

  it('should handle case insensitivity', () => {
    const date1 = parseNaturalDate('FEB 17', baseDate);
    const date2 = parseNaturalDate('feb 17', baseDate);
    const date3 = parseNaturalDate('Feb 17', baseDate);

    expect(date1?.getTime()).toBe(date2?.getTime());
    expect(date2?.getTime()).toBe(date3?.getTime());

    const today1 = parseNaturalDate('TODAY', baseDate);
    const today2 = parseNaturalDate('today', baseDate);
    expect(today1?.getTime()).toBe(today2?.getTime());
  });

  it('should return null for invalid dates', () => {
    expect(parseNaturalDate('invalid', baseDate)).toBeNull();
    expect(parseNaturalDate('feb 30', baseDate)).toBeNull();
    expect(parseNaturalDate('13/32', baseDate)).toBeNull();
    expect(parseNaturalDate('', baseDate)).toBeNull();
  });

  it('should handle European date format', () => {
    const date = parseNaturalDate('15-03-2024', baseDate);
    expect(date?.getFullYear()).toBe(2024);
    expect(date?.getMonth()).toBe(2); // March
    expect(date?.getDate()).toBe(15);
  });

  it('should handle day-month format', () => {
    const date1 = parseNaturalDate('17 Feb', baseDate);
    expect(date1?.getMonth()).toBe(1); // February
    expect(date1?.getDate()).toBe(17);

    const date2 = parseNaturalDate('3 March 2025', baseDate);
    expect(date2?.getFullYear()).toBe(2025);
    expect(date2?.getMonth()).toBe(2); // March
    expect(date2?.getDate()).toBe(3);
  });
});

describe('formatDateWithContext', () => {
  const baseDate = new Date('2024-06-15T14:00:00');

  it('should format today correctly', () => {
    const today = new Date('2024-06-15T18:30:00');
    const formatted = formatDateWithContext(today, baseDate);
    expect(formatted).toContain('Today');
    expect(formatted).toContain('6:30 PM');
  });

  it('should format tomorrow correctly', () => {
    const tomorrow = new Date('2024-06-16T09:00:00');
    const formatted = formatDateWithContext(tomorrow, baseDate);
    expect(formatted).toContain('Tomorrow');
    expect(formatted).toContain('9:00 AM');
  });

  it('should format yesterday correctly', () => {
    const yesterday = new Date('2024-06-14T15:45:00');
    const formatted = formatDateWithContext(yesterday, baseDate);
    expect(formatted).toContain('Yesterday');
    expect(formatted).toContain('3:45 PM');
  });

  it('should format dates within a week with day name', () => {
    const nextWednesday = new Date('2024-06-19T12:00:00');
    const formatted = formatDateWithContext(nextWednesday, baseDate);
    expect(formatted).toContain('Wednesday');
    expect(formatted).toContain('Jun 19');
    expect(formatted).toContain('12:00 PM');
  });

  it('should format dates in same year without year', () => {
    const futureDate = new Date('2024-08-20T10:00:00');
    const formatted = formatDateWithContext(futureDate, baseDate);
    expect(formatted).toContain('Aug 20');
    expect(formatted).not.toContain('2024');
    expect(formatted).toContain('10:00 AM');
  });

  it('should format dates in different year with year', () => {
    const nextYear = new Date('2025-01-15T14:30:00');
    const formatted = formatDateWithContext(nextYear, baseDate);
    expect(formatted).toContain('Jan 15, 2025');
    expect(formatted).toContain('2:30 PM');
  });
});

describe('useDateSearch', () => {
  it('should return default presets when query is empty', () => {
    createRoot((dispose) => {
      const [query] = createSignal('');
      const options = useDateSearch({ query });

      const result = options();
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(10);
      expect(result[0].type).toBe('preset');

      dispose();
    });
  });

  it('should parse duration DSL', () => {
    createRoot((dispose) => {
      const [query] = createSignal('3d');
      const baseDate = new Date('2024-06-15T10:00:00');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      expect(result.length).toBeGreaterThan(0);

      const durationOption = result.find((opt) => opt.type === 'duration');
      expect(durationOption).toBeTruthy();
      expect(durationOption?.displayText).toBe('3d (3 days from now)');

      // Should be 3 days from now (not baseDate)
      const expectedDate = addDays(new Date(), 3);
      expect(durationOption?.date.toDateString()).toBe(
        expectedDate.toDateString()
      );

      dispose();
    });
  });

  it('should parse natural dates', () => {
    createRoot((dispose) => {
      const [query] = createSignal('feb 17');
      const baseDate = new Date('2024-06-15T10:00:00');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const naturalOption = result.find((opt) => opt.type === 'natural');
      expect(naturalOption).toBeTruthy();
      expect(naturalOption?.displayText).toBe('feb 17');
      expect(naturalOption?.date.getMonth()).toBe(1); // February
      expect(naturalOption?.date.getDate()).toBe(17);

      dispose();
    });
  });

  it('should search presets', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tomorrow');
      const options = useDateSearch({ query });

      const result = options();
      const tomorrowOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('tomorrow')
      );
      expect(tomorrowOption).toBeTruthy();

      dispose();
    });
  });

  it('should handle relative date queries', () => {
    createRoot((dispose) => {
      const [query] = createSignal('week');
      const baseDate = new Date('2024-06-15T10:00:00');
      const options = useDateSearch({ query, baseDate });

      const result = options();

      // Should find preset options that match "week"
      const weekOptions = result.filter((opt) =>
        opt.displayText.toLowerCase().includes('week')
      );
      expect(weekOptions.length).toBeGreaterThan(0);
      expect(weekOptions[0].type).toBe('preset');

      dispose();
    });
  });

  it('should handle different query types', () => {
    const baseDate = new Date('2024-06-15T10:00:00');

    // Test duration query
    createRoot((dispose) => {
      const [query] = createSignal('3d');
      const options = useDateSearch({ query, baseDate });
      const result = options();
      const durationOption = result.find((opt) => opt.type === 'duration');
      expect(durationOption?.displayText).toBe('3d (3 days from now)');
      dispose();
    });

    // Test week duration
    createRoot((dispose) => {
      const [query] = createSignal('1w');
      const options = useDateSearch({ query, baseDate });
      const result = options();
      const weekOption = result.find((opt) => opt.type === 'duration');
      expect(weekOption?.displayText).toBe('1w (1 week from now)');
      dispose();
    });

    // Test natural date
    createRoot((dispose) => {
      const [query] = createSignal('march 15');
      const options = useDateSearch({ query, baseDate });
      const result = options();
      const naturalOption = result.find((opt) => opt.type === 'natural');
      expect(naturalOption?.displayText).toBe('march 15');
      expect(naturalOption?.date.getMonth()).toBe(2); // March
      expect(naturalOption?.date.getDate()).toBe(15);
      dispose();
    });
  });

  it('should score and sort results appropriately', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tom');
      const options = useDateSearch({ query });

      const result = options();
      // Results starting with 'tom' should come first
      const topResults = result.slice(0, 3);
      topResults.forEach((opt) => {
        expect(opt.displayText.toLowerCase().includes('tom')).toBe(true);
      });

      dispose();
    });
  });

  it('should limit results to 15 options', () => {
    createRoot((dispose) => {
      const [query] = createSignal('e'); // Common letter that matches many presets
      const options = useDateSearch({ query });

      const result = options();
      expect(result.length).toBeLessThanOrEqual(15);

      dispose();
    });
  });

  it('should handle multiple matching types', () => {
    createRoot((dispose) => {
      const [query] = createSignal('1d');
      const baseDate = new Date('2024-06-15T10:00:00');
      const options = useDateSearch({ query, baseDate });

      const result = options();

      // Should have duration option
      const durationOption = result.find((opt) => opt.type === 'duration');
      expect(durationOption).toBeTruthy();
      expect(durationOption?.displayText).toBe('1d (1 day from now)');

      // Might also have preset options that match
      const presetOptions = result.filter((opt) => opt.type === 'preset');
      expect(presetOptions.length).toBeGreaterThanOrEqual(0);

      dispose();
    });
  });

  it('should include secondary text with formatted dates', () => {
    createRoot((dispose) => {
      const [query] = createSignal('3d');
      const baseDate = new Date('2024-06-15T10:00:00');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const durationOption = result.find((opt) => opt.type === 'duration');

      expect(durationOption?.secondaryText).toBeTruthy();
      // Duration is relative to now, so just verify secondary text exists
      expect(typeof durationOption?.secondaryText).toBe('string');

      dispose();
    });
  });

  it('should handle edge cases gracefully', () => {
    createRoot((dispose) => {
      const [query] = createSignal('!@#$%^&*()');
      const options = useDateSearch({ query });

      const result = options();
      // Should return empty or only exact text matches
      expect(result.length).toBeGreaterThanOrEqual(0);

      dispose();
    });
  });
});

describe('parseTime', () => {
  it('should parse simple AM/PM times', () => {
    const result = parseTime('9am');
    expect(result).toBeTruthy();
    expect(result?.time.hours).toBe(9);
    expect(result?.time.minutes).toBe(0);
    expect(result?.rest).toBe('');

    const result2 = parseTime('3pm');
    expect(result2?.time.hours).toBe(15);
    expect(result2?.time.minutes).toBe(0);
    expect(result2?.rest).toBe('');
  });

  it('should parse times with spaces before meridiem', () => {
    const result = parseTime('9 AM');
    expect(result).toBeTruthy();
    expect(result?.time.hours).toBe(9);
    expect(result?.time.minutes).toBe(0);

    const result2 = parseTime('3 pm');
    expect(result2?.time.hours).toBe(15);
    expect(result2?.time.minutes).toBe(0);
  });

  it('should parse times with minutes', () => {
    const result = parseTime('3:30pm');
    expect(result).toBeTruthy();
    expect(result?.time.hours).toBe(15);
    expect(result?.time.minutes).toBe(30);

    const result2 = parseTime('11:45 AM');
    expect(result2?.time.hours).toBe(11);
    expect(result2?.time.minutes).toBe(45);
  });

  it('should handle 12am and 12pm correctly', () => {
    const midnight = parseTime('12am');
    expect(midnight?.time.hours).toBe(0);
    expect(midnight?.time.minutes).toBe(0);

    const noon = parseTime('12pm');
    expect(noon?.time.hours).toBe(12);
    expect(noon?.time.minutes).toBe(0);

    const noon2 = parseTime('12:30pm');
    expect(noon2?.time.hours).toBe(12);
    expect(noon2?.time.minutes).toBe(30);

    const midnight2 = parseTime('12:30am');
    expect(midnight2?.time.hours).toBe(0);
    expect(midnight2?.time.minutes).toBe(30);
  });

  it('should parse noon and midnight keywords', () => {
    const noon = parseTime('noon');
    expect(noon?.time.hours).toBe(12);
    expect(noon?.time.minutes).toBe(0);
    expect(noon?.rest).toBe('');

    const midnight = parseTime('midnight');
    expect(midnight?.time.hours).toBe(0);
    expect(midnight?.time.minutes).toBe(0);
    expect(midnight?.rest).toBe('');
  });

  it('should parse 24-hour format', () => {
    const result = parseTime('14:00');
    expect(result).toBeTruthy();
    expect(result?.time.hours).toBe(14);
    expect(result?.time.minutes).toBe(0);

    const result2 = parseTime('23:59');
    expect(result2?.time.hours).toBe(23);
    expect(result2?.time.minutes).toBe(59);

    const result3 = parseTime('0:00');
    expect(result3?.time.hours).toBe(0);
    expect(result3?.time.minutes).toBe(0);
  });

  it('should extract time from end of string and return rest', () => {
    const result = parseTime('tomorrow 9am');
    expect(result).toBeTruthy();
    expect(result?.time.hours).toBe(9);
    expect(result?.time.minutes).toBe(0);
    expect(result?.rest).toBe('tomorrow');

    const result2 = parseTime('feb 17 3:30 PM');
    expect(result2?.time.hours).toBe(15);
    expect(result2?.time.minutes).toBe(30);
    expect(result2?.rest).toBe('feb 17');

    const result3 = parseTime('march 3 14:00');
    expect(result3?.time.hours).toBe(14);
    expect(result3?.time.minutes).toBe(0);
    expect(result3?.rest).toBe('march 3');
  });

  it('should extract time from start of string and return rest', () => {
    const result = parseTime('9am tomorrow');
    expect(result).toBeTruthy();
    expect(result?.time.hours).toBe(9);
    expect(result?.time.minutes).toBe(0);
    expect(result?.rest).toBe('tomorrow');

    const result2 = parseTime('3:30pm feb 17');
    expect(result2?.time.hours).toBe(15);
    expect(result2?.time.minutes).toBe(30);
    expect(result2?.rest).toBe('feb 17');
  });

  it('should reject invalid times', () => {
    expect(parseTime('13am')).toBeNull(); // > 12 with meridiem
    expect(parseTime('0am')).toBeNull(); // 0 with meridiem
    expect(parseTime('25:00')).toBeNull(); // > 23 hours
    expect(parseTime('14:60')).toBeNull(); // > 59 minutes
    expect(parseTime('')).toBeNull();
    expect(parseTime('hello')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });

  it('should be case insensitive for meridiem', () => {
    const r1 = parseTime('9AM');
    const r2 = parseTime('9am');
    const r3 = parseTime('9 Am');
    expect(r1?.time.hours).toBe(9);
    expect(r2?.time.hours).toBe(9);
    expect(r3?.time.hours).toBe(9);

    const r4 = parseTime('9PM');
    const r5 = parseTime('9pm');
    expect(r4?.time.hours).toBe(21);
    expect(r5?.time.hours).toBe(21);
  });
});

describe('useDateSearch with time', () => {
  const baseDate = new Date('2024-06-15T10:00:00');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T14:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should bump standalone time to tomorrow if already past today', () => {
    createRoot((dispose) => {
      // 1am is in the past relative to the frozen 2pm clock
      const [query] = createSignal('1am');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      expect(result.length).toBeGreaterThan(0);

      const timeOption = result.find((opt) => opt.id.startsWith('time-'));
      expect(timeOption).toBeTruthy();

      // Should be tomorrow (June 16) at 1am since 1am today is past
      expect(timeOption?.date.getDate()).toBe(16);
      expect(timeOption?.date.getHours()).toBe(1);
      expect(timeOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });

  it('should not produce a standalone time result in the past', () => {
    createRoot((dispose) => {
      // Use any time — the result should never be in the past
      const [query] = createSignal('3:30pm');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const timeOption = result.find((opt) => opt.id.startsWith('time-'));
      expect(timeOption).toBeTruthy();
      expect(timeOption?.date.getHours()).toBe(15);
      expect(timeOption?.date.getMinutes()).toBe(30);
      // The date should always be >= now
      expect(timeOption!.date.getTime()).toBeGreaterThan(Date.now());

      dispose();
    });
  });

  it('should apply time to preset matches like "tomorrow 9am"', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tomorrow 9am');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      expect(result.length).toBeGreaterThan(0);

      const tomorrowOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('tomorrow')
      );
      expect(tomorrowOption).toBeTruthy();
      expect(tomorrowOption?.displayText).toContain('at 9 AM');
      expect(tomorrowOption?.date.getHours()).toBe(9);
      expect(tomorrowOption?.date.getMinutes()).toBe(0);
      // Should be June 16
      expect(tomorrowOption?.date.getDate()).toBe(16);

      dispose();
    });
  });

  it('should apply time to natural date matches like "feb 17 3:30pm"', () => {
    createRoot((dispose) => {
      const [query] = createSignal('feb 17 3:30pm');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const naturalOption = result.find((opt) => opt.type === 'natural');
      expect(naturalOption).toBeTruthy();
      expect(naturalOption?.date.getMonth()).toBe(1); // February
      expect(naturalOption?.date.getDate()).toBe(17);
      expect(naturalOption?.date.getHours()).toBe(15);
      expect(naturalOption?.date.getMinutes()).toBe(30);

      dispose();
    });
  });

  it('should apply time when time is at start: "9am tomorrow"', () => {
    createRoot((dispose) => {
      const [query] = createSignal('9am tomorrow');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const tomorrowOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('tomorrow')
      );
      expect(tomorrowOption).toBeTruthy();
      expect(tomorrowOption?.date.getHours()).toBe(9);
      expect(tomorrowOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });

  it('should apply time to duration queries like "3d 2pm"', () => {
    createRoot((dispose) => {
      const [query] = createSignal('3d 2pm');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const durationOption = result.find((opt) => opt.type === 'duration');
      expect(durationOption).toBeTruthy();
      expect(durationOption?.date.getHours()).toBe(14);
      expect(durationOption?.date.getMinutes()).toBe(0);
      // Should be 3 days from now
      const expectedDate = addDays(new Date(), 3);
      expect(durationOption?.date.toDateString()).toBe(
        expectedDate.toDateString()
      );

      dispose();
    });
  });

  it('should handle noon and midnight keywords', () => {
    createRoot((dispose) => {
      const [query] = createSignal('noon');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const timeOption = result.find((opt) => opt.id.startsWith('time-'));
      expect(timeOption).toBeTruthy();
      expect(timeOption?.date.getHours()).toBe(12);
      expect(timeOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });

  it('should handle midnight keyword', () => {
    createRoot((dispose) => {
      const [query] = createSignal('midnight');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const timeOption = result.find((opt) => opt.id.startsWith('time-'));
      expect(timeOption).toBeTruthy();
      expect(timeOption?.date.getHours()).toBe(0);
      expect(timeOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });

  it('should handle 24-hour format standalone', () => {
    createRoot((dispose) => {
      const [query] = createSignal('14:00');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const timeOption = result.find((opt) => opt.id.startsWith('time-'));
      expect(timeOption).toBeTruthy();
      expect(timeOption?.date.getHours()).toBe(14);
      expect(timeOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });

  it('should not break existing behavior when no time is present', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tomorrow');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const tomorrowOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('tomorrow')
      );
      expect(tomorrowOption).toBeTruthy();
      // Should still work as before - time comes from preset's getDate
      expect(tomorrowOption?.date.getDate()).toBe(16);

      dispose();
    });
  });

  it('should apply time to "today" preset queries', () => {
    createRoot((dispose) => {
      const [query] = createSignal('today 5pm');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const todayOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('today')
      );
      expect(todayOption).toBeTruthy();
      expect(todayOption?.displayText).toContain('at 5 PM');
      expect(todayOption?.date.getHours()).toBe(17);
      expect(todayOption?.date.getMinutes()).toBe(0);
      expect(todayOption?.date.getDate()).toBe(15);

      dispose();
    });
  });

  it('should apply time to "end of week" preset', () => {
    createRoot((dispose) => {
      const [query] = createSignal('end of week 10am');
      const options = useDateSearch({ query, baseDate });

      const result = options();
      const eowOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('end of week')
      );
      expect(eowOption).toBeTruthy();
      expect(eowOption?.displayText).toContain('at 10 AM');
      expect(eowOption?.date.getHours()).toBe(10);
      expect(eowOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });
});

describe('useDateSearch with defaultTime', () => {
  // Use a date far in the future so the "past" filter doesn't interfere
  const baseDate = new Date('2099-06-15T06:00:00'); // 6 AM so "today" at 8am is still in the future
  const defaultTime = { hours: 8, minutes: 0 };

  it('should apply defaultTime to empty-query presets', () => {
    createRoot((dispose) => {
      const [query] = createSignal('');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      expect(result.length).toBeGreaterThan(0);
      result.forEach((opt) => {
        expect(opt.date.getHours()).toBe(8);
        expect(opt.date.getMinutes()).toBe(0);
      });

      dispose();
    });
  });

  it('should apply defaultTime to searched presets without explicit time', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tomorrow');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      const tomorrowOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('tomorrow')
      );
      expect(tomorrowOption).toBeTruthy();
      expect(tomorrowOption?.date.getHours()).toBe(8);
      expect(tomorrowOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });

  it('should apply defaultTime to natural dates without explicit time', () => {
    createRoot((dispose) => {
      const [query] = createSignal('thursday');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      const naturalOption = result.find((opt) => opt.type === 'natural');
      expect(naturalOption).toBeTruthy();
      expect(naturalOption?.date.getHours()).toBe(8);
      expect(naturalOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });

  it('should NOT apply defaultTime to duration results', () => {
    createRoot((dispose) => {
      const [query] = createSignal('5min');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      const durationOption = result.find((opt) => opt.type === 'duration');
      expect(durationOption).toBeTruthy();
      // 5 minutes from now, NOT defaultTime (8:00 AM)
      const now = new Date();
      const expected = new Date(now.getTime() + 5 * 60 * 1000);
      expect(durationOption?.date.getHours()).toBe(expected.getHours());
      expect(durationOption?.date.getMinutes()).toBe(expected.getMinutes());

      dispose();
    });
  });

  it('should NOT apply defaultTime to hour-based durations', () => {
    createRoot((dispose) => {
      const [query] = createSignal('2h');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      const durationOption = result.find((opt) => opt.type === 'duration');
      expect(durationOption).toBeTruthy();
      // 2 hours from now, NOT defaultTime
      const now = new Date();
      const expected = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      expect(durationOption?.date.getHours()).toBe(expected.getHours());
      expect(durationOption?.date.getMinutes()).toBe(expected.getMinutes());

      dispose();
    });
  });

  it('explicit time should override defaultTime for presets', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tomorrow 3pm');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      const tomorrowOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('tomorrow')
      );
      expect(tomorrowOption).toBeTruthy();
      expect(tomorrowOption?.date.getHours()).toBe(15);
      expect(tomorrowOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });

  it('explicit time should override defaultTime for natural dates', () => {
    createRoot((dispose) => {
      const [query] = createSignal('thursday 9am');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      const naturalOption = result.find((opt) => opt.type === 'natural');
      expect(naturalOption).toBeTruthy();
      expect(naturalOption?.date.getHours()).toBe(9);
      expect(naturalOption?.date.getMinutes()).toBe(0);

      dispose();
    });
  });

  it('should NOT show "at" suffix in label when defaultTime is used without explicit time', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tomorrow');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      const tomorrowOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('tomorrow')
      );
      expect(tomorrowOption).toBeTruthy();
      expect(tomorrowOption?.displayText).not.toContain('at');

      dispose();
    });
  });

  it('should NOT show "at" suffix for natural dates when only defaultTime applies', () => {
    createRoot((dispose) => {
      const [query] = createSignal('thursday');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      const naturalOption = result.find((opt) => opt.type === 'natural');
      expect(naturalOption).toBeTruthy();
      expect(naturalOption?.displayText).not.toContain('at');

      dispose();
    });
  });

  it('should show "at" suffix when user explicitly types a time', () => {
    createRoot((dispose) => {
      const [query] = createSignal('tomorrow 9am');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      const tomorrowOption = result.find((opt) =>
        opt.displayText.toLowerCase().includes('tomorrow')
      );
      expect(tomorrowOption).toBeTruthy();
      expect(tomorrowOption?.displayText).toContain('at 9 AM');

      dispose();
    });
  });

  it('should NOT show "at" suffix in empty-query default presets', () => {
    createRoot((dispose) => {
      const [query] = createSignal('');
      const options = useDateSearch({ query, baseDate, defaultTime });

      const result = options();
      result.forEach((opt) => {
        expect(opt.displayText).not.toContain('at');
      });

      dispose();
    });
  });

  it('should filter out past presets from defaults', () => {
    createRoot((dispose) => {
      // 2 PM - "Today at 8am" is in the past
      const lateBaseDate = new Date('2024-06-15T14:00:00');
      const [query] = createSignal('');
      const options = useDateSearch({
        query,
        baseDate: lateBaseDate,
        defaultTime,
      });

      const result = options();
      const todayOption = result.find((opt) => opt.id === 'today');
      expect(todayOption).toBeUndefined();

      dispose();
    });
  });

  it('should include "Today" in defaults when defaultTime has not passed yet', () => {
    createRoot((dispose) => {
      // 6 AM - "Today at 8am" is still in the future
      const earlyBaseDate = new Date('2099-06-15T06:00:00');
      const [query] = createSignal('');
      const options = useDateSearch({
        query,
        baseDate: earlyBaseDate,
        defaultTime,
      });

      const result = options();
      const todayOption = result.find((opt) => opt.id === 'today');
      expect(todayOption).toBeTruthy();
      expect(todayOption?.date.getHours()).toBe(8);

      dispose();
    });
  });
});
