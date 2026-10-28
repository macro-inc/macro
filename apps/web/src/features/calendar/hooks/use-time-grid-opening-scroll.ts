import type { Calendar } from '@fullcalendar/core';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import {
  applyTimeGridOpeningScroll,
  TIME_GRID_OPENING_SCROLL_TIME,
} from '../utils/time-grid-scroller';

/**
 * Opens a time grid on {@link TIME_GRID_OPENING_SCROLL_TIME} even when
 * FullCalendar rendered it before it had layout.
 *
 * FullCalendar positions the hour scroller once, while it renders, so a grid
 * that mounts hidden or unsized stays at midnight after it appears. Watching
 * the grid for its first laid-out frame lets the opening hour be applied then
 * instead.
 */
export function useTimeGridOpeningScroll(
  root: Accessor<HTMLElement | undefined>,
  api: Accessor<Calendar | undefined>
) {
  let hasLaidOut = false;
  let frame: number | undefined;

  const applyOpeningScroll = () => {
    frame = undefined;
    hasLaidOut = applyTimeGridOpeningScroll(
      root(),
      api(),
      TIME_GRID_OPENING_SCROLL_TIME
    );
  };

  const scheduleOpeningScroll = () => {
    if (hasLaidOut || frame !== undefined) return;

    frame = requestAnimationFrame(applyOpeningScroll);
  };

  // A grid mounted with layout is measured on the frame after it renders; one
  // mounted without layout is measured when becoming visible resizes it.
  createEffect(on([root, api], scheduleOpeningScroll));
  createResizeObserver(root, scheduleOpeningScroll);

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
}
