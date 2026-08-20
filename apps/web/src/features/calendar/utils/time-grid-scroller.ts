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
