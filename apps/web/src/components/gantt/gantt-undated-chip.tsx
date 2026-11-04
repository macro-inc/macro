import { cn, Layer } from '@ui';
import { createMemo, type JSX, Show, splitProps } from 'solid-js';
import type { GanttCreation } from './create-gantt-creation';
import { createGanttReschedule } from './create-gantt-reschedule';
import { useGantt } from './gantt-context';
import { formatGanttDay, ganttBarGeometry } from './gantt-date';
import { useGanttDragItem } from './gantt-group-drag';
import {
  formatGanttInstant,
  ganttPlacedRange,
  ganttPosition,
  ganttTimedBarGeometry,
} from './gantt-time';

/** The widest a chip draws, kept clear of the chart's right edge. */
const CHIP_MAX_WIDTH = 224;
const EDGE_GAP = 8;

/**
 * An item without dates: a dashed chip in its row at today, or at the edge
 * of the chart nearest today when today is out of view. Dragging it across
 * gives it dates: the day it is dropped on, or an hour at hours zoom.
 */
export function GanttUndatedChip(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
    /** Writes the dates it is dropped at; the chip shows them until the promise settles. */
    onSchedule?: (dates: GanttCreation) => Promise<unknown> | void;
    /** Inside Gantt.DragItem, a drag that starts mostly up or down moves it to another group. */
    regroup?: boolean;
    /** Shown at the chip's right end, outside its button. */
    trailing?: JSX.Element;
    /** Shown over the chip in place of its label while set, such as a name field. */
    editor?: JSX.Element;
  }
) {
  const gantt = useGantt();
  const dragItem = useGanttDragItem();
  let body: HTMLDivElement | undefined;
  const [local, rest] = splitProps(props, [
    'onSchedule',
    'regroup',
    'trailing',
    'editor',
    'children',
    'class',
  ]);
  const timed = () => gantt.hours() && gantt.scale() === 'hour';
  const drawerInset = () =>
    gantt.labelWidth() === 0 && gantt.sidebar.open()
      ? gantt.sidebar.width()
      : 0;
  /** Where the chip sits: today, or now at hours zoom, kept in view. */
  const anchor = () => {
    const visible = gantt.visibleRange();
    const pixels = gantt.pixelsPerDay();
    const first = visible.start + (drawerInset() + EDGE_GAP) / pixels;
    const last = visible.end - (CHIP_MAX_WIDTH + EDGE_GAP) / pixels;
    const wanted = timed() ? ganttPosition(gantt.now()) : gantt.today();
    return Math.max(first, Math.min(wanted, last));
  };
  const reschedule = createGanttReschedule({
    gantt,
    range: () => ganttPlacedRange(anchor(), timed()),
    onReschedule: () => local.onSchedule,
    onVertical: () =>
      local.regroup && dragItem?.canMove()
        ? (origin, event) => {
            if (!body || !dragItem.canMove()) return false;
            dragItem.handOff(origin, event, body);
            return true;
          }
        : undefined,
  });
  /** The dates a drag would give it, drawn as the bar it would become. */
  const dropped = createMemo(() => {
    const range = reschedule.preview();
    if (!range) return undefined;
    const geometry = range.allDay
      ? ganttBarGeometry(range, gantt.range(), gantt.pixelsPerDay())
      : ganttTimedBarGeometry(range, gantt.range(), gantt.pixelsPerDay());
    if (!('left' in geometry)) return undefined;
    const caption = range.allDay
      ? `${formatGanttDay(geometry.start)} → ${formatGanttDay(geometry.end ?? geometry.start)}`
      : `${formatGanttInstant(range.start)} → ${formatGanttInstant(range.end)}`;
    return { left: geometry.left, width: geometry.width, caption };
  });
  const left = () =>
    gantt.labelWidth() +
    (dropped()?.left ??
      (anchor() - gantt.range().start) * gantt.pixelsPerDay());

  return (
    <div
      data-gantt-undated=""
      class={cn(
        'pointer-events-none absolute top-1/2 h-6 -translate-y-1/2 text-xs',
        reschedule.dragging() ? 'z-20' : 'z-10'
      )}
      style={{
        left: `${left()}px`,
        width: dropped() ? `${dropped()!.width}px` : undefined,
      }}
    >
      <Layer depth={2}>
        <div
          ref={body}
          data-gantt-bar-body=""
          class={cn(
            'pointer-events-auto relative flex h-full items-center rounded-md text-xs border border-dashed border-ink-muted/50 bg-surface/70 text-ink-muted not-touch:hover:border-ink-muted not-touch:hover:text-ink',
            dropped() ? 'w-full' : 'w-max',
            local.class
          )}
          style={{ 'max-width': dropped() ? undefined : `${CHIP_MAX_WIDTH}px` }}
          onPointerDown={(event) => reschedule.begin(event, 'move')}
          on:click={{
            capture: true,
            handleEvent(event: MouseEvent) {
              if (!reschedule.suppressClick()) return;
              event.preventDefault();
              event.stopPropagation();
            },
          }}
        >
          <button
            {...rest}
            type="button"
            data-gantt-no-drag={local.onSchedule ? '' : undefined}
            class="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-[inherit] px-2 text-left whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current"
          >
            {local.children}
          </button>
          <Show when={local.trailing && !dropped()}>
            <span class="flex shrink-0 items-center pr-1">
              {local.trailing}
            </span>
          </Show>
        </div>
      </Layer>
      <Show when={local.editor}>
        <div class="pointer-events-auto absolute inset-y-0 left-0 z-30 w-48">
          {local.editor}
        </div>
      </Show>
      <Show when={dropped()}>
        {(shown) => (
          <span
            aria-hidden="true"
            class="absolute left-0 top-full mt-1 rounded border border-edge-muted bg-tooltip px-2 py-1 text-xs text-ink whitespace-nowrap"
          >
            {shown().caption}
          </span>
        )}
      </Show>
    </div>
  );
}
