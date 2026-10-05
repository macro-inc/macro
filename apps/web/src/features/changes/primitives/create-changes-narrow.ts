import { createSizeBreakpoints } from '@app/util/create-size-breakpoints';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createElementSize } from '@solid-primitives/resize-observer';
import type { Accessor } from 'solid-js';
import { CHANGES_NARROW_WIDTH } from '../core/layout';

/** Respond to the host's width, not the browser viewport. */
export function createChangesNarrow(
  element: Accessor<HTMLElement | undefined>
): Accessor<boolean> {
  const size = createElementSize(element);
  const breakpoints = createSizeBreakpoints(
    () => (size.width != null && size.width > 0 ? size.width : undefined),
    { narrow: CHANGES_NARROW_WIDTH }
  );
  return () => isTouchDevice() || breakpoints.narrow();
}
