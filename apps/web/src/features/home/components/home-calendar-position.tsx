import type { CalendarGridHandle } from '@app/features/calendar/components/CalendarGrid';
import { timeGridScroller } from '@app/features/calendar/utils/time-grid-scroller';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { createEffect, on, onCleanup } from 'solid-js';

/** Keep the opening position through calendar layout updates until the user interacts. */
export function HomeCalendarPosition(props: { handle: CalendarGridHandle }) {
  let userInteracted = false;
  let frame: number | undefined;
  let observer: MutationObserver | undefined;
  const stop = () => {
    userInteracted = true;
    observer?.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const schedule = () => {
    if (userInteracted || frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const root = props.handle.element();
      const scroller = timeGridScroller(root);
      const marker = root?.querySelector<HTMLElement>(
        '.fc-timegrid-now-indicator-line'
      );
      if (
        !scroller ||
        !marker ||
        !marker.style.top ||
        scroller.clientHeight === 0 ||
        scroller.scrollHeight <= scroller.clientHeight
      )
        return;
      const offset =
        marker.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        scroller.clientHeight / 2;
      if (Math.abs(offset) > 1) scroller.scrollTop += offset;
    });
  };
  createEffect(on([props.handle.element, props.handle.api], schedule));
  createEffect(
    on(props.handle.element, (root) => {
      if (!root) return;
      observer = new MutationObserver(schedule);
      observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style'],
      });
      const visibility = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) schedule();
      });
      visibility.observe(root);
      root.addEventListener('scroll', schedule, true);
      root.addEventListener('wheel', stop, { passive: true });
      root.addEventListener('pointerdown', stop);
      root.addEventListener('keydown', stop);
      onCleanup(() => {
        observer?.disconnect();
        visibility.disconnect();
        root.removeEventListener('scroll', schedule, true);
        root.removeEventListener('wheel', stop);
        root.removeEventListener('pointerdown', stop);
        root.removeEventListener('keydown', stop);
      });
    })
  );
  createResizeObserver(props.handle.element, schedule);
  onCleanup(() => {
    stop();
  });
  return null;
}
