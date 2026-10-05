import { describe, expect, it } from 'vitest';
import { formatDate } from './formatting';

describe('formatDate', () => {
  it('shows a day as its short month, day and year', () => {
    expect(formatDate(new Date(2025, 2, 14))).toBe('Mar 14, 2025');
    expect(formatDate(new Date(2026, 11, 1, 23, 59))).toBe('Dec 1, 2026');
  });
});
