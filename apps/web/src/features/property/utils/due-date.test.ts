import { describe, expect, it } from 'vitest';
import { dueDateFace } from './due-date';

const now = new Date(2026, 9, 20, 15, 30);

describe('dueDateFace', () => {
  it('calls today Today', () => {
    expect(dueDateFace(new Date(2026, 9, 20, 8), now)).toEqual({
      text: 'Today',
      tone: 'today',
    });
  });

  it('calls the previous day Yesterday and marks it overdue', () => {
    expect(dueDateFace(new Date(2026, 9, 19, 23), now)).toEqual({
      text: 'Yesterday',
      tone: 'overdue',
    });
  });

  it('calls the next day Tomorrow', () => {
    expect(dueDateFace(new Date(2026, 9, 21, 1), now)).toEqual({
      text: 'Tomorrow',
      tone: 'scheduled',
    });
  });

  it('shows an older day as a short date in red territory', () => {
    expect(dueDateFace(new Date(2026, 9, 16), now)).toEqual({
      text: 'Oct 16',
      tone: 'overdue',
    });
  });

  it('shows a later day this year as a short date', () => {
    expect(dueDateFace(new Date(2026, 10, 2), now)).toEqual({
      text: 'Nov 2',
      tone: 'scheduled',
    });
  });

  it('includes the year when the date is in another year', () => {
    expect(dueDateFace(new Date(2027, 11, 1), now)).toEqual({
      text: 'Dec 1, 2027',
      tone: 'scheduled',
    });
  });
});
