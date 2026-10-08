import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';
import { GanttCalendarClip, GanttCalendarScene } from './gantt-clip';
import { HEADER_HEIGHT, useGantt } from './gantt-context';
import {
  formatGanttDay,
  type GanttDate,
  ganttDateFromDay,
  toGanttDay,
} from './gantt-date';
import { ganttCreationRange } from './gantt-interaction';

export type GanttCreation = { start: Date; end: Date };

/** Hatch unavailable space; available space opens a host-owned composer without writing an entity. */
export function GanttCreateArea(props: {
  onCreate?: (dates: GanttCreation) => void;
  minDate?: GanttDate;
}) {
  const gantt = useGantt();
  const [draft, setDraft] = createSignal<{
    first: number;
    last: number;
    top: number;
  }>();
  let disposeDrag: (() => void) | undefined;
  const unavailableEnd = () =>
    props.onCreate
      ? Math.min(
          toGanttDay(props.minDate) ?? gantt.range().start,
          gantt.range().end
        )
      : gantt.range().end;

  function begin(event: PointerEvent) {
    const viewport = gantt.viewport();
    if (!props.onCreate || !viewport || event.button !== 0 || gantt.editing())
      return;
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.closest(
        'button, a, input, [data-gantt-bar], [data-gantt-label], [data-gantt-header]'
      )
    )
      return;
    const rect = viewport.getBoundingClientRect();
    if (event.clientY < rect.top + HEADER_HEIGHT) return;
    const first = gantt.pointToDay(event.clientX, undefined, false)?.day;
    const minimum = toGanttDay(props.minDate);
    if (first === undefined || (minimum !== undefined && first < minimum))
      return;

    event.preventDefault();
    const pointerId = event.pointerId;
    const initialX = event.clientX;
    const top = event.clientY - rect.top + viewport.scrollTop - 14;
    let last = first;
    let moved = false;
    gantt.setEditing(true);
    gantt.setGuide(undefined);

    const update = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      moved ||= Math.abs(next.clientX - initialX) >= 8;
      const x = Math.max(
        rect.left + gantt.labelWidth(),
        Math.min(next.clientX, rect.right - 1)
      );
      last = Math.max(
        minimum ?? -Infinity,
        gantt.pointToDay(x, undefined, false)?.day ?? last
      );
      if (moved) setDraft({ first, last, top });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', cancelOnEscape, true);
      window.removeEventListener('blur', cancel);
      gantt.setEditing(false);
      setDraft(undefined);
      disposeDrag = undefined;
    };
    const cancel = () => cleanup();
    const cancelOnEscape = (next: KeyboardEvent) => {
      if (next.key !== 'Escape') return;
      next.preventDefault();
      next.stopPropagation();
      cancel();
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      update(next);
      const range = ganttCreationRange(first, last);
      cleanup();
      if (moved)
        props.onCreate?.({
          start: ganttDateFromDay(range.start),
          end: ganttDateFromDay(range.end - 1),
        });
    };
    disposeDrag = cancel;
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', cancelOnEscape, true);
    window.addEventListener('blur', cancel);
  }

  createEffect(
    on(gantt.viewport, (viewport) => {
      viewport?.addEventListener('pointerdown', begin);
      onCleanup(() => {
        viewport?.removeEventListener('pointerdown', begin);
        disposeDrag?.();
      });
    })
  );

  return (
    <>
      <Show when={unavailableEnd() > gantt.range().start}>
        <GanttCalendarScene class="z-0">
          <div
            data-gantt-create-scrim=""
            class="absolute inset-y-0 pattern-ink-muted pattern-diagonal-12 opacity-20"
            style={{
              left: `${gantt.labelWidth()}px`,
              width: `${(unavailableEnd() - gantt.range().start) * gantt.pixelsPerDay()}px`,
            }}
          />
        </GanttCalendarScene>
      </Show>
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
                <div class="size-full rounded-md border border-task bg-task" />
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
    </>
  );
}
