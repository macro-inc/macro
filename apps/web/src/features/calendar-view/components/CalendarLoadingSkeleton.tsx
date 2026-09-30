import type { DatesSetArg } from '@fullcalendar/core';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { createCalendarLoadingTransition } from '../../calendar/primitives/create-calendar-loading-transition';

type SkeletonPlacement = {
  kind: 'timed' | 'bar' | 'dot';
  top: number;
  height: number;
  titleWidth: number;
  time?: string;
};

type SkeletonTarget = {
  element: HTMLElement;
  kind: 'timed' | 'month' | 'all-day';
  placements: SkeletonPlacement[];
};

/** Keep representative event shapes stable through loading, resizing, and paging. */
function dateSeed(date: string) {
  let seed = 2166136261;
  for (const character of date) {
    seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  }
  return seed >>> 0;
}

/** Place decorations in the real grid without inserting synthetic calendar events. */
function skeletonTargets(element: HTMLElement): SkeletonTarget[] {
  const slots = Array.from(
    element.querySelectorAll<HTMLElement>('.fc-timegrid-slot-lane[data-time]')
  );
  const origin = slots[0]?.getBoundingClientRect().top ?? 0;
  const rows = slots.map((slot) => {
    const bounds = slot.getBoundingClientRect();
    const time = slot.dataset.time ?? '';
    const [hour, minute] = time.split(':').map(Number);
    return {
      time,
      minute: hour * 60 + minute,
      top: bounds.top - origin,
      height: bounds.height,
    };
  });
  const timed = Array.from(
    element.querySelectorAll<HTMLElement>(
      '.fc-timegrid-col[data-date]:not(.fc-day-disabled) .fc-timegrid-col-frame'
    )
  ).map((frame): SkeletonTarget => {
    const date = frame.closest<HTMLElement>('[data-date]')?.dataset.date ?? '';
    const seed = dateSeed(date);
    const windows = [
      { start: 540 + (seed % 4) * 30, duration: 30 + ((seed >>> 2) % 3) * 30 },
      {
        start: 780 + ((seed >>> 5) % 3) * 30,
        duration: 30 + ((seed >>> 7) % 3) * 30,
      },
      ...(seed % 3 === 0
        ? []
        : [{ start: 960 + ((seed >>> 10) % 2) * 30, duration: 60 }]),
    ];
    const placements = windows.flatMap((window, index): SkeletonPlacement[] => {
      const coveredRows = rows.filter(
        (row) =>
          row.minute >= window.start &&
          row.minute < window.start + window.duration
      );
      const first = coveredRows[0];
      const last = coveredRows.at(-1);
      if (!first || !last) return [];
      return [
        {
          kind: 'timed',
          time: first.time,
          top: first.top + 2,
          height: Math.max(12, last.top + last.height - first.top - 4),
          titleWidth: 50 + ((seed >>> (index * 3)) % 30),
        },
      ];
    });
    // Restricted time grids still get feedback when the sample hours are outside the range.
    if (placements.length === 0 && rows.length > 0) {
      const first = rows[Math.floor(rows.length / 3)]!;
      const last =
        rows[Math.min(rows.length - 1, Math.floor(rows.length / 3) + 1)]!;
      placements.push({
        kind: 'timed',
        time: first.time,
        top: first.top + 2,
        height: Math.max(12, last.top + last.height - first.top - 4),
        titleWidth: 65,
      });
    }
    return { element: frame, kind: 'timed', placements };
  });
  const month = element.querySelector('.fc-dayGridMonth-view') !== null;
  const days = Array.from(
    element.querySelectorAll<HTMLElement>(
      '.fc-daygrid-day[data-date]:not(.fc-day-disabled) .fc-daygrid-day-frame'
    )
  ).map((frame): SkeletonTarget => {
    // The cell remains positioned even when FullCalendar makes its frame display: contents.
    const cell = frame.closest<HTMLElement>('.fc-daygrid-day')!;
    const seed = dateSeed(cell.dataset.date ?? '');
    const bounds = cell.getBoundingClientRect();
    const header = frame
      .querySelector('.fc-daygrid-day-top')
      ?.getBoundingClientRect();
    const top = month
      ? (header && header.height > 0 ? header.bottom - bounds.top : 28) + 4
      : 4;
    const requestedCount = month
      ? 1 + ((seed >>> 3) % 3)
      : seed % 3 === 0
        ? 0
        : 1;
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
        // All-day/multi-day entries use bars. Single-day timed entries use dot rows in Month.
        kind: month && (index > 0 || seed % 3 !== 0) ? 'dot' : 'bar',
        top: top + index * 24,
        height: 20,
        titleWidth: 50 + ((seed >>> (index * 3)) % 30),
      })
    );
    return { element: cell, kind: month ? 'month' : 'all-day', placements };
  });
  return [...timed, ...days].filter((target) => target.placements.length > 0);
}

