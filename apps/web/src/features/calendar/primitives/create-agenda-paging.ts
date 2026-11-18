import { beginInteraction } from '@app/observability/flow';
import {
  restoreScrollAnchor,
  type ScrollAnchor,
} from '@core/util/scrollAnchor';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { agendaDay, agendaWindowIndices } from './agenda-window';

const DAY_SELECTOR = '[data-agenda-day]';

/** A requested empty date belongs to its visible collapsed group, not a zero-height marker. */
export function findAgendaDayAnchor(
  viewport: HTMLElement,
  date: Date
): HTMLElement | undefined {
  const requested = agendaDay(date).getTime();
  return Array.from(viewport.querySelectorAll<HTMLElement>(DAY_SELECTOR)).find(
    (day) => {
      if (day.dataset.agendaDay === date.toDateString()) return true;
      const end = day.dataset.agendaGroupEnd;
      if (!end || !day.dataset.agendaDay) return false;
      return (
        requested >= new Date(day.dataset.agendaDay).getTime() &&
        requested <= new Date(end).getTime()
      );
    }
  );
}

function visibleDay(viewport: HTMLElement): HTMLElement | undefined {
  const top = viewport.getBoundingClientRect().top;
  return Array.from(viewport.querySelectorAll<HTMLElement>(DAY_SELECTOR)).find(
    (day) => day.getBoundingClientRect().bottom > top
  );
}

/** Keep a surviving day at the same viewport position while rotating five windows. */
export function createAgendaPaging(
  viewport: () => HTMLElement | undefined,
  date: Date
) {
  const [first, setFirst] = createSignal(-2);
  const [activeWindow, setActiveWindow] = createSignal(0);
  const indices = () => agendaWindowIndices(first());
  let frame: number | undefined;
  let interaction: ReturnType<typeof beginInteraction> | undefined;
  let anchor: ScrollAnchor | undefined;
  let anchoredScrollTop = 0;
  let observeWindows: (() => void) | undefined;
  let initialPositioning = true;

  const captureAnchor = (element: HTMLElement) => {
    anchoredScrollTop = element.scrollTop;
    const day = visibleDay(element);
    const key = day?.dataset.agendaDay;
    if (!day || !key) {
      anchor = undefined;
      return;
    }
    const date = new Date(key);
    anchor = {
      top:
        day.getBoundingClientRect().top - element.getBoundingClientRect().top,
      measure: () => {
        // Query projection can replace the row, or merge it into an empty range.
        // Resolve the logical date instead of retaining the detached element.
        const current = findAgendaDayAnchor(element, date);
        if (!current) return undefined;
        return (
          current.getBoundingClientRect().top -
          element.getBoundingClientRect().top
        );
      },
    };
  };

  createEffect(
    on(viewport, (element) => {
      if (!element) return;
      // Keep initial navigation on its requested date until the reader takes over.
      // Later resizes preserve that reader's logical day instead.
      const observer = new ResizeObserver(() => {
        if (interaction) return;
        if (initialPositioning) {
          positionInitial();
          return;
        }
        if (!anchor) return;
        restoreScrollAnchor(element, anchor);
        anchoredScrollTop = element.scrollTop;
        updateActiveWindow(element);
      });
      observeWindows = () => {
        observer.disconnect();
        for (const window of element.querySelectorAll('[data-agenda-window]')) {
          observer.observe(window);
        }
      };
      const releaseInitialPosition = () => {
        initialPositioning = false;
      };
      element.addEventListener('pointerdown', releaseInitialPosition);
      element.addEventListener('wheel', releaseInitialPosition, {
        passive: true,
      });
      element.addEventListener('keydown', releaseInitialPosition);
      observeWindows();
      onCleanup(() => {
        observer.disconnect();
        observeWindows = undefined;
        element.removeEventListener('pointerdown', releaseInitialPosition);
        element.removeEventListener('wheel', releaseInitialPosition);
        element.removeEventListener('keydown', releaseInitialPosition);
      });
    })
  );
  const updateActiveWindow = (element: HTMLElement) => {
    const window = visibleDay(element)?.closest<HTMLElement>(
      '[data-agenda-window]'
    );
    const index = Number(window?.dataset.agendaWindow);
    if (window && Number.isInteger(index)) setActiveWindow(index);
  };

  const positionInitial = () => {
    const element = viewport();
    if (!element) return;
    const day = findAgendaDayAnchor(element, date);
    if (day)
      element.scrollTop +=
        day.getBoundingClientRect().top - element.getBoundingClientRect().top;
    updateActiveWindow(element);
    captureAnchor(element);
  };

  const move = (direction: -1 | 1) => {
    const element = viewport();
    if (!element || interaction) return;
    const day = visibleDay(element);
    if (!day) return;
    updateActiveWindow(element);
    const key = day.dataset.agendaDay;
    const top =
      day.getBoundingClientRect().top - element.getBoundingClientRect().top;
    interaction = beginInteraction('calendar.agenda.load');
    initialPositioning = false;
    setFirst((value) => value + direction);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const match = Array.from(
        element.querySelectorAll<HTMLElement>(DAY_SELECTOR)
      ).find((item) => item.dataset.agendaDay === key);
      if (match)
        element.scrollTop +=
          match.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          top;
      captureAnchor(element);
      observeWindows?.();
      interaction?.end();
      interaction = undefined;
    });
  };

  const onScroll = () => {
    const element = viewport();
    if (!element) return;
    updateActiveWindow(element);
    if (interaction) return;
    if (initialPositioning && element.scrollTop !== anchoredScrollTop) {
      const maxScrollTop = Math.max(
        0,
        element.scrollHeight - element.clientHeight
      );
      // Layout shrinkage clamps scrollTop without reader intent. Other movement,
      // including browser find and assistive navigation, hands control to the reader.
      const clamped =
        anchoredScrollTop > maxScrollTop &&
        Math.abs(element.scrollTop - maxScrollTop) < 1;
      if (!clamped) initialPositioning = false;
    }
    if (initialPositioning) return;
    if (element.scrollTop !== anchoredScrollTop) captureAnchor(element);
    if (element.scrollTop < 320) move(-1);
    else if (
      element.scrollHeight - element.clientHeight - element.scrollTop <
      320
    )
      move(1);
  };

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    interaction?.end();
  });

  return { indices, activeWindow, positionInitial, onScroll, move };
}
