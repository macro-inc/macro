import { Show } from 'solid-js';
import {
  createGanttCreation,
  type GanttCreation,
} from './create-gantt-creation';
import { GanttCalendarClip } from './gantt-clip';
import { useGantt } from './gantt-context';
import { formatGanttDay, type GanttDate } from './gantt-date';
import { ganttCreationRange } from './gantt-interaction';

/** Available space opens a host-owned composer without writing an entity. */
export function GanttCreateArea(props: {
  onCreate?: (dates: GanttCreation) => void;
  minDate?: GanttDate;
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
  });

  return (
    <Show when={draft()}>
      {(selection) => {
        const range = () =>
          ganttCreationRange(selection().first, selection().last);
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
              Due {formatGanttDay(range().end - 1)}
            </span>
          </div>
        );
      }}
    </Show>
  );
}
