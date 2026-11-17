import { describe, expect, it } from 'vitest';
import { phoneSlotRange } from './phone-slot';

describe('phoneSlotRange', () => {
  it('selects one hour across midnight without changing the pressed start', () => {
    const start = new Date(2030, 0, 1, 23, 30);
    const range = phoneSlotRange(start, false);
    expect(range.start).toBe(start);
    expect(range.end).toEqual(new Date(2030, 0, 2, 0, 30));
    expect(range.allDay).toBe(false);
  });

  it('uses an exclusive end for an all-day slot', () => {
    const range = phoneSlotRange(new Date(2030, 0, 1), true);
    expect(range.end).toEqual(new Date(2030, 0, 2));
    expect(range.allDay).toBe(true);
  });
});
