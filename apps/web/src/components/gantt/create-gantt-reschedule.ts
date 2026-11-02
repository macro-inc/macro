import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { GanttCreation } from './create-gantt-creation';
import type { GanttContext } from './gantt-context';
import { ganttDateFromDay, toGanttDay } from './gantt-date';
import {
  type GanttRescheduleEdge,
  ganttDragAxis,
  rescheduledGanttDays,
} from './gantt-interaction';
import {
  type GanttTimeSnap,
  ganttTimeSnap,
  rescheduledGanttTimes,
} from './gantt-time';

/** How far a mouse moves before a press becomes a drag. */
const MOUSE_DRAG_DISTANCE = 4;
/** A touch drags only after a still long press; a moving touch scrolls. */
const TOUCH_HOLD_MS = 400;
const TOUCH_SLOP = 8;

/**
 * `range` after dragging `edge` from position `from` to `to`: whole days for
 * an all-day range, and the zoom's step for a timed one.
 */
function rescheduled(
  range: GanttCreation,
  edge: GanttRescheduleEdge,
  from: number,
  to: number,
  snap: GanttTimeSnap
): GanttCreation {
  if (!range.allDay)
    return {
      ...rescheduledGanttTimes(range, edge, from, to, snap),
      allDay: false,
    };
  const start = toGanttDay(range.start);
  const end = toGanttDay(range.end);
  if (start === undefined || end === undefined) return range;
  const days = rescheduledGanttDays(
    { start, end },
    edge,
    Math.round(to - from)
  );
  return {
    start: ganttDateFromDay(days.start),
    end: ganttDateFromDay(days.end),
    allDay: true,
  };
}

/**
 * Owns one bar's move and edge-resize gesture. The bar shows the dragged
 * range until the host's write settles, so it does not jump back while saving.
 */
export function createGanttReschedule(options: {
  gantt: GanttContext;
  /** The bar's range, all-day days inclusive; undefined when it cannot be rescheduled. */
  range: Accessor<GanttCreation | undefined>;
  onReschedule: Accessor<
    ((dates: GanttCreation) => Promise<unknown> | void) | undefined
  >;
  /**
   * Offered a mouse drag that starts mostly up or down, from where the press
   * began; returning true hands the gesture over, as to a move between
   * groups. Without it, only moving across starts a drag.
   */
  onVertical?: Accessor<
    | ((origin: { x: number; y: number }, event: PointerEvent) => boolean)
    | undefined
  >;
}) {
  const gantt = options.gantt;
  const [preview, setPreview] = createSignal<GanttCreation>();
  const [dragging, setDragging] = createSignal(false);
  let suppressClick = false;
  let clickTimeout: ReturnType<typeof setTimeout> | undefined;
  let cancelGesture: (() => void) | undefined;
  onCleanup(() => {
    clearTimeout(clickTimeout);
    cancelGesture?.();
  });

  function begin(event: PointerEvent, edge: GanttRescheduleEdge) {
    const range = options.range();
    const reschedule = options.onReschedule();
    if (!range || !reschedule || event.button !== 0 || gantt.editing()) return;
    const first = gantt.pointToDay(event.clientX, undefined, false)?.day;
    if (first === undefined) return;
    event.stopPropagation();
    const touch = event.pointerType === 'touch';
    if (!touch) event.preventDefault();

    const pointerId = event.pointerId;
    const initialX = event.clientX;
    const initialY = event.clientY;
    let active = false;
    let finished = false;
    let shown = range;
    const snap = ganttTimeSnap(gantt.scale());
    const holdTimeout = touch
      ? setTimeout(() => activate(), TOUCH_HOLD_MS)
      : undefined;

    function activate() {
      if (finished || active) return;
      active = true;
      suppressClick = true;
      clearTimeout(clickTimeout);
      gantt.setGuide(undefined);
      gantt.setEditing(true);
      setDragging(true);
      setPreview(range);
    }
    const update = (next: PointerEvent) => {
      if (finished || next.pointerId !== pointerId) return;
      if (!active) {
        const distance = Math.hypot(
          next.clientX - initialX,
          next.clientY - initialY
        );
        if (touch) {
          if (distance > TOUCH_SLOP) cancel();
          return;
        }
        const vertical = options.onVertical?.();
        if (!vertical) {
          if (Math.abs(next.clientX - initialX) < MOUSE_DRAG_DISTANCE) return;
        } else {
          const axis = ganttDragAxis(
            next.clientX - initialX,
            next.clientY - initialY,
            MOUSE_DRAG_DISTANCE
          );
          if (!axis) return;
          if (
            axis === 'vertical' &&
            vertical({ x: initialX, y: initialY }, next)
          ) {
            cancel();
            return;
          }
        }
        activate();
      }
      const day = gantt.pointToDay(next.clientX, undefined, false)?.day;
      if (day === undefined) return;
      shown = rescheduled(range, edge, first, day, snap);
      setPreview(shown);
    };
    // A held touch owns the gesture: the page does not scroll under it.
    const holdTouch = (next: TouchEvent) => {
      if (active && !finished) next.preventDefault();
    };
    function stop() {
      finished = true;
      clearTimeout(holdTimeout);
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', cancelOnEscape, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('touchmove', holdTouch);
      cancelGesture = undefined;
      if (active) {
        gantt.setEditing(false);
        setDragging(false);
        // The click that ends a drag must not open the item.
        clickTimeout = setTimeout(() => {
          suppressClick = false;
        }, 0);
      }
    }
    function cancel() {
      if (finished) return;
      stop();
      setPreview(undefined);
    }
    const cancelOnEscape = (next: KeyboardEvent) => {
      if (finished || next.key !== 'Escape') return;
      next.preventDefault();
      next.stopPropagation();
      cancel();
    };
    const finish = (next: PointerEvent) => {
      if (finished || next.pointerId !== pointerId) return;
      if (active) update(next);
      const moved =
        active &&
        (shown.start.getTime() !== range.start.getTime() ||
          shown.end.getTime() !== range.end.getTime());
      stop();
      if (!moved) {
        setPreview(undefined);
        return;
      }
      const target = shown;
      const written = reschedule(target);
      if (!written) {
        setPreview(undefined);
        return;
      }
      fireAndForget(
        (async () => {
          try {
            await written;
          } finally {
            // A later drag replaced this one's preview; leave it.
            if (preview() === target) setPreview(undefined);
          }
        })(),
        'gantt-reschedule'
      );
    };

    cancelGesture = cancel;
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', cancelOnEscape, true);
    window.addEventListener('blur', cancel);
    if (touch)
      window.addEventListener('touchmove', holdTouch, { passive: false });
  }

  return {
    preview,
    dragging,
    begin,
    suppressClick: () => suppressClick,
  };
}
