import { cn, Layer } from '@ui';
import { createMemo, type JSX, Show, splitProps } from 'solid-js';
import { GanttCalendarClip } from './gantt-clip';
import { useGantt } from './gantt-context';
import {
  formatGanttDay,
  type GanttDate,
  ganttBarGeometry,
  toGanttDay,
} from './gantt-date';

export function GanttBar(
  props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'style'> & {
    start: GanttDate;
    end?: GanttDate;
    deadlineWarning?: boolean;
  }
) {
  const gantt = useGantt();
  const [local, rest] = splitProps(props, [
    'start',
    'end',
    'deadlineWarning',
    'class',
    'children',
    'title',
  ]);
  const geometry = createMemo(() => {
    const start = toGanttDay(local.start);
    const end = local.end;
    const range = gantt.range();
    // An undated interval has an open tail, not an unreachable handle at an infinite horizon.
    const openEnd = Math.max((start ?? range.start) + 7, gantt.today() + 7);
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
    return 'left' in value ? value : undefined;
  };

  return (
    <Show when={placed()}>
      {(bar) => {
        const description = () =>
          `${local.title ?? 'Timeline item'}: ${formatGanttDay(bar().start)} → ${bar().end === undefined ? 'No end date' : formatGanttDay(bar().end!)}`;
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
          const remaining = end - gantt.today();
          return Math.min(1, Math.max(0, (8 - remaining) / 8));
        };
        return (
          <div
            data-gantt-bar=""
            data-gantt-start={bar().start}
            data-gantt-end={bar().end}
            class="group pointer-events-none absolute top-1/2 z-10 h-7 -translate-y-1/2 text-xs"
            style={position()}
          >
            <GanttCalendarClip width={bar().width}>
              <Layer depth={2}>
                <div
                  data-gantt-bar-body=""
                  class={cn(
                    'group/bar pointer-events-auto relative size-full rounded-md text-ink',
                    local.class
                  )}
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
                  <button
                    {...rest}
                    type="button"
                    title={description()}
                    aria-label={rest['aria-label'] ?? description()}
                    class="relative size-full text-left whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current"
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
                </div>
              </Layer>
            </GanttCalendarClip>
          </div>
        );
      }}
    </Show>
  );
}
