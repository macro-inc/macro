import type { Calendar } from '@fullcalendar/core';

/** FullCalendar's liquid time-grid scroller — the element that scrolls hours. */
const TIME_GRID_SCROLLER_SELECTOR =
  '.fc-timegrid .fc-scroller-harness-liquid > .fc-scroller';

/** The hour scroller inside one rendered calendar page, when it has one. */
export function timeGridScroller(
  root: HTMLElement | undefined
): HTMLElement | undefined {
  return (
    root?.querySelector<HTMLElement>(TIME_GRID_SCROLLER_SELECTOR) ?? undefined
  );
}

/** Vertical breathing room kept around a chip scrolled into view. */
const CHIP_VISIBILITY_MARGIN = 24;

/**
 * Scrolls a rendered occurrence chip into the hour scroller's viewport, so a
 * navigation request that lands on an event outside the scrolled hours still
 * shows it. Month views and all-day chips sit outside the scroller and are
 * left where they are.
 */
export function scrollEventChipIntoView(
  root: HTMLElement | undefined,
  chip: HTMLElement
) {
  const scroller = timeGridScroller(root);
  if (!scroller || !scroller.contains(chip)) return;

  const chipBox = chip.getBoundingClientRect();
  const scrollerBox = scroller.getBoundingClientRect();
  if (
    chipBox.top >= scrollerBox.top + CHIP_VISIBILITY_MARGIN &&
    chipBox.bottom <= scrollerBox.bottom - CHIP_VISIBILITY_MARGIN
  ) {
    return;
  }

  const centeringOffset = Math.max(
    0,
    (scrollerBox.height - chipBox.height) / 2
  );
  scroller.scrollTop += chipBox.top - scrollerBox.top - centeringOffset;
}

/**
 * Time of day a time grid opens on, an early-morning start that puts the
 * workday in view without scrolling.
 */
export const TIME_GRID_OPENING_SCROLL_TIME = '07:00:00';

/**
 * Re-applies the opening scroll position of a grid that rendered without
 * layout.
 *
 * FullCalendar resolves `scrollTime` from slot coordinates measured while it
 * renders. A grid that mounts hidden, detached, or inside a container that has
 * not been sized yet measures zeros, treats the scroll as done, and leaves the
 * scroller at midnight once it becomes visible. Re-measuring and scrolling
 * again on the first laid-out frame restores the intended opening hour.
 *
 * Returns whether the grid has laid out, so callers can stop retrying. A grid
 * that already scrolled itself, and one a reader has scrolled, are left alone.
 */
export function applyTimeGridOpeningScroll(
  root: HTMLElement | undefined,
  calendar: Calendar | undefined,
  scrollTime: string
): boolean {
  const scroller = timeGridScroller(root);
  // Month views have no hour scroller and no opening hour to restore.
  if (!calendar || !scroller || scroller.clientHeight === 0) return false;
  if (scroller.scrollTop !== 0) return true;

  calendar.updateSize();
  calendar.scrollToTime(scrollTime);
  return true;
}