/** Keep portal nodes stable when an observer reports unchanged geometry. */
function sameTargets(previous: SkeletonTarget[], next: SkeletonTarget[]) {
  return (
    previous.length === next.length &&
    previous.every((target, index) => {
      const other = next[index];
      return (
        target.element === other.element &&
        target.kind === other.kind &&
        target.placements.length === other.placements.length &&
        target.placements.every((placement, placementIndex) => {
          const nextPlacement = other.placements[placementIndex];
          return (
            placement.kind === nextPlacement.kind &&
            placement.time === nextPlacement.time &&
            placement.top === nextPlacement.top &&
            placement.height === nextPlacement.height &&
            placement.titleWidth === nextPlacement.titleWidth
          );
        })
      );
    })
  );
}

function EventSkeleton(props: { placement: SkeletonPlacement }) {
  return (
    <div
      data-calendar-loading-placeholder={props.placement.kind}
      data-calendar-loading-time={props.placement.time}
      class="absolute inset-x-1.5 overflow-hidden"
      style={{
        top: `${props.placement.top}px`,
        height: `${props.placement.height}px`,
      }}
    >
      <Show
        when={props.placement.kind === 'dot'}
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

/** Representative skeletons only: query readiness still owns the real event content. */
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
  const [targets, setTargets] = createSignal<SkeletonTarget[]>([]);
  // Stable presence keeps the same portal nodes through the fade-out phase.
  const mounted = createMemo(
    () => transition.phase() === 'visible' || transition.phase() === 'leaving'
  );

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
        // Commit real event layout before starting the skeleton-to-events handoff.
        const completionTimer = setTimeout(
          () => transition.setLoading(false),
          0
        );
        onCleanup(() => clearTimeout(completionTimer));
      }
    )
  );

  // FullCalendar owns these DOM cells. Follow its columns, headers, and scroll position.
  createEffect(
    on(
      () => [props.element, props.dateInfo, mounted()] as const,
      ([element, dateInfo, visible]) => {
        if (!element || !dateInfo || !visible) {
          setTargets([]);
          return;
        }
        const refresh = () => {
          // Keep the outgoing nodes intact if real events resize Month rows during the fade.
          if (transition.phase() === 'leaving') return;
          const next = skeletonTargets(element);
          setTargets((previous) =>
            sameTargets(previous, next) ? previous : next
          );
        };
        refresh();
        let resizeTimer: ReturnType<typeof setTimeout> | undefined;
        const observer = new ResizeObserver(() => {
          clearTimeout(resizeTimer);
          resizeTimer = setTimeout(refresh, 0);
        });
        observer.observe(element);
        const slots = element.querySelector('.fc-timegrid-slots');
        if (slots) observer.observe(slots);
        // Event layout can resize Month rows without changing the host dimensions.
        for (const cell of element.querySelectorAll(
          '.fc-daygrid-day[data-date]:not(.fc-day-disabled)'
        )) {
          observer.observe(cell);
        }
        onCleanup(() => {
          observer.disconnect();
          clearTimeout(resizeTimer);
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
    <For each={targets()}>
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
