import { cn } from '@ui';
import {
  createMemo,
  createSignal,
  type JSX,
  onCleanup,
  Show,
  splitProps,
} from 'solid-js';
import { GanttCalendarClip } from './gantt-clip';
import { useGantt } from './gantt-context';
import {
  formatGanttDay,
  type GanttDate,
  ganttBarGeometry,
  ganttDateFromDay,
  toGanttDay,
} from './gantt-date';
import { ganttResizePreview } from './gantt-interaction';

/** Data writes stay with the consumer; the bar owns only resize previews and cancellation. */
export function GanttBar(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
    start: GanttDate;
    end?: GanttDate;
    onEndChange?: (date: Date) => Promise<void>;
  }
) {
  const gantt = useGantt();
  const [local, rest] = splitProps(props, [
    'start',
    'end',
    'onEndChange',
    'class',
    'children',
    'title',
  ]);
  const [draft, setDraft] =
    createSignal<ReturnType<typeof ganttResizePreview>>();
  const [saving, setSaving] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let container: HTMLDivElement | undefined;
  let disposeDrag: (() => void) | undefined;
  let alive = true;
  const geometry = createMemo(() => {
    const start = toGanttDay(local.start);
    const end =
      draft() === undefined ? local.end : ganttDateFromDay(draft()!.end);
    const range = gantt.range();
    // An undated interval has an open tail, not an unreachable handle at an infinite horizon.
    const openEnd = Math.max(
      (start ?? range.start) + 7,
      toGanttDay(new Date())! + 7
    );
    return ganttBarGeometry(
      { start: local.start, end },
      end == null || end === ''
        ? { ...range, end: Math.min(range.end, openEnd) }
        : range,
      gantt.pixelsPerDay()
    );
  });
  const placed = () => {
    const value = geometry();
    if (!('left' in value)) return;
    const preview = draft();
    if (!preview) return value;
    // Follow fractional pointer positions; Due Date remains a calendar-day property.
    return {
      ...value,
      width:
        (Math.min(preview.boundary, gantt.range().end) -
          Math.max(value.start, gantt.range().start)) *
        gantt.pixelsPerDay(),
    };
  };

  onCleanup(() => {
    alive = false;
    disposeDrag?.();
  });

  async function save(end: number, boundary = end + 1) {
    const callback = local.onEndChange;
    if (!callback || saving()) return;
    setDraft({ boundary, end });
    setSaving(true);
    setFailed(false);
    try {
      if (
        !alive ||
        !local.onEndChange ||
        rest.disabled ||
        toGanttDay(local.end) === end
      )
        return;
      await callback(ganttDateFromDay(end));
    } catch {
      if (alive) setFailed(true);
    } finally {
      if (alive) {
        setDraft(undefined);
        setSaving(false);
      }
    }
  }

  function beginResize(event: PointerEvent) {
    if (
      event.button !== 0 ||
      !local.onEndChange ||
      rest.disabled ||
      saving() ||
      gantt.editing()
    )
      return;
    const start = toGanttDay(local.start);
    if (start === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLButtonElement).focus({ preventScroll: true });
    const pointerId = event.pointerId;
    const initialX = event.clientX;
    const pointerOffset = container
      ? container.getBoundingClientRect().right - initialX
      : 0;
    let x = initialX;
    let moved = false;
    let frame = 0;
    gantt.setEditing(true);
    gantt.setGuide(undefined);
    setFailed(false);

    const preview = () => {
      const viewport = gantt.viewport();
      if (!viewport) return;
      const box = viewport.getBoundingClientRect();
      const clientX = Math.max(
        box.left + gantt.labelWidth() + 1,
        Math.min(x + pointerOffset, box.right - 1)
      );
      const point = gantt.pointToDay(clientX, container, false);
      if (!point) return;
      setDraft(ganttResizePreview(start, point.day));
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      x = next.clientX;
      moved ||= Math.abs(x - initialX) >= 2;
      if (moved) preview();
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', cancelOnEscape, true);
      window.removeEventListener('blur', cancel);
      gantt.setEditing(false);
      gantt.setGuide(undefined);
      disposeDrag = undefined;
    };
    const cancel = () => {
      cleanup();
      setDraft(undefined);
    };
    const cancelOnEscape = (next: KeyboardEvent) => {
      if (next.key !== 'Escape') return;
      next.preventDefault();
      next.stopPropagation();
      cancel();
    };
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      x = next.clientX;
      if (moved) preview();
      const end = draft()?.end;
      cleanup();
      if (!moved || end === undefined || !local.onEndChange || rest.disabled) {
        setDraft(undefined);
        return;
      }
      void save(end, draft()?.boundary);
    };
    const scroll = () => {
      const viewport = gantt.viewport();
      if (viewport && moved) {
        const box = viewport.getBoundingClientRect();
        const left = box.left + gantt.labelWidth();
        const speed =
          x < left + 40
            ? -Math.min(12, (left + 40 - x) / 4)
            : x > box.right - 40
              ? Math.min(12, (x - box.right + 40) / 4)
              : 0;
        if (speed) {
          viewport.scrollLeft = Math.max(0, viewport.scrollLeft + speed);
          gantt.updateViewport();
          preview();
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    disposeDrag = cancel;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', cancelOnEscape, true);
    window.addEventListener('blur', cancel);
    frame = requestAnimationFrame(scroll);
  }

  function resizeByKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const start = toGanttDay(local.start);
    if (
      start === undefined ||
      !local.onEndChange ||
      rest.disabled ||
      saving() ||
      gantt.editing()
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const end =
      toGanttDay(local.end) ?? Math.max(start, toGanttDay(new Date())!);
    const delta =
      (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 7 : 1);
    void save(Math.max(start, end + delta));
  }

  return (
    <Show when={placed()}>
      {(bar) => {
        const description = () =>
          `${local.title ?? 'Timeline item'}: ${formatGanttDay(bar().start)} → ${bar().end === undefined ? 'No end date' : formatGanttDay(bar().end!)}${failed() ? '. Could not save end date' : ''}`;
        const edgeDay = () =>
          gantt.range().start +
          (bar().left + bar().width) / gantt.pixelsPerDay();
        return (
          <div
            ref={container}
            data-gantt-bar=""
            data-gantt-start={bar().start}
            data-gantt-end={bar().end}
            class={cn(
              'group pointer-events-none absolute top-1/2 z-10 h-7 -translate-y-1/2 text-xs',
              draft() !== undefined && 'z-50',
              saving() && 'opacity-60'
            )}
            style={{
              left: `${gantt.labelWidth() + bar().left}px`,
              width: `${bar().width}px`,
              color:
                'oklch(from var(--color-task) clamp(0, calc((0.6 - l) * 1000), 1) 0 0)',
            }}
          >
            <GanttCalendarClip width={bar().width}>
              <div
                data-gantt-bar-body=""
                class={cn(
                  'pointer-events-auto relative size-full rounded-md border border-task bg-task hover:overlay-hover',
                  bar().kind === 'open-ended' && 'border-dashed border-current',
                  failed() && 'ring-1 ring-failure-ink',
                  local.class
                )}
              >
                <button
                  {...rest}
                  type="button"
                  title={description()}
                  aria-label={rest['aria-label'] ?? description()}
                  class={cn(
                    'h-full w-full overflow-hidden text-left whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current',
                    bar().width >= 32 ? 'px-2' : 'px-0'
                  )}
                >
                  <Show when={bar().width >= 32}>{local.children}</Show>
                </button>
                <Show when={local.onEndChange && !rest.disabled}>
                  <button
                    type="button"
                    aria-label={`Resize end date for ${local.title ?? 'timeline item'}`}
                    title="Resize end date · Arrow keys change one day, Shift changes one week"
                    disabled={saving()}
                    class="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize touch-none border-l border-current opacity-0 outline-none group-hover:opacity-100 focus:opacity-100"
                    onPointerDown={beginResize}
                    onKeyDown={resizeByKey}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                  />
                </Show>
                <Show when={failed()}>
                  <span role="alert" class="sr-only">
                    Could not save end date
                  </span>
                </Show>
              </div>
            </GanttCalendarClip>
            <Show when={draft()}>
              {(preview) => (
                <span
                  role="status"
                  class="pointer-events-none absolute right-0 top-full mt-1 overflow-hidden rounded border border-edge-muted bg-tooltip px-2 py-1 text-xs font-medium text-ink shadow-sm whitespace-nowrap"
                  style={{
                    'max-width': `${Math.max(0, (gantt.visibleRange().end - gantt.visibleRange().start) * gantt.pixelsPerDay() - 16)}px`,
                    translate: `clamp(calc(${(gantt.visibleRange().start - edgeDay()) * gantt.pixelsPerDay() + 8}px + 100%), 0px, ${(gantt.visibleRange().end - edgeDay()) * gantt.pixelsPerDay() - 8}px) 0`,
                  }}
                >
                  {formatGanttDay(preview().end)}
                </span>
              )}
            </Show>
          </div>
        );
      }}
    </Show>
  );
}
