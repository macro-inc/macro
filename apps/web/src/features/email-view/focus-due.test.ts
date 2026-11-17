import { describe, expect, it } from 'vitest';
import { emailFocusDue } from './focus-due';

// Wednesday, November 4, 2026, at local noon.
const NOW = new Date(2026, 10, 4, 12);

describe('emailFocusDue', () => {
  it('reads today and tomorrow as words', () => {
    expect(emailFocusDue('2026-11-04', NOW)?.label).toBe('Due today');
    expect(emailFocusDue('2026-11-05', NOW)?.label).toBe('Due tomorrow');
  });

  it('reads the week ahead as a weekday, and past that as a date', () => {
    expect(emailFocusDue('2026-11-06', NOW)?.label).toBe('Due Fri');
    expect(emailFocusDue('2026-11-10', NOW)?.label).toBe('Due Tue');
    expect(emailFocusDue('2026-11-11', NOW)?.label).toBe('Due Nov 11');
  });

  it('adds the year only when it differs', () => {
    expect(emailFocusDue('2027-01-05', NOW)?.label).toBe('Due Jan 5, 2027');
  });

  it('reads a past date as overdue, with the date it was due', () => {
    const due = emailFocusDue('2026-11-03', NOW);
    expect(due?.label).toBe('Overdue');
    expect(due?.overdue).toBe(true);
    expect(due?.title).toBe('Was due Tuesday, November 3, 2026');
  });

  it('keeps the full date in the tooltip', () => {
    expect(emailFocusDue('2026-11-06', NOW)?.title).toBe(
      'Due Friday, November 6, 2026'
    );
  });

  it('turns over at local midnight, whatever the time zone', () => {
    const lastMinute = new Date(2026, 10, 4, 23, 59);
    const firstMinute = new Date(2026, 10, 5, 0, 1);
    expect(emailFocusDue('2026-11-04', lastMinute)?.label).toBe('Due today');
    expect(emailFocusDue('2026-11-04', firstMinute)?.label).toBe('Overdue');
    expect(emailFocusDue('2026-11-05', firstMinute)?.label).toBe('Due today');
  });

  it('shows nothing for a value it cannot read', () => {
    expect(emailFocusDue('next Friday', NOW)).toBeUndefined();
    expect(emailFocusDue('2026-02-30', NOW)).toBeUndefined();
  });
});
