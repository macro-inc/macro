import type { DatesSetArg } from '@fullcalendar/core';
import { createEffect, createMemo, For, on, onCleanup, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { createCalendarLoadingTransition } from '../../calendar/primitives/create-calendar-loading-transition';

const SKELETON_VARIANT_COUNT = 3;
const TITLE_WIDTH_BASE_PERCENT = 50;
const TITLE_WIDTH_STEP_PERCENT = 10;

const TIMED_SKELETON = {
  // Fractions of the rendered time range keep samples inside restricted grids.
  sampleFractions: [0.375, 0.55, 0.69],
  sparseEventCount: 2,
  insetPx: 2,
  minHeightPx: 12,
  detailMinHeightPx: 44,
};

const DAY_GRID_SKELETON = {
  rowHeightPx: 24,
  eventHeightPx: 20,
  topInsetPx: 4,
  fallbackHeaderHeightPx: 28,
};

type SkeletonPlacement = {
  kind: 'timed' | 'bar' | 'text';
  top: number;
  height: number;
  titleWidth: number;
};

type SkeletonTarget = {
  element: HTMLElement;
  kind: 'timed' | 'month' | 'all-day';
  placements: SkeletonPlacement[];
};

function skeletonVariant(date: string | undefined) {
  const dayOfMonthText = date?.slice(-2);
  const dayOfMonth = Number(dayOfMonthText);

  return dayOfMonth % SKELETON_VARIANT_COUNT;
}

function skeletonTitleWidth(index: number, variant: number) {
  const widthVariant = (index + variant) % SKELETON_VARIANT_COUNT;
  const widthOffset = widthVariant * TITLE_WIDTH_STEP_PERCENT;

  return TITLE_WIDTH_BASE_PERCENT + widthOffset;
}

function timedSkeletonTargets(element: HTMLElement): SkeletonTarget[] {
  const slotElements = element.querySelectorAll<HTMLElement>(
    '.fc-timegrid-slot-lane[data-time]'
  );
  const slots = Array.from(slotElements, (slot) =>
    slot.getBoundingClientRect()
  );
  const origin = slots[0]?.top ?? 0;
  const lastSlotIndex = slots.length - 1;

  const frames = element.querySelectorAll<HTMLElement>(
    '.fc-timegrid-col[data-date]:not(.fc-day-disabled) .fc-timegrid-col-frame'
  );

  return Array.from(frames, (frame): SkeletonTarget => {
    const date = frame.closest<HTMLElement>('[data-date]')?.dataset.date ?? '';
    const variant = skeletonVariant(date);

    let samples = TIMED_SKELETON.sampleFractions;

    if (variant === 0) {
      samples = samples.slice(0, TIMED_SKELETON.sparseEventCount);
    }

    const starts = new Set<number>();

    if (slots.length > 0) {
      for (const fraction of samples) {
        const sampleIndex = Math.floor(slots.length * fraction) + variant;
        const startIndex = Math.min(lastSlotIndex, sampleIndex);

        starts.add(startIndex);
      }
    }

    const placements = Array.from(starts, (start, index): SkeletonPlacement => {
      const additionalSlots = (index + variant) % SKELETON_VARIANT_COUNT;
      const endIndex = Math.min(lastSlotIndex, start + additionalSlots);
      const first = slots[start]!;
      const last = slots[endIndex]!;

      const top = first.top - origin + TIMED_SKELETON.insetPx;
      const verticalInset = TIMED_SKELETON.insetPx * 2;
      const availableHeight = last.bottom - first.top - verticalInset;
      const height = Math.max(TIMED_SKELETON.minHeightPx, availableHeight);
      const titleWidth = skeletonTitleWidth(index, variant);

      return { kind: 'timed', top, height, titleWidth };
    });

    return { element: frame, kind: 'timed', placements };
  });
}

function dayGridSkeletonTargets(element: HTMLElement): SkeletonTarget[] {
  const isMonthView = element.querySelector('.fc-dayGridMonth-view') !== null;
  const cells = element.querySelectorAll<HTMLElement>(
    '.fc-daygrid-day[data-date]:not(.fc-day-disabled)'
  );

  return Array.from(cells, (cell): SkeletonTarget => {
    const variant = skeletonVariant(cell.dataset.date);
    const bounds = cell.getBoundingClientRect();
    const header = cell.querySelector('.fc-daygrid-day-top');
    const headerBounds = header?.getBoundingClientRect();

    let top = DAY_GRID_SKELETON.topInsetPx;

    if (isMonthView) {
      let headerHeight = DAY_GRID_SKELETON.fallbackHeaderHeightPx;
      const hasMeasuredHeader = headerBounds && headerBounds.height > 0;

      if (hasMeasuredHeader) {
        headerHeight = headerBounds.bottom - bounds.top;
      }

      top += headerHeight;
    }

    let requestedCount = 0;

    if (isMonthView) {
      requestedCount = 1 + variant;
    } else if (variant !== 0) {
      requestedCount = 1;
    }

    let count = requestedCount;

    if (bounds.height > 0) {
      const availableHeight = bounds.height - top;
      const availableRows = Math.floor(
        availableHeight / DAY_GRID_SKELETON.rowHeightPx
      );
      const rowCapacity = Math.max(0, availableRows);

      count = Math.min(requestedCount, rowCapacity);
    }

    const placements = Array.from(
      { length: count },
      (_, index): SkeletonPlacement => {
        const isTextRow = isMonthView && (index > 0 || variant !== 0);
        const rowOffset = index * DAY_GRID_SKELETON.rowHeightPx;
        const titleWidth = skeletonTitleWidth(index, variant);

        return {
          kind: isTextRow ? 'text' : 'bar',
          top: top + rowOffset,
          height: DAY_GRID_SKELETON.eventHeightPx,
          titleWidth,
        };
      }
    );

    return {
      element: cell,
      kind: isMonthView ? 'month' : 'all-day',
      placements,
    };
  });
}

/** A small, date-stable sample of event shapes, positioned in the live grid. */
function skeletonTargets(element: HTMLElement): SkeletonTarget[] {
  const timedTargets = timedSkeletonTargets(element);
  const dayGridTargets = dayGridSkeletonTargets(element);
  const targets = [...timedTargets, ...dayGridTargets];

  return targets.filter((target) => target.placements.length > 0);
}

function EventSkeleton(props: { placement: SkeletonPlacement }) {
  const isTextRow = () => props.placement.kind === 'text';

  const showDetailLine = () => {
    const isTimedEvent = props.placement.kind === 'timed';
    const hasDetailSpace =
      props.placement.height >= TIMED_SKELETON.detailMinHeightPx;

    return isTimedEvent && hasDetailSpace;
  };

  return (
    <div
      data-calendar-loading-placeholder={props.placement.kind}
      class="absolute inset-x-1.5 overflow-hidden"
      style={{
        top: `${props.placement.top}px`,
        height: `${props.placement.height}px`,
      }}
    >
      <Show
        when={isTextRow()}
        fallback={
          <div class="flex size-full flex-col justify-center gap-1.5 rounded-md bg-skeleton px-1.5 py-1">
            <div
              class="h-2 shrink-0 rounded-sm bg-skeleton"
              style={{ width: `${props.placement.titleWidth}%` }}
            />
            <Show when={showDetailLine()}>
              <div class="h-1.5 w-1/2 shrink-0 rounded-sm bg-skeleton" />
            </Show>
          </div>
        }
      >
        <div class="flex size-full items-center px-1.5">
          <div
            class="h-2 min-w-0 rounded-sm bg-skeleton/70"
            style={{ width: `${props.placement.titleWidth}%` }}
          />
        </div>
      </Show>
    </div>
  );
}

export function CalendarLoadingSkeleton(props: {
  element: HTMLElement | undefined;
  dateInfo: DatesSetArg | undefined;
  loading: boolean;
  disabled: boolean;
  onBlockingChange?: (blocking: boolean) => void;
}) {
  const transition = createCalendarLoadingTransition((phase) => {
    const blocksEventRendering = phase === 'waiting' || phase === 'visible';

    props.onBlockingChange?.(blocksEventRendering);
  });

  const [targets, setTargets] = createStore<SkeletonTarget[]>([]);

  const mounted = createMemo(() => {
    const phase = transition.phase();

    return phase === 'visible' || phase === 'leaving';
  });

  createEffect(
    on(
      () => [props.loading, props.disabled] as const,
      ([loading, disabled]) => {
        if (disabled) {
          transition.reset();
          return;
        }

        if (loading) {
          transition.setLoading(true);
          return;
        }

        // Let FullCalendar finish laying out events before revealing them.
        const timer = setTimeout(() => transition.setLoading(false));

        onCleanup(() => {
          clearTimeout(timer);
        });
      }
    )
  );

  createEffect(
    on(
      () => [props.element, props.dateInfo, mounted()] as const,
      ([element, dateInfo, visible]) => {
        const canMeasure =
          element !== undefined && dateInfo !== undefined && visible;

        if (!canMeasure) {
          setTargets([]);
          return;
        }

        const refresh = () => {
          const isLeaving = transition.phase() === 'leaving';

          if (isLeaving) {
            return;
          }

          // Update placements in place without remounting portals.
          const nextTargets = skeletonTargets(element);
          const updateTargets = reconcile(nextTargets, {
            key: 'element',
            merge: true,
          });

          setTargets(updateTargets);
        };

        refresh();

        let timer: ReturnType<typeof setTimeout> | undefined;

        const observer = new ResizeObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(refresh);
        });

        observer.observe(element);

        const slots = element.querySelector('.fc-timegrid-slots');

        if (slots) {
          observer.observe(slots);
        }

        const cells = element.querySelectorAll(
          '.fc-daygrid-day[data-date]:not(.fc-day-disabled)'
        );

        for (const cell of cells) {
          observer.observe(cell);
        }

        onCleanup(() => {
          observer.disconnect();
          clearTimeout(timer);
        });
      }
    )
  );

  createEffect(
    on(
      () => [props.element, transition.phase()] as const,
      ([element, phase]) => {
        if (!element) {
          return;
        }

        const isRevealingEvents = phase === 'leaving';
        const loadingState = isRevealingEvents ? 'revealing' : phase;

        element.dataset.calendarLoadingState = loadingState;

        onCleanup(() => {
          delete element.dataset.calendarLoadingState;
        });
      }
    )
  );

  return (
    <For each={targets}>
      {(target) => (
        <Portal mount={target.element}>
          <div
            aria-hidden="true"
            data-calendar-loading-skeleton={target.kind}
            data-state={transition.phase()}
            class="pointer-events-none absolute inset-0 z-1 overflow-hidden transition-opacity duration-180 motion-reduce:transition-none"
            classList={{
              'opacity-0': transition.phase() === 'leaving',
              'opacity-100': transition.phase() === 'visible',
            }}
          >
            <For each={target.placements}>
              {(placement) => <EventSkeleton placement={placement} />}
            </For>
          </div>
        </Portal>
      )}
    </For>
  );
}
