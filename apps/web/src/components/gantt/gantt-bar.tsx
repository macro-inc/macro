import { cn, Layer } from '@ui';
import { createMemo, type JSX, Show, splitProps } from 'solid-js';
import type { GanttCreation } from './create-gantt-creation';
import { createGanttReschedule } from './create-gantt-reschedule';
import { GanttCalendarClip } from './gantt-clip';
import { useGantt } from './gantt-context';
import {
  formatGanttDay,
  type GanttDate,
  ganttBarGeometry,
  ganttDateFromDay,
  toGanttDay,
} from './gantt-date';
import { useGanttDragItem } from './gantt-group-drag';
import type { GanttRescheduleEdge } from './gantt-interaction';
import {
  formatGanttInstant,
  formatGanttTimeRange,
  type GanttTimes,
  ganttTimedBarGeometry,
  toGanttInstant,
} from './gantt-time';

export function GanttBar(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
    start: GanttDate;
    end?: GanttDate;
    deadlineWarning?: boolean;
    /**
     * Draws `start` and `end` as exact instants rather than whole days. A
     * timed bar moves by whole days at week and month zoom, by hours at day
     * zoom and by quarter hours at hours zoom.
     */
    timed?: boolean;
    /**
     * Makes a dated bar draggable to a new range, and its edges resizable:
     * inclusive days, or instants for a timed bar. The bar keeps the dragged
     * range until a returned promise settles.
     */
    onReschedule?: (dates: GanttCreation) => Promise<unknown> | void;
    /**
     * Inside Gantt.DragItem, a drag that starts mostly up or down moves the
     * bar to another group, and one across reschedules it.
     */
    regroup?: boolean;
    /** A CSS color the bar is tinted by: a soft fill and a solid left edge. */
    tint?: string;
    /** Shown at the bar's right end, outside its button, such as markers or a menu button. */
    trailing?: JSX.Element;
    /** Shown over the bar in place of its label while set, such as a name field. */
    editor?: JSX.Element;
  }
) {
  const gantt = useGantt();
  const dragItem = useGanttDragItem();
  let body: HTMLDivElement | undefined;
  const [local, rest] = splitProps(props, [
    'start',
    'end',
    'deadlineWarning',
    'timed',
    'onReschedule',
    'regroup',
    'tint',
    'trailing',
    'editor',
    'class',
    'children',
    'title',
  ]);
  const times = (start: GanttDate, end: GanttDate): GanttTimes | undefined => {
    const first = toGanttInstant(start);
    const last = toGanttInstant(end);
    return first && last && last >= first
      ? { start: first, end: last }
      : undefined;
  };
  const reschedule = createGanttReschedule({
    gantt,
    range: () => {
      if (local.timed) {
        const exact = times(local.start, local.end);
        return exact && { ...exact, allDay: false };
      }
      const start = toGanttDay(local.start);
      const end = toGanttDay(local.end);
      return start !== undefined && end !== undefined && end >= start
        ? {
            start: ganttDateFromDay(start),
            end: ganttDateFromDay(end),
            allDay: true,
          }
        : undefined;
    },
    onReschedule: () => local.onReschedule,
    onVertical: () =>
      local.regroup && dragItem?.canMove()
        ? (origin, event) => {
            if (!body || !dragItem.canMove()) return false;
            dragItem.handOff(origin, event, body);
            return true;
          }
        : undefined,
  });
  const interval = () =>
    reschedule.preview() ?? { start: local.start, end: local.end };
  /** The exact range a timed bar draws; undefined for whole days. */
  const timedRange = () =>
    local.timed ? times(interval().start, interval().end) : undefined;
  const geometry = createMemo(() => {
    const exact = timedRange();
    if (exact)
      return ganttTimedBarGeometry(exact, gantt.range(), gantt.pixelsPerDay());
    const start = toGanttDay(interval().start);
    const end = interval().end;
    const range = gantt.range();
    // An undated interval has an open tail, not an unreachable handle at an infinite horizon.
    const openEnd = Math.max((start ?? range.start) + 7, gantt.today() + 7);
    return ganttBarGeometry(
      { start: interval().start, end },
      end == null || end === ''
        ? { ...range, end: Math.min(range.end, openEnd) }
        : range,
      gantt.pixelsPerDay()
    );
  });
  const placed = () => {
    const value = geometry();
    return 'left' in value ? value : undefined;
  };

  return (
    <Show when={placed()}>
      {(bar) => {
        const dates = () => {
          const exact = timedRange();
          if (exact) return formatGanttTimeRange(exact);
          return `${formatGanttDay(bar().start)} → ${bar().end === undefined ? 'No end date' : formatGanttDay(bar().end!)}`;
        };
        const description = () =>
          `${local.title ?? 'Timeline item'}: ${dates()}`;
        const dragged = () => {
          const exact = timedRange();
          if (exact)
            return `${formatGanttInstant(exact.start)} → ${formatGanttInstant(exact.end)}`;
          return `${formatGanttDay(bar().start)} → ${bar().end === undefined ? '' : formatGanttDay(bar().end!)}`;
        };
        const position = () => ({
          left: `${gantt.labelWidth() + bar().left}px`,
          width: `${bar().width}px`,
        });
        const drawerInset = () =>
          gantt.labelWidth() === 0 && gantt.sidebar.open()
            ? gantt.sidebar.width()
            : 0;
        const deadlineUrgency = () => {
          const end = bar().end;
          if (
            local.deadlineWarning === false ||
            end === undefined ||
            end + 1 > gantt.range().end
          )
            return 0;
          const remaining = Math.floor(end) - gantt.today();
          return Math.min(1, Math.max(0, (8 - remaining) / 8));
        };
        const reschedulable = () =>
          !!local.onReschedule && bar().kind === 'scheduled';
        /** How far into the bar it comes into view, past the drawer. */
        const editorOffset = () =>
          Math.max(
            0,
            (gantt.visibleRange().start - gantt.range().start) *
              gantt.pixelsPerDay() +
              drawerInset() -
              bar().left
          );
        const begin = (event: PointerEvent, edge: GanttRescheduleEdge) => {
          if (reschedulable()) reschedule.begin(event, edge);
        };
        return (
          <div
            data-gantt-bar=""
            data-gantt-start={bar().start}
            data-gantt-end={bar().end}
            data-gantt-timed={timedRange() ? '' : undefined}
            data-gantt-rescheduling={reschedule.dragging() ? '' : undefined}
            class={cn(
              'group pointer-events-none absolute top-1/2 h-7 -translate-y-1/2 text-xs',
              // The drag tooltip below the bar shows over the next rows.
              reschedule.dragging() ? 'z-20' : 'z-10'
            )}
            style={position()}
          >
            <GanttCalendarClip width={bar().width}>
              <Layer depth={2}>
                <div
                  ref={body}
                  data-gantt-bar-body=""
                  class={cn(
                    'group/bar pointer-events-auto relative flex size-full rounded-md text-xs text-ink',
                    reschedule.dragging() && 'ring-1 ring-ink-muted',
                    local.class
                  )}
                  onPointerDown={(event) => begin(event, 'move')}
                  on:click={{
                    capture: true,
                    handleEvent(event: MouseEvent) {
                      if (!reschedule.suppressClick()) return;
                      event.preventDefault();
                      event.stopPropagation();
                    },
                  }}
                >
                  <span
                    aria-hidden="true"
                    data-gantt-bar-fill=""
                    data-gantt-end-warning={
                      deadlineUrgency() > 0
                        ? deadlineUrgency() * 0.35
                        : undefined
                    }
                    class="pointer-events-none absolute inset-0 rounded-[inherit] shadow-sm [--gantt-bar-bg:var(--color-surface)] bg-[color:var(--gantt-bar-bg)] [background-image:var(--gantt-bar-gradient,none)] group-hover/bar:[background-image:linear-gradient(var(--color-hover),var(--color-hover)),var(--gantt-bar-gradient,none)] light-mode:[--gantt-bar-bg:color-mix(in_oklch,var(--color-surface)_92%,var(--color-ink))]"
                    style={{
                      '--gantt-bar-bg': local.tint
                        ? `color-mix(in oklch, ${local.tint} 18%, var(--color-surface))`
                        : undefined,
                      '--gantt-bar-gradient':
                        deadlineUrgency() > 0
                          ? `linear-gradient(to left, color-mix(in oklch, var(--color-failure-ink) ${deadlineUrgency() * 35}%, var(--gantt-bar-bg)), var(--gantt-bar-bg) 65%)`
                          : undefined,
                      'mask-image':
                        bar().kind === 'open-ended'
                          ? 'linear-gradient(to right, black 65%, transparent 100%)'
                          : undefined,
                    }}
                  />
                  <Show when={local.tint}>
                    {(tint) => (
                      <span
                        aria-hidden="true"
                        data-gantt-bar-tint=""
                        class="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-[inherit]"
                        style={{ 'background-color': tint() }}
                      />
                    )}
                  </Show>
                  <button
                    {...rest}
                    type="button"
                    data-gantt-no-drag={reschedulable() ? '' : undefined}
                    title={description()}
                    aria-label={rest['aria-label'] ?? description()}
                    class={cn(
                      'relative h-full min-w-0 flex-1 text-left whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current',
                      local.editor && 'invisible'
                    )}
                  >
                    <span
                      data-gantt-bar-label=""
                      class="sticky flex h-full w-max max-w-full items-center overflow-hidden px-2"
                      style={{
                        left: `${gantt.labelWidth() + drawerInset()}px`,
                      }}
                    >
                      <span class="flex min-w-0 items-center gap-1.5">
                        {local.children}
                      </span>
                    </span>
                  </button>
                  <Show when={local.trailing}>
                    <span class="relative flex max-w-[50%] shrink-0 items-center overflow-hidden">
                      {local.trailing}
                    </span>
                  </Show>
                  <Show when={reschedulable()}>
                    <ResizeHandle
                      edge="start"
                      onPointerDown={(event) => begin(event, 'start')}
                    />
                    <ResizeHandle
                      edge="end"
                      onPointerDown={(event) => begin(event, 'end')}
                    />
                  </Show>
                </div>
              </Layer>
            </GanttCalendarClip>
            <Show when={local.editor}>
              <div
                class="pointer-events-auto absolute inset-y-0 z-30 min-w-48"
                style={{
                  left: `${editorOffset()}px`,
                  width: `${Math.max(0, bar().width - editorOffset())}px`,
                }}
              >
                {local.editor}
              </div>
            </Show>
            <Show when={reschedule.dragging()}>
              <span
                aria-hidden="true"
                class="absolute left-0 top-full mt-1 rounded border border-edge-muted bg-tooltip px-2 py-1 text-xs text-ink whitespace-nowrap"
              >
                {dragged()}
              </span>
            </Show>
          </div>
        );
      }}
    </Show>
  );
}

/** A bar edge that resizes it: wider on touch, where a finger covers more. */
function ResizeHandle(props: {
  edge: 'start' | 'end';
  onPointerDown: (event: PointerEvent) => void;
}) {
  return (
    <span
      aria-hidden="true"
      data-gantt-resize={props.edge}
      class={cn(
        'absolute inset-y-0 z-10 w-2 cursor-ew-resize touch:w-3',
        props.edge === 'start' ? 'left-0' : 'right-0'
      )}
      onPointerDown={props.onPointerDown}
    />
  );
}
