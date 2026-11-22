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

  it.each([
    { top: 93, bottom: 111, expectedScroll: 418 },
    { top: 102, bottom: 120, expectedScroll: 449 },
    { top: 80, bottom: 98, expectedScroll: 449 },
  ])(
    'keeps the opening hour readable without resetting other scroll positions ($top)',
    ({ top, bottom, expectedScroll }) => {
      const root = gridRoot({ clientHeight: 600, scrollTop: 449 });
      const scroller = root.querySelector('.fc-scroller')!;
      const slot = document.createElement('div');
      slot.className = 'fc-timegrid-slot';
      slot.dataset.time = '07:00:00';
      const label = document.createElement('span');
      label.className = 'fc-timegrid-slot-label-cushion';
      slot.append(label);
      scroller.append(slot);
      vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 100, 600, 600)
      );
      vi.spyOn(label, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, top, 34, bottom - top)
      );
      const calendar = calendarStub();

      expect(applyTimeGridOpeningScroll(root, calendar, '07:00:00')).toBe(true);
      expect(scroller.scrollTop).toBe(expectedScroll);
      expect(calendar.scrollToTime).not.toHaveBeenCalled();
    }
  );

  it.each([0, 540])(
    'restores the saved position %i instead of applying the opening hour',
    (saved) => {
      const calendar = calendarStub();
      const root = gridRoot({ clientHeight: 600, scrollTop: 0 });
      expect(
        applyTimeGridOpeningScroll(
          root,
          calendar,
          TIME_GRID_OPENING_SCROLL_TIME,
          saved
        )
      ).toBe(true);
      expect(root.querySelector('.fc-scroller')?.scrollTop).toBe(saved);
      expect(calendar.scrollToTime).not.toHaveBeenCalled();
    }
  );
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
