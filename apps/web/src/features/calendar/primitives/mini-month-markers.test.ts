import { describe, expect, it } from 'vitest';
import { miniMonthMarkers } from './mini-month-markers';

describe('miniMonthMarkers', () => {
  const gridStart = new Date(2026, 9, 25);
  const gridEnd = new Date(2026, 11, 6);

  it('projects all-day spans with exclusive end dates and clips to the grid', () => {
    const markers = miniMonthMarkers(
      [
        {
          allDay: true,
          start: '2026-10-24',
          end: '2026-10-27',
          calendar: { id: 'a', name: 'A', color: 'blue' },
          isCancelled: false,
        },
        {
          allDay: true,
          start: '2026-12-05',
          end: '2026-12-08',
          calendar: { id: 'b', name: 'B', color: 'green' },
          isCancelled: false,
        },
      ],
      gridStart,
      gridEnd
    );

    expect([...markers]).toEqual([
      ['2026-10-25', ['blue']],
      ['2026-10-26', ['blue']],
      ['2026-12-05', ['green']],
    ]);
  });

  it('projects timed events by local day, including midnight ends and zero-duration instants', () => {
    const markers = miniMonthMarkers(
      [
        {
          allDay: false,
          start: new Date(2026, 10, 1, 23).toISOString(),
          end: new Date(2026, 10, 2).toISOString(),
          calendar: { id: 'a', name: 'A', color: 'blue' },
          isCancelled: false,
        },
        {
          allDay: false,
          start: new Date(2026, 10, 2, 0).toISOString(),
          end: new Date(2026, 10, 2, 0).toISOString(),
          calendar: { id: 'b', name: 'B', color: 'green' },
          isCancelled: false,
        },
        {
          allDay: false,
          start: new Date(2026, 10, 1, 23).toISOString(),
          end: new Date(2026, 10, 3, 1).toISOString(),
          calendar: { id: 'c', name: 'C', color: 'red' },
          isCancelled: true,
        },
      ],
      gridStart,
      gridEnd
    );

    expect([...markers]).toEqual([
      ['2026-11-01', ['blue']],
      ['2026-11-02', ['green']],
    ]);
  });

  it('keeps all visible occurrence colors for the same day', () => {
    const markers = miniMonthMarkers(
      ['blue', 'green', 'violet', 'amber'].map((color) => ({
        allDay: true,
        start: '2026-11-04',
        end: '2026-11-05',
        calendar: { id: color, name: color, color },
        isCancelled: false,
      })),
      gridStart,
      gridEnd
    );

    expect(markers.get('2026-11-04')).toEqual([
      'blue',
      'green',
      'violet',
      'amber',
    ]);
  });
});
