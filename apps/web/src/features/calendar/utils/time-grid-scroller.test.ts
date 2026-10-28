import type { Calendar } from '@fullcalendar/core';
import { describe, expect, it, vi } from 'vitest';
import {
  applyTimeGridOpeningScroll,
  TIME_GRID_OPENING_SCROLL_TIME,
} from './time-grid-scroller';

const calendarStub = () =>
  ({
    scrollToTime: vi.fn(),
    updateSize: vi.fn(),
  }) as unknown as Calendar & {
    scrollToTime: ReturnType<typeof vi.fn>;
    updateSize: ReturnType<typeof vi.fn>;
  };

/** A grid root shaped like FullCalendar's, with a measurable hour scroller. */
const gridRoot = ({
  clientHeight,
  scrollTop,
}: {
  clientHeight: number;
  scrollTop: number;
}) => {
  const root = document.createElement('div');
  const timeGrid = document.createElement('div');
  timeGrid.className = 'fc-timegrid';
  const harness = document.createElement('div');
  harness.className = 'fc-scroller-harness-liquid';
  const scroller = document.createElement('div');
  scroller.className = 'fc-scroller';

  harness.append(scroller);
  timeGrid.append(harness);
  root.append(timeGrid);

  Object.defineProperty(scroller, 'clientHeight', { value: clientHeight });
  scroller.scrollTop = scrollTop;

  return root;
};

describe('applyTimeGridOpeningScroll', () => {
  it('scrolls a grid that rendered before it had layout', () => {
    const calendar = calendarStub();

    expect(
      applyTimeGridOpeningScroll(
        gridRoot({ clientHeight: 600, scrollTop: 0 }),
        calendar,
        TIME_GRID_OPENING_SCROLL_TIME
      )
    ).toBe(true);
    expect(calendar.updateSize).toHaveBeenCalledOnce();
    expect(calendar.scrollToTime).toHaveBeenCalledWith(
      TIME_GRID_OPENING_SCROLL_TIME
    );
  });

  it('leaves an already scrolled grid alone', () => {
    const calendar = calendarStub();

    expect(
      applyTimeGridOpeningScroll(
        gridRoot({ clientHeight: 600, scrollTop: 289 }),
        calendar,
        TIME_GRID_OPENING_SCROLL_TIME
      )
    ).toBe(true);
    expect(calendar.updateSize).not.toHaveBeenCalled();
    expect(calendar.scrollToTime).not.toHaveBeenCalled();
  });

  it('waits for a grid that has not laid out yet', () => {
    const calendar = calendarStub();

    expect(
      applyTimeGridOpeningScroll(
        gridRoot({ clientHeight: 0, scrollTop: 0 }),
        calendar,
        TIME_GRID_OPENING_SCROLL_TIME
      )
    ).toBe(false);
    expect(calendar.scrollToTime).not.toHaveBeenCalled();
  });

  it('ignores a view without an hour scroller', () => {
    const calendar = calendarStub();

    expect(
      applyTimeGridOpeningScroll(
        document.createElement('div'),
        calendar,
        TIME_GRID_OPENING_SCROLL_TIME
      )
    ).toBe(false);
    expect(calendar.scrollToTime).not.toHaveBeenCalled();
  });
});
