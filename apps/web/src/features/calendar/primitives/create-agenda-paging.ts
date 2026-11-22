import { beginInteraction } from '@app/observability/flow';
import {
  restoreScrollAnchor,
  type ScrollAnchor,
} from '@core/util/scrollAnchor';
import { createEffect, createSignal, on, onCleanup } from 'solid-js';
import { agendaDay, agendaWindowIndices } from './agenda-window';

const DAY_SELECTOR = '[data-agenda-day]';

function isLayoutClamp(element: HTMLElement, previousScrollTop: number) {
  const max = Math.max(0, element.scrollHeight - element.clientHeight);
  return previousScrollTop > max && Math.abs(element.scrollTop - max) < 1;
}

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
    (day) => {
      const rect = day.getBoundingClientRect();
      return rect.bottom > top && rect.bottom > rect.top;
    }
  );
}

/** Keep a surviving day at the same viewport position while rotating five windows. */
export interface AgendaViewportPosition {
  first: number;
  date: number;
  top: number;
}
export function createAgendaPaging(
  viewport: () => HTMLElement | undefined,
  date: Date,
  options: {
    canLoadWindow?: (index: number) => boolean;
    initialPosition?: AgendaViewportPosition;
  } = {}
) {
  const [first, setFirst] = createSignal(options.initialPosition?.first ?? -2);
  const [activeWindow, setActiveWindow] = createSignal(0);
  const indices = () => agendaWindowIndices(first());
  let frame: number | undefined;
  let interaction: ReturnType<typeof beginInteraction> | undefined;
  let anchor: ScrollAnchor | undefined;
  let anchoredScrollTop = 0;
  let observeWindows: (() => void) | undefined;
  let initialPositioning = true;
  let pendingMove: { anchor: ScrollAnchor; scrollTop: number } | undefined;
  let queuedDirection: -1 | 1 | undefined;

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
      const onWheel = (event: WheelEvent) => {
        releaseInitialPosition();
        // At the edge, another upward wheel need not produce a scroll event.
        if (event.deltaY < 0 && element.scrollTop <= 0) onScroll();
      };
      element.addEventListener('pointerdown', releaseInitialPosition);
      element.addEventListener('wheel', onWheel, {
        passive: true,
      });
      element.addEventListener('keydown', releaseInitialPosition);
      observeWindows();
      onCleanup(() => {
        observer.disconnect();
        observeWindows = undefined;
        element.removeEventListener('pointerdown', releaseInitialPosition);
        element.removeEventListener('wheel', onWheel);
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
    const target = options.initialPosition;
    const day = findAgendaDayAnchor(
      element,
      target ? new Date(target.date) : date
    );
    if (day)
      element.scrollTop +=
        day.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        (target?.top ?? 0);
    updateActiveWindow(element);
    captureAnchor(element);
  };

  const move = (direction: -1 | 1) => {
    const element = viewport();
    if (!element || interaction) return;
    const day = visibleDay(element);
    if (!day) return;
    const incoming = direction < 0 ? first() - 1 : first() + indices().length;
    if (options.canLoadWindow && !options.canLoadWindow(incoming)) return;
    updateActiveWindow(element);
    const key = day.dataset.agendaDay;
    if (!key) return;
    const targetDate = new Date(key);
    pendingMove = {
      scrollTop: element.scrollTop,
      anchor: {
        top:
          day.getBoundingClientRect().top - element.getBoundingClientRect().top,
        measure: () => {
          const current = findAgendaDayAnchor(element, targetDate);
          return current
            ? current.getBoundingClientRect().top -
                element.getBoundingClientRect().top
            : undefined;
        },
      },
    };
    interaction = beginInteraction('calendar.agenda.load');
    initialPositioning = false;
    setFirst((value) => value + direction);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (pendingMove) restoreScrollAnchor(element, pendingMove.anchor);
      pendingMove = undefined;
      captureAnchor(element);
      updateActiveWindow(element);
      observeWindows?.();
      interaction?.end();
      interaction = undefined;
      const queued = queuedDirection;
      queuedDirection = undefined;
      if (queued === -1 && element.scrollTop < 320) move(-1);
      else if (
        queued === 1 &&
        element.scrollHeight - element.clientHeight - element.scrollTop < 320
      )
        move(1);
    });
  };

  const onScroll = () => {
    const element = viewport();
    if (!element) return;
    updateActiveWindow(element);
    if (interaction) {
      if (pendingMove) {
        // A shorter rotated list can clamp scrollTop without reader input.
        // Otherwise keep movement after the snapshot instead of snapping it back.
        const clamped = isLayoutClamp(element, pendingMove.scrollTop);
        if (!clamped) {
          pendingMove.anchor.top -= element.scrollTop - pendingMove.scrollTop;
        }
        pendingMove.scrollTop = element.scrollTop;
        if (clamped) return;
      }
      if (element.scrollTop < 320) queuedDirection = -1;
      else if (
        element.scrollHeight - element.clientHeight - element.scrollTop <
        320
      )
        queuedDirection = 1;
      return;
    }
    if (initialPositioning && element.scrollTop !== anchoredScrollTop) {
      // Layout shrinkage is not reader intent. Browser find and assistive
      // navigation, however, hand initial positioning over to the reader.
      if (!isLayoutClamp(element, anchoredScrollTop))
        initialPositioning = false;
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

  const capturePosition = (): AgendaViewportPosition | undefined => {
    const element = viewport();
    if (!element) return;
    const day = visibleDay(element);
    const key = day?.dataset.agendaDay;
    if (!day || !key) return;
    return {
      first: first(),
      date: new Date(key).getTime(),
      top:
        day.getBoundingClientRect().top - element.getBoundingClientRect().top,
    };
  };
  return {
    indices,
    activeWindow,
    positionInitial,
    onScroll,
    move,
    capturePosition,
  };
}
