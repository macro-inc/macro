import { describe, expect, it } from 'vitest';
import { dateTileLabel } from './date-tile-label';

describe('date tile range', () => {
  it('uses the occupied dates, excluding an all-day end', () => {
    expect(
      dateTileLabel({
        start: new Date(2030, 11, 2),
        end: new Date(2030, 11, 5),
      })
    ).toEqual({ month: 'DEC', day: '2–4' });
    expect(
      dateTileLabel({
        start: new Date(2030, 11, 2),
        end: new Date(2030, 11, 3),
      })
    ).toEqual({ month: 'DEC', day: '2' });
  });

  it('shows the starting day when the range crosses a month', () => {
    expect(
      dateTileLabel({
        start: new Date(2030, 10, 30),
        end: new Date(2030, 11, 3),
      })
    ).toEqual({ month: 'NOV', day: '30' });
  });

  it('keeps the start day for a point and spans an overnight event', () => {
    const start = new Date(2030, 10, 13, 22);
    expect(dateTileLabel({ start, end: start }).day).toBe('13');
    expect(dateTileLabel({ start, end: new Date(2030, 10, 14, 1) }).day).toBe(
      '13–14'
    );
  });
});
