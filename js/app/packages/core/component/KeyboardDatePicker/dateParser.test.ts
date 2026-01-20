import { describe, expect, it } from 'vitest';
import {
  addDays,
  addHours,
  addMinutes,
  addMonths,
  addWeeks,
  addYears,
} from 'date-fns';
import {
  applyDurationToDate,
  couldBeDurationString,
  formatDuration,
  parseDateFromDuration,
  parseDurationString,
  type ParsedDuration,
} from './dateParser';

describe('parseDurationString', () => {
  it('should parse hours correctly', () => {
    expect(parseDurationString('1h')).toEqual({ value: 1, unit: 'h' });
    expect(parseDurationString('24h')).toEqual({ value: 24, unit: 'h' });
    expect(parseDurationString('36h')).toEqual({ value: 36, unit: 'h' });
    expect(parseDurationString('0.5h')).toEqual({ value: 0.5, unit: 'h' });
  });

  it('should parse days correctly', () => {
    expect(parseDurationString('1d')).toEqual({ value: 1, unit: 'd' });
    expect(parseDurationString('3d')).toEqual({ value: 3, unit: 'd' });
    expect(parseDurationString('7d')).toEqual({ value: 7, unit: 'd' });
    expect(parseDurationString('1.5d')).toEqual({ value: 1.5, unit: 'd' });
  });

  it('should parse weeks correctly', () => {
    expect(parseDurationString('1w')).toEqual({ value: 1, unit: 'w' });
    expect(parseDurationString('2w')).toEqual({ value: 2, unit: 'w' });
    expect(parseDurationString('4.5w')).toEqual({ value: 4.5, unit: 'w' });
  });

  it('should parse months correctly', () => {
    expect(parseDurationString('1m')).toEqual({ value: 1, unit: 'm' });
    expect(parseDurationString('3m')).toEqual({ value: 3, unit: 'm' });
    expect(parseDurationString('12m')).toEqual({ value: 12, unit: 'm' });
  });

  it('should parse years correctly', () => {
    expect(parseDurationString('1y')).toEqual({ value: 1, unit: 'y' });
    expect(parseDurationString('2y')).toEqual({ value: 2, unit: 'y' });
    expect(parseDurationString('0.5y')).toEqual({ value: 0.5, unit: 'y' });
  });

  it('should parse minutes correctly', () => {
    expect(parseDurationString('30min')).toEqual({ value: 30, unit: 'min' });
    expect(parseDurationString('45min')).toEqual({ value: 45, unit: 'min' });
    expect(parseDurationString('90min')).toEqual({ value: 90, unit: 'min' });
  });

  it('should handle whitespace', () => {
    expect(parseDurationString(' 3d ')).toEqual({ value: 3, unit: 'd' });
    expect(parseDurationString('3 d')).toEqual({ value: 3, unit: 'd' });
    expect(parseDurationString(' 1 h ')).toEqual({ value: 1, unit: 'h' });
  });

  it('should be case insensitive', () => {
    expect(parseDurationString('3D')).toEqual({ value: 3, unit: 'd' });
    expect(parseDurationString('1W')).toEqual({ value: 1, unit: 'w' });
    expect(parseDurationString('2H')).toEqual({ value: 2, unit: 'h' });
    expect(parseDurationString('30MIN')).toEqual({ value: 30, unit: 'min' });
  });

  it('should return null for invalid input', () => {
    expect(parseDurationString('')).toBeNull();
    expect(parseDurationString('abc')).toBeNull();
    expect(parseDurationString('3')).toBeNull();
    expect(parseDurationString('d')).toBeNull();
    expect(parseDurationString('3x')).toBeNull();
    expect(parseDurationString('-3d')).toBeNull();
    expect(parseDurationString('0d')).toBeNull();
  });
});

describe('applyDurationToDate', () => {
  const baseDate = new Date('2024-01-15T10:00:00');

  it('should add hours correctly', () => {
    const duration: ParsedDuration = { value: 3, unit: 'h' };
    const result = applyDurationToDate(baseDate, duration);
    expect(result).toEqual(addHours(baseDate, 3));
  });

  it('should add days correctly', () => {
    const duration: ParsedDuration = { value: 5, unit: 'd' };
    const result = applyDurationToDate(baseDate, duration);
    expect(result).toEqual(addDays(baseDate, 5));
  });

  it('should add weeks correctly', () => {
    const duration: ParsedDuration = { value: 2, unit: 'w' };
    const result = applyDurationToDate(baseDate, duration);
    expect(result).toEqual(addWeeks(baseDate, 2));
  });

  it('should add months correctly', () => {
    const duration: ParsedDuration = { value: 3, unit: 'm' };
    const result = applyDurationToDate(baseDate, duration);
    expect(result).toEqual(addMonths(baseDate, 3));
  });

  it('should add years correctly', () => {
    const duration: ParsedDuration = { value: 1, unit: 'y' };
    const result = applyDurationToDate(baseDate, duration);
    expect(result).toEqual(addYears(baseDate, 1));
  });

  it('should add minutes correctly', () => {
    const duration: ParsedDuration = { value: 45, unit: 'min' };
    const result = applyDurationToDate(baseDate, duration);
    expect(result).toEqual(addMinutes(baseDate, 45));
  });

  it('should round decimal values', () => {
    const duration: ParsedDuration = { value: 1.7, unit: 'h' };
    const result = applyDurationToDate(baseDate, duration);
    // 1.7 hours should round to 2 hours
    expect(result).toEqual(addHours(baseDate, 2));
  });
});

