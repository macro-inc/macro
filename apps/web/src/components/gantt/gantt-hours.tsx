import { cn } from '@ui';
import { createMemo, For } from 'solid-js';
import { GanttCalendarScene } from './gantt-clip';
import { useGantt } from './gantt-context';
import { ganttDateFromDay, ganttTicks } from './gantt-date';
import {
  formatGanttWeekday,
  ganttHourTicks,
  ganttPosition,
} from './gantt-time';

/** The working day an hours chart leaves unshaded. */
const DAY_STARTS_AT = 8;
const DAY_ENDS_AT = 18;

function isWeekend(day: number): boolean {
  const weekday = ganttDateFromDay(day).getDay();
  return weekday === 0 || weekday === 6;
}

/** The parts of a day shaded as off hours: all of a weekend, or the night either side of a working day. */
function offHours(day: number): { start: number; end: number }[] {
  if (isWeekend(day)) return [{ start: day, end: day + 1 }];
  const at = (hour: number) => {
    const instant = ganttDateFromDay(day);
    instant.setHours(hour);
    return ganttPosition(instant);
  };
  return [
    { start: day, end: at(DAY_STARTS_AT) },
    { start: at(DAY_ENDS_AT), end: day + 1 },
  ];
}

/**
 * The header at hours zoom: each day named on the top tier, its label held
 * at the left edge while the day scrolls past, and hour ticks below.
 */
export function GanttHourHeader(props: { textInset: number }) {
  const gantt = useGantt();
  const days = createMemo(() =>
    ganttTicks(gantt.range(), 'day', gantt.visibleRange())
  );
  const hours = createMemo(() =>
    ganttHourTicks(gantt.range(), gantt.pixelsPerDay(), gantt.visibleRange())
  );
  const left = (position: number) =>
    (position - gantt.range().start) * gantt.pixelsPerDay();
  // The now line's time badge covers the hour labels beside it.
  const besideNow = (position: number) =>
    Math.abs(position - ganttPosition(gantt.now())) * gantt.pixelsPerDay() < 44;
  return (
    <>
      <For each={days()}>
        {(day) => (
          <div
            data-gantt-day=""
            class="pointer-events-none absolute inset-y-0 border-l border-edge-muted"
            style={{
              left: `${left(day.start)}px`,
              width: `${left(day.end) - left(day.start)}px`,
            }}
          >
            <div class="flex h-6 items-end overflow-clip whitespace-nowrap">
              <span
                class={cn(
                  'sticky bg-panel px-2 text-xs leading-4 font-semibold',
                  day.start === gantt.today()
                    ? 'text-accent'
                    : isWeekend(day.start)
                      ? 'text-ink-muted'
                      : 'text-ink'
                )}
                style={{ left: `${props.textInset}px` }}
              >
                {formatGanttWeekday(day.start)}
              </span>
            </div>
          </div>
        )}
      </For>
      <For each={hours()}>
        {(tick) => (
          <div
            data-gantt-hour-tick=""
            class="pointer-events-none absolute top-6 bottom-0 flex items-center whitespace-nowrap"
            style={{ left: `${left(tick.position)}px` }}
          >
            <span class="relative -translate-x-1/2 text-xxs leading-4 tabular-nums">
              <span class={cn(besideNow(tick.position) && 'invisible')}>
                {tick.label}
              </span>
              <span
                aria-hidden="true"
                class="absolute top-full left-1/2 mt-0.5 h-1 w-px -translate-x-1/2 bg-ink-extra-muted/70"
              />
            </span>
          </div>
        )}
      </For>
    </>
  );
}

/**
 * The calendar body at hours zoom: off hours faintly shaded, a line at each
 * midnight, and fainter lines at the header's hour ticks.
 */
export function GanttHourGrid() {
  const gantt = useGantt();
  const days = createMemo(() =>
    ganttTicks(gantt.range(), 'day', gantt.visibleRange())
  );
  const hours = createMemo(() =>
    gantt.gridVisible()
      ? ganttHourTicks(
          gantt.range(),
          gantt.pixelsPerDay(),
          gantt.visibleRange()
        )
      : []
  );
  const left = (position: number) =>
    gantt.labelWidth() +
    (position - gantt.range().start) * gantt.pixelsPerDay();
  return (
    <GanttCalendarScene>
      <For each={days().flatMap((day) => offHours(day.start))}>
        {(band) => (
          <div
            data-gantt-off-hours=""
            class="absolute inset-y-0 bg-ink/3"
            style={{
              left: `${left(band.start)}px`,
              width: `${(band.end - band.start) * gantt.pixelsPerDay()}px`,
            }}
          />
        )}
      </For>
      <For each={hours()}>
        {(tick) => (
          <div
            class={cn(
              'absolute inset-y-0 border-l border-edge-muted/40',
              gantt.gridStyle() === 'dashed' && 'border-dashed'
            )}
            style={{ left: `${left(tick.position)}px` }}
          />
        )}
      </For>
      <For each={days()}>
        {(day) => (
          <div
            data-gantt-midnight=""
            class="absolute inset-y-0 border-l border-edge-muted"
            style={{ left: `${left(day.start)}px` }}
          />
        )}
      </For>
    </GanttCalendarScene>
  );
}
