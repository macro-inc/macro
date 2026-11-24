import { timeGridScroller } from '@app/features/calendar/utils/time-grid-scroller';
import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';

type AxisLabel = { text: string; top: number; height: number };
type AxisState = {
  labels: AxisLabel[];
  top: number;
  height: number;
  scrollTop: number;
  openingScrollTop: number;
  now?: AxisLabel;
};

/** Read the active grid's real slot geometry; only the shared gutter stays outside paging. */
export function createMobileGridAxis(
  root: Accessor<HTMLElement | undefined>,
  viewport: Accessor<HTMLElement | undefined>,
  paused: Accessor<boolean> = () => false
) {
  const [state, setState] = createStore<AxisState>({
    labels: [],
    top: 0,
    height: 0,
    scrollTop: 0,
    openingScrollTop: 0,
  });
  createEffect(
    on([root, viewport], ([element, boundary]) => {
      if (!element || !boundary) return;
      let scroller: HTMLElement | undefined;
      let frame: number | undefined;
      let opening: number | undefined;
      let interacted = false;
      const markInteraction = () => {
        interacted = true;
      };
      const scroll = () => {
        if (!scroller) return;
        // Hidden FullCalendar pages first measure at zero, then apply scrollTime.
        if (opening === undefined || (opening === 0 && !interacted))
          opening = scroller.scrollTop;
        setState({ scrollTop: scroller.scrollTop, openingScrollTop: opening });
      };
      const detach = () => {
        scroller?.removeEventListener('scroll', scroll);
        scroller?.removeEventListener('wheel', markInteraction);
        scroller?.removeEventListener('touchstart', markInteraction);
        scroller?.removeEventListener('keydown', markInteraction);
      };
      const measure = () => {
        frame = undefined;
        if (paused()) return;
        const next = timeGridScroller(element);
        if (!next || next.clientHeight === 0) return;
        if (scroller !== next) {
          detach();
          scroller = next;
          scroller.addEventListener('scroll', scroll, { passive: true });
          scroller.addEventListener('wheel', markInteraction, {
            passive: true,
          });
          scroller.addEventListener('touchstart', markInteraction, {
            passive: true,
          });
          scroller.addEventListener('keydown', markInteraction);
        }
        const box = scroller.getBoundingClientRect();
        const boundaryBox = boundary.getBoundingClientRect();
        const indicator = element.querySelector<HTMLElement>(
          '.fc-timegrid-now-indicator-line'
        );
        const clock =
          indicator?.querySelector<HTMLElement>('.calendar-now-time');
        const now =
          indicator && clock && indicator.getClientRects().length > 0
            ? {
                text: clock.dataset.axisLabel ?? clock.textContent ?? '',
                top:
                  indicator.getBoundingClientRect().top -
                  box.top +
                  next.scrollTop -
                  7,
                height: 14,
              }
            : undefined;
        // Keep the displayed clock identity stable when its geometry is unchanged.
        const currentNow = state.now;
        const stableNow =
          now &&
          currentNow &&
          now.top === currentNow.top &&
          now.text === currentNow.text
            ? currentNow
            : now;
        setState({
          now: stableNow,
          top: box.top - boundaryBox.top,
          height: box.height,
          labels: Array.from(
            scroller.querySelectorAll<HTMLElement>(
              '.fc-timegrid-slot-label-cushion'
            )
          ).map((label) => {
            const rect = label.getBoundingClientRect();
            return {
              text: label.textContent ?? '',
              top: rect.top - box.top + next.scrollTop,
              height: rect.height,
            };
          }),
        });
        scroll();
      };
      const schedule = () => {
        if (paused()) return;
        if (frame === undefined) frame = requestAnimationFrame(measure);
      };
      const mutation = new MutationObserver(schedule);
      createEffect(
        on(paused, (frozen) => {
          if (!frozen) schedule();
        })
      );
      mutation.observe(element, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['style'],
      });
      const resize = new ResizeObserver(schedule);
      resize.observe(element);
      resize.observe(boundary);
      schedule();
      onCleanup(() => {
        detach();
        mutation.disconnect();
        resize.disconnect();
        if (frame !== undefined) cancelAnimationFrame(frame);
      });
    })
  );
  return {
    state,
    currentTimeTop: () =>
      state.now
        ? state.now.top + state.now.height / 2 - state.scrollTop
        : undefined,
    faded: () => state.scrollTop > state.openingScrollTop + 1,
  };
}
