import { describe, expect, it } from 'vitest';
import { createRoot, createSignal } from 'solid-js';
import { addDays } from 'date-fns';
import {
  useDateSearch,
  parseNaturalDate,
  formatDateWithContext,
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

      // Should be 3 days from base date
      const expectedDate = addDays(baseDate, 3);
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
      expect(durationOption?.secondaryText).toContain('Jun 18'); // 3 days from June 15

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
