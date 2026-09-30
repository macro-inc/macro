import type { DatesSetArg } from '@fullcalendar/core';
import { createEffect, createMemo, For, on, onCleanup, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { Portal } from 'solid-js/web';
import { createCalendarLoadingTransition } from '../../calendar/primitives/create-calendar-loading-transition';

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

/** A small, date-stable sample of event shapes, positioned in the live grid. */
function skeletonTargets(element: HTMLElement): SkeletonTarget[] {
  const slots = Array.from(
    element.querySelectorAll<HTMLElement>('.fc-timegrid-slot-lane[data-time]'),
    (slot) => slot.getBoundingClientRect()
  );
  const origin = slots[0]?.top ?? 0;
  const timed = Array.from(
    element.querySelectorAll<HTMLElement>(
      '.fc-timegrid-col[data-date]:not(.fc-day-disabled) .fc-timegrid-col-frame'
    )
  ).map((frame): SkeletonTarget => {
    const date = frame.closest<HTMLElement>('[data-date]')?.dataset.date ?? '';
    const variant = Number(date.slice(-2)) % 3;
    const samples = variant === 0 ? [0.375, 0.55] : [0.375, 0.55, 0.69];
    const starts = slots.length
      ? [
          ...new Set(
            samples.map((fraction) =>
              Math.min(
                slots.length - 1,
                Math.floor(slots.length * fraction) + variant
              )
            )
          ),
        ]
      : [];
    const placements = starts.map((start, index): SkeletonPlacement => {
      const first = slots[start]!;
      const last =
        slots[Math.min(slots.length - 1, start + ((index + variant) % 3))]!;
      return {
        kind: 'timed',
        top: first.top - origin + 2,
        height: Math.max(12, last.bottom - first.top - 4),
        titleWidth: 50 + ((index + variant) % 3) * 10,
      };
    });
    return { element: frame, kind: 'timed', placements };
  });
  const month = element.querySelector('.fc-dayGridMonth-view') !== null;
  const days = Array.from(
    element.querySelectorAll<HTMLElement>(
      '.fc-daygrid-day[data-date]:not(.fc-day-disabled)'
    )
  ).map((cell): SkeletonTarget => {
    const variant = Number(cell.dataset.date?.slice(-2)) % 3;
    const bounds = cell.getBoundingClientRect();
    const header = cell
      .querySelector('.fc-daygrid-day-top')
      ?.getBoundingClientRect();
    const top = month
      ? (header && header.height > 0 ? header.bottom - bounds.top : 28) + 4
      : 4;
    const requestedCount = month ? 1 + variant : variant === 0 ? 0 : 1;
    const count =
      bounds.height > 0
        ? Math.min(
            requestedCount,
            Math.max(0, Math.floor((bounds.height - top) / 24))
          )
        : requestedCount;
    const placements = Array.from(
      { length: count },
      (_, index): SkeletonPlacement => ({
        kind: month && (index > 0 || variant !== 0) ? 'text' : 'bar',
        top: top + index * 24,
        height: 20,
        titleWidth: 50 + ((index + variant) % 3) * 10,
      })
    );
    return { element: cell, kind: month ? 'month' : 'all-day', placements };
  });
  return [...timed, ...days].filter((target) => target.placements.length > 0);
}

function EventSkeleton(props: { placement: SkeletonPlacement }) {
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
        when={props.placement.kind === 'text'}
        fallback={
          <div class="flex size-full flex-col justify-center gap-1.5 rounded-md bg-skeleton px-1.5 py-1">
            <div
              class="h-2 shrink-0 rounded-sm bg-skeleton"
              style={{ width: `${props.placement.titleWidth}%` }}
            />
            <Show
              when={
                props.placement.kind === 'timed' && props.placement.height >= 44
              }
            >
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
  const transition = createCalendarLoadingTransition((phase) =>
    props.onBlockingChange?.(phase === 'waiting' || phase === 'visible')
  );
  const [targets, setTargets] = createStore<SkeletonTarget[]>([]);
  const mounted = createMemo(
    () => transition.phase() === 'visible' || transition.phase() === 'leaving'
  );

  createEffect(
    on(
      () => [props.loading, props.disabled] as const,
      ([loading, disabled]) => {
        if (disabled) {
          transition.reset();
        } else if (loading) {
          transition.setLoading(true);
        } else {
          // Let FullCalendar finish laying out events before revealing them.
          const timer = setTimeout(() => transition.setLoading(false), 0);
          onCleanup(() => clearTimeout(timer));
        }
      }
    )
  );

  createEffect(
    on(
      () => [props.element, props.dateInfo, mounted()] as const,
      ([element, dateInfo, visible]) => {
        if (!element || !dateInfo || !visible) {
          setTargets([]);
          return;
        }
        const refresh = () => {
          if (transition.phase() === 'leaving') return;
          // Reconcile by DOM cell and update placements in place, without remounting portals.
          setTargets(
            reconcile(skeletonTargets(element), { key: 'element', merge: true })
          );
        };
        refresh();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const observer = new ResizeObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(refresh, 0);
        });
        observer.observe(element);
        const slots = element.querySelector('.fc-timegrid-slots');
        if (slots) observer.observe(slots);
        for (const cell of element.querySelectorAll(
          '.fc-daygrid-day[data-date]:not(.fc-day-disabled)'
        )) {
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
        if (!element) return;
        element.dataset.calendarLoadingState =
          phase === 'leaving' ? 'revealing' : phase;
        onCleanup(() => delete element.dataset.calendarLoadingState);
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
