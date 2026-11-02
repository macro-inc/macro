import { Show } from 'solid-js';
import {
  createGanttCreation,
  type GanttCreation,
} from './create-gantt-creation';
import { GanttCalendarClip } from './gantt-clip';
import { useGantt } from './gantt-context';
import { formatGanttDay, type GanttDate, type GanttRange } from './gantt-date';
import { ganttCreationRange } from './gantt-interaction';
import {
  formatGanttTimeRange,
  ganttPosition,
  ganttTimedCreation,
} from './gantt-time';

/**
 * Available space opens a host-owned composer without writing an entity. At
 * hours zoom on a chart showing hours, the drawn range is timed, in quarter
 * hours.
 */
export function GanttCreateArea(props: {
  onCreate?: (dates: GanttCreation) => void;
  minDate?: GanttDate;
  /** An all-day selection's caption, from its days with an exclusive end; a due date by default. */
  hint?: (range: GanttRange) => string;
}) {
  const gantt = useGantt();
  const { draft } = createGanttCreation({
    viewport: gantt.viewport,
    editing: gantt.editing,
    setEditing: gantt.setEditing,
    clearGuide: () => gantt.setGuide(undefined),
    labelWidth: gantt.labelWidth,
    pointToDay: gantt.pointToDay,
    onCreate: () => props.onCreate,
    minDate: () => props.minDate,
    timed: () => gantt.hours() && gantt.scale() === 'hour',
  });

  return (
    <Show when={draft()}>
      {(selection) => {
        const times = () =>
          selection().timed
            ? ganttTimedCreation(selection().first, selection().last)
            : undefined;
        const range = () => {
          const exact = times();
          return exact
            ? {
                start: ganttPosition(exact.start),
                end: ganttPosition(exact.end),
              }
            : ganttCreationRange(selection().first, selection().last);
        };
        const caption = () => {
          const exact = times();
          if (exact) return formatGanttTimeRange(exact);
          return (
            props.hint?.(range()) ?? `Due ${formatGanttDay(range().end - 1)}`
          );
        };
        return (
          <div
            aria-hidden="true"
            class="pointer-events-none absolute z-10 h-7"
            style={{
              top: `${selection().top}px`,
              left: `${gantt.labelWidth() + (range().start - gantt.range().start) * gantt.pixelsPerDay()}px`,
              width: `${(range().end - range().start) * gantt.pixelsPerDay()}px`,
              transform: 'translateZ(0)',
            }}
          >
            <GanttCalendarClip
              width={(range().end - range().start) * gantt.pixelsPerDay()}
            >
              <div class="size-full rounded-md border border-ink-muted bg-[color-mix(in_oklch,var(--color-ink)_18%,var(--color-panel))]" />
            </GanttCalendarClip>
            <span
              class="absolute right-0 top-full mt-1 overflow-hidden rounded border border-edge-muted bg-tooltip px-2 py-1 text-xs text-ink whitespace-nowrap"
              style={{
                'max-width': `${Math.max(0, (gantt.visibleRange().end - gantt.visibleRange().start) * gantt.pixelsPerDay() - 16)}px`,
                translate: `clamp(calc(${(gantt.visibleRange().start - range().end) * gantt.pixelsPerDay() + 8}px + 100%), 0px, ${(gantt.visibleRange().end - range().end) * gantt.pixelsPerDay() - 8}px) 0`,
              }}
            >
              {caption()}
            </span>
          </div>
        );
      }}
    </Show>
  );
}