describe('parseDateFromDuration', () => {
  it('should parse and apply duration from string', () => {
    const baseDate = new Date('2024-01-15T10:00:00');

    const result1 = parseDateFromDuration('3d', baseDate);
    expect(result1).toEqual(addDays(baseDate, 3));

    const result2 = parseDateFromDuration('1w', baseDate);
    expect(result2).toEqual(addWeeks(baseDate, 1));

    const result3 = parseDateFromDuration('24h', baseDate);
    expect(result3).toEqual(addHours(baseDate, 24));
  });

  it('should use current date when base date not provided', () => {
    const now = new Date();
    const result = parseDateFromDuration('1d');

    // Check that it's approximately 1 day in the future
    const expectedMin = addDays(now, 1).getTime() - 1000; // Allow 1 second tolerance
    const expectedMax = addDays(now, 1).getTime() + 1000;

    expect(result!.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(result!.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('should return null for invalid input', () => {
    expect(parseDateFromDuration('invalid')).toBeNull();
    expect(parseDateFromDuration('')).toBeNull();
    expect(parseDateFromDuration('3')).toBeNull();
  });
});

describe('couldBeDurationString', () => {
  it('should return true for valid duration strings', () => {
    expect(couldBeDurationString('3d')).toBe(true);
    expect(couldBeDurationString('1w')).toBe(true);
    expect(couldBeDurationString('24h')).toBe(true);
    expect(couldBeDurationString('30min')).toBe(true);
  });

  it('should return true for partial duration strings', () => {
    expect(couldBeDurationString('')).toBe(true);
    expect(couldBeDurationString('3')).toBe(true);
    expect(couldBeDurationString('3.')).toBe(true);
    expect(couldBeDurationString('3.5')).toBe(true);
    expect(couldBeDurationString('3d')).toBe(true);
  });

  it('should return true for partial "min" strings', () => {
    expect(couldBeDurationString('30m')).toBe(true);
    expect(couldBeDurationString('30mi')).toBe(true);
    expect(couldBeDurationString('30min')).toBe(true);
  });

  it('should return false for invalid strings', () => {
    expect(couldBeDurationString('abc')).toBe(false);
    expect(couldBeDurationString('3x')).toBe(false);
    expect(couldBeDurationString('d3')).toBe(false);
    expect(couldBeDurationString('hello')).toBe(false);
  });

  it('should handle whitespace', () => {
    expect(couldBeDurationString(' ')).toBe(true);
    expect(couldBeDurationString(' 3 ')).toBe(true);
    expect(couldBeDurationString('3 d')).toBe(true);
  });
});

describe('formatDuration', () => {
  it('should format singular units correctly', () => {
    expect(formatDuration({ value: 1, unit: 'h' })).toBe('1 hour');
    expect(formatDuration({ value: 1, unit: 'd' })).toBe('1 day');
    expect(formatDuration({ value: 1, unit: 'w' })).toBe('1 week');
    expect(formatDuration({ value: 1, unit: 'm' })).toBe('1 month');
    expect(formatDuration({ value: 1, unit: 'y' })).toBe('1 year');
    expect(formatDuration({ value: 1, unit: 'min' })).toBe('1 minute');
  });

  it('should format plural units correctly', () => {
    expect(formatDuration({ value: 2, unit: 'h' })).toBe('2 hours');
    expect(formatDuration({ value: 3, unit: 'd' })).toBe('3 days');
    expect(formatDuration({ value: 4, unit: 'w' })).toBe('4 weeks');
    expect(formatDuration({ value: 5, unit: 'm' })).toBe('5 months');
    expect(formatDuration({ value: 2, unit: 'y' })).toBe('2 years');
    expect(formatDuration({ value: 30, unit: 'min' })).toBe('30 minutes');
  });

  it('should handle decimal values', () => {
    expect(formatDuration({ value: 1.5, unit: 'h' })).toBe('1.5 hours');
    expect(formatDuration({ value: 0.5, unit: 'd' })).toBe('0.5 days');
    expect(formatDuration({ value: 2.5, unit: 'w' })).toBe('2.5 weeks');
  });
});
