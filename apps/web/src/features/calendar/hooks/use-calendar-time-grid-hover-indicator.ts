import type { Accessor } from 'solid-js';
import { createEffect, on, onCleanup } from 'solid-js';

const POINTER_TIME_FRAME_SELECTOR = '.fc-timegrid-col-frame';

/** Tracks the mouse time position across FullCalendar's week and day columns. */
export function useCalendarTimeGridHoverIndicator(
  calendarElement: Accessor<HTMLElement | undefined>
) {
  createEffect(
    on(calendarElement, (element) => {
      if (!element) return;

      const frames = () =>
        element.querySelectorAll<HTMLElement>(POINTER_TIME_FRAME_SELECTOR);

      const resetHoverIndicator = () => {
        for (const frame of frames()) {
          frame.style.removeProperty('--calendar-time-grid-hover-top');
          frame.removeAttribute('data-time-grid-hover');
        }
      };

      const handlePointerMove = (event: PointerEvent) => {
        let targetFrame: HTMLElement | undefined;

        if (event.pointerType === 'mouse') {
          for (const frame of frames()) {
            const frameBounds = frame.getBoundingClientRect();
            const scrollerBounds = frame
              .closest<HTMLElement>('.fc-scroller')
              ?.getBoundingClientRect();

            if (
              scrollerBounds &&
              event.clientX >= frameBounds.left &&
              event.clientX <= frameBounds.right &&
              event.clientY >= scrollerBounds.top &&
              event.clientY <= scrollerBounds.bottom
            ) {
              targetFrame = frame;
              break;
            }
          }
        }

        resetHoverIndicator();

        if (!targetFrame) return;

        const frameBounds = targetFrame.getBoundingClientRect();
        targetFrame.style.setProperty(
          '--calendar-time-grid-hover-top',
          `${event.clientY - frameBounds.top}px`
        );
        targetFrame.setAttribute('data-time-grid-hover', '');
      };

      element.addEventListener('scroll', resetHoverIndicator, true);
      element.addEventListener('pointermove', handlePointerMove);
      element.addEventListener('pointerleave', resetHoverIndicator);

      onCleanup(() => {
        element.removeEventListener('scroll', resetHoverIndicator, true);
        element.removeEventListener('pointermove', handlePointerMove);
        element.removeEventListener('pointerleave', resetHoverIndicator);
      });
    })
  );
}
