import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { HEADER_HEIGHT } from './gantt-context';
import { type GanttDate, ganttDateFromDay, toGanttDay } from './gantt-date';
import { type GanttGuide, ganttCreationRange } from './gantt-interaction';

export type GanttCreation = { start: Date; end: Date };

/** Owns selection and pointer listeners; only a completed gesture opens the host composer. */
export function createGanttCreation(options: {
  viewport: Accessor<HTMLDivElement | undefined>;
  editing: Accessor<boolean>;
  setEditing: (editing: boolean) => void;
  clearGuide: () => void;
  labelWidth: Accessor<number>;
  pointToDay: (
    clientX: number,
    exclude?: HTMLElement,
    snap?: boolean
  ) => GanttGuide | undefined;
  onCreate: Accessor<((dates: GanttCreation) => void) | undefined>;
  minDate: Accessor<GanttDate>;
}) {
  const [draft, setDraft] = createSignal<{
    first: number;
    last: number;
    top: number;
  }>();
  let cancelGesture: (() => void) | undefined;

  function begin(event: PointerEvent) {
    const viewport = options.viewport();
    if (
      !options.onCreate() ||
      !viewport ||
      event.button !== 0 ||
      options.editing()
    )
      return;

    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(
        'button, a, input, [data-gantt-bar], [data-gantt-label], [data-gantt-header], [data-gantt-group-header], [data-gantt-pagination]'
      )
    )
      return;

    const rect = viewport.getBoundingClientRect();
    if (event.clientY < rect.top + HEADER_HEIGHT) return;
    const first = options.pointToDay(event.clientX, undefined, false)?.day;
    const minimum = toGanttDay(options.minDate());
    if (first === undefined || (minimum !== undefined && first < minimum))
      return;

    event.preventDefault();
    const pointerId = event.pointerId;
    const initialX = event.clientX;
    const top = event.clientY - rect.top + viewport.scrollTop - 14;
    let last = first;
    let moved = false;
    let finished = false;
    options.setEditing(true);
    options.clearGuide();

    const update = (next: PointerEvent) => {
      if (finished || next.pointerId !== pointerId) return;
      moved ||= Math.abs(next.clientX - initialX) >= 8;
      const x = Math.max(
        rect.left + options.labelWidth(),
        Math.min(next.clientX, rect.right - 1)
      );
      last = Math.max(
        minimum ?? -Infinity,
        options.pointToDay(x, undefined, false)?.day ?? last
      );
      if (moved) setDraft({ first, last, top });
    };
    const cancel = () => {
      // Cancellation also invalidates callbacks already queued for this gesture.
      if (finished) return;
      finished = true;
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', cancelOnEscape, true);
      window.removeEventListener('blur', cancel);
      options.setEditing(false);
      setDraft(undefined);
      cancelGesture = undefined;
    };
    const cancelOnEscape = (next: KeyboardEvent) => {
      if (finished || next.key !== 'Escape') return;
      next.preventDefault();
      next.stopPropagation();
      cancel();
    };
    const finish = (next: PointerEvent) => {
      if (finished || next.pointerId !== pointerId) return;
      update(next);
      const range = ganttCreationRange(first, last);
      cancel();
      if (moved)
        options.onCreate()?.({
          start: ganttDateFromDay(range.start),
          end: ganttDateFromDay(range.end - 1),
        });
    };

    cancelGesture = cancel;
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', cancelOnEscape, true);
    window.addEventListener('blur', cancel);
  }

  createEffect(
    on(options.viewport, (viewport) => {
      viewport?.addEventListener('pointerdown', begin);
      onCleanup(() => {
        viewport?.removeEventListener('pointerdown', begin);
        cancelGesture?.();
      });
    })
  );

  return { draft };
}
