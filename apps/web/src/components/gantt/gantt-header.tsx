import { Key } from '@solid-primitives/keyed';
import { cn } from '@ui';
import { createMemo, For, type ParentProps, Show } from 'solid-js';
import { HEADER_HEIGHT, useGantt } from './gantt-context';
import {
  formatGanttMonth,
  type GanttTick,
  ganttDateFromDay,
  ganttTicks,
} from './gantt-date';
import { GanttCursorTooltip, GanttTodayLine } from './gantt-markers';

export function GanttHeader(props: ParentProps<{ class?: string }>) {
  const gantt = useGantt();
  const months = createMemo(() =>
    ganttTicks(gantt.range(), 'month', gantt.visibleRange()).map((tick) => ({
      ...tick,
      label: formatGanttMonth(
        tick.start,
        gantt.scale() === 'month' ? 'short' : 'long'
      ),
    }))
  );
  const ticks = createMemo(() =>
    ganttTicks(gantt.range(), gantt.scale(), gantt.visibleRange())
  );
  const left = (day: number) =>
    (day - gantt.range().start) * gantt.pixelsPerDay();
  const calendarWidth = () =>
    (gantt.visibleRange().end - gantt.visibleRange().start) *
    gantt.pixelsPerDay();
  // The drawer starts below the header; reserve only its toggle in the timeline band.
  const textInset = () =>
    gantt.labelWidth() > 0 ? gantt.labelWidth() + 8 : 64;
  const pinnedMonthLeft = () =>
    left(gantt.visibleRange().start) + textInset() - gantt.labelWidth();
  const monthTextWidth = (tick: GanttTick) => tick.label.length * 7;
  // Center the month text on its date; a trailing year does not shift that anchor.
  const monthNaturalLeft = (tick: GanttTick) =>
    left(tick.start) - monthTextWidth(tick) / 2 - 4;
  const monthYear = (tick: GanttTick) => {
    const date = ganttDateFromDay(tick.start);
    return date.getMonth() === 0 || monthNaturalLeft(tick) <= pinnedMonthLeft()
      ? date.getFullYear()
      : undefined;
  };
  const monthLabelWidth = (tick: GanttTick) =>
    monthTextWidth(tick) + (monthYear(tick) === undefined ? 8 : 44);
  const monthLeft = (tick: GanttTick) =>
    Math.min(
      Math.max(monthNaturalLeft(tick), pinnedMonthLeft()),
      left(tick.end) - monthLabelWidth(tick)
    );
  const monthOpacity = (tick: GanttTick) =>
    Math.max(0, 1 - Math.max(0, pinnedMonthLeft() - monthLeft(tick)) / 32);
  return (
    <div
      class={cn(
        'sticky top-0 z-30 flex border-b border-edge-muted bg-panel text-xs text-ink-muted',
        props.class
      )}
      data-gantt-header=""
      style={{ height: `${HEADER_HEIGHT}px`, width: `${gantt.width()}px` }}
    >
      <Show when={gantt.labelWidth() > 0}>
        <div
          class="sticky left-0 z-10 flex shrink-0 flex-wrap content-center items-center justify-between gap-x-2 gap-y-1 border-r border-edge-muted bg-inherit px-3 font-medium text-ink"
          style={{ width: `${gantt.labelWidth()}px` }}
        >
          {props.children}
        </div>
      </Show>
      <div class="relative isolate flex-1 overflow-clip">
        <GanttTodayLine header />
        <For each={ticks()}>
          {(tick) => (
            <div
              data-gantt-date-tick=""
              class="absolute inset-y-0 flex items-center leading-4 whitespace-nowrap"
              style={{ left: `${left(tick.start)}px` }}
            >
              <span class="relative h-4 -translate-x-1/2">
                <Show
                  when={
                    gantt.scale() !== 'month' &&
                    !months().some((month) => {
                      const distance = left(tick.start) - monthLeft(month);
                      const halfLabel = tick.label.length * 3 + 4;
                      return (
                        monthOpacity(month) > 0 &&
                        distance > -halfLabel &&
                        distance < monthLabelWidth(month) + halfLabel
                      );
                    })
                  }
                >
                  {tick.label}
                </Show>
                <span
                  aria-hidden="true"
                  data-gantt-date-mark=""
                  class="absolute top-full left-1/2 mt-1 h-1.5 w-px -translate-x-1/2 bg-ink-extra-muted/70"
                />
              </span>
            </div>
          )}
        </For>
        <Key each={months()} by="start">
          {(tick) => (
            <div
              data-gantt-month=""
              class="pointer-events-none absolute inset-y-0 flex items-center overflow-clip text-ink whitespace-nowrap"
              style={{
                left: `${monthNaturalLeft(tick())}px`,
                width: `${left(tick().end) - monthNaturalLeft(tick())}px`,
              }}
            >
              <span
                class="sticky z-20 flex shrink-0 items-baseline gap-2 bg-panel px-1 text-xs leading-4"
                style={{
                  left: `${textInset()}px`,
                  opacity: monthOpacity(tick()),
                }}
              >
                <span
                  class="shrink-0 text-center font-semibold"
                  style={{ width: `${monthTextWidth(tick())}px` }}
                >
                  {tick().label}
                </span>
                <Show when={monthYear(tick()) !== undefined}>
                  <span
                    data-gantt-year=""
                    class="font-medium text-ink tabular-nums"
                  >
                    {monthYear(tick())}
                  </span>
                </Show>
              </span>
            </div>
          )}
        </Key>
        <div
          aria-hidden="true"
          data-gantt-timeline-fades=""
          class="pointer-events-none absolute inset-0 z-10"
        >
          <div
            class="sticky h-full"
            style={{
              left: `${gantt.labelWidth()}px`,
              width: `${calendarWidth()}px`,
            }}
          >
            <div class="absolute inset-y-0 left-0 w-[min(128px,33%)] bg-gradient-to-r from-panel to-transparent" />
            <div class="absolute inset-y-0 right-0 w-[min(128px,33%)] bg-gradient-to-l from-panel to-transparent" />
          </div>
        </div>
        <Show when={gantt.labelWidth() === 0}>
          <div class="pointer-events-none absolute inset-0 z-30">
            <div
              data-gantt-toggle-mask=""
              class="sticky left-0 h-full w-14 bg-panel"
            />
          </div>
        </Show>
        <GanttCursorTooltip />
      </div>
    </div>
  );
}
