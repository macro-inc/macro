import { addDays, addHours } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { formatDateMentionLabel } from './dateMentionDisplay';

describe('formatDateMentionLabel', () => {
  const now = new Date('2024-06-15T10:00:00');

  it('uses relative-day labels when no display mode is set', () => {
    expect(formatDateMentionLabel(new Date(), undefined)).toBe('Today');
    expect(formatDateMentionLabel(addDays(new Date(), 1), undefined)).toBe(
      'Tomorrow'
    );
  });

  it('formats calendar dates', () => {
    const nextWednesday = addDays(now, 4);
    expect(formatDateMentionLabel(nextWednesday, 'date', now)).toMatch(/Wed/);
  });

  it('formats live countdown with a suffix', () => {
    expect(formatDateMentionLabel(addDays(now, 3), 'countdown', now)).toBe(
      'in 3 days'
    );
    expect(formatDateMentionLabel(addHours(now, 2), 'countdown', now)).toBe(
      'in 2 hours'
    );
  });

  it('formats remaining duration without a suffix', () => {
    expect(formatDateMentionLabel(addDays(now, 3), 'duration', now)).toBe(
      '3 days'
    );
    expect(formatDateMentionLabel(addHours(now, 2), 'duration', now)).toBe(
      '2 hours'
    );
    expect(formatDateMentionLabel(now, 'duration', now)).toBe('0 minutes');
  });
});
