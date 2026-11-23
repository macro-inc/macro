import { createElementSize } from '@solid-primitives/resize-observer';
import type { Accessor } from 'solid-js';

export const CALENDAR_COMPOSER_DOCK_WIDTH = 384;
export const CALENDAR_GRID_FULL_HEADER_WIDTH = 520;
// Reserve the dock, the grid's full-header width, and both 12px content margins.
export const CALENDAR_COMPOSER_PIN_MIN_WIDTH =
  CALENDAR_COMPOSER_DOCK_WIDTH + CALENDAR_GRID_FULL_HEADER_WIDTH + 24;

/** Hide the dock at narrow container widths without changing the user's pin preference. */
export function createCalendarComposerPinning(options: {
  boundary: Accessor<HTMLElement | undefined>;
  requested: Accessor<boolean>;
  enabled: Accessor<boolean>;
}) {
  const size = createElementSize(options.boundary);
  const canPin = () =>
    options.enabled() &&
    size.width !== null &&
    size.width >= CALENDAR_COMPOSER_PIN_MIN_WIDTH;
  const pinned = () => canPin() && options.requested();
  return { canPin, pinned };
}
