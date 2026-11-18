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

  const captureAnchor = (element: HTMLElement) => {
    anchoredScrollTop = element.scrollTop;
    const day = visibleDay(element);
    if (!day) {
      anchor = undefined;
      return;
    }
    anchor = {
      top:
        day.getBoundingClientRect().top - element.getBoundingClientRect().top,
      measure: () => {
        if (!element.contains(day)) return undefined;
        return (
          day.getBoundingClientRect().top - element.getBoundingClientRect().top
        );
      },
    };
  };

  createEffect(
    on(viewport, (element) => {
      if (!element) return;
      // Late query results change earlier days' heights. Keep the reader's day
      // stable instead of letting the browser choose an unrelated text anchor.
      const observer = new ResizeObserver(() => {
        if (interaction || !anchor) return;
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
      observeWindows();
      onCleanup(() => {
        observer.disconnect();
        observeWindows = undefined;
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
