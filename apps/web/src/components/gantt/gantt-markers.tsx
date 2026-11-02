import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import { GanttCalendarScene } from './gantt-clip';
import { useGantt } from './gantt-context';
import {
  formatGanttDay,
  type GanttDate,
  ganttBarGeometry,
  toGanttDay,
} from './gantt-date';
import {
  formatGanttTime,
  formatGanttTimeRange,
  ganttInstant,
  ganttPosition,
  snapGanttInstant,
  toGanttInstant,
} from './gantt-time';

export function GanttCursorGuide() {
  const gantt = useGantt();
  return (
    <Show when={!gantt.editing() && gantt.guide()}>
      {(guide) => (
        <GanttCalendarScene class="z-20">
          <div
            data-gantt-cursor-line=""
            class="absolute inset-y-0 border-l border-dashed border-ink-muted opacity-70"
            style={{
              left: `${gantt.labelWidth() + (guide().day - gantt.range().start) * gantt.pixelsPerDay()}px`,
            }}
          />
        </GanttCalendarScene>
      )}
    </Show>
  );
}

export function GanttCursorTooltip() {
  const gantt = useGantt();
  return (
    <Show when={!gantt.editing() && gantt.guide()}>
      {(guide) => (
        <span
          data-gantt-cursor-label=""
          class="pointer-events-none absolute bottom-1 z-30 overflow-hidden rounded border border-edge-muted bg-tooltip px-1.5 py-0.5 text-xxs text-ink whitespace-nowrap"
          style={{
            left: `${(guide().day - gantt.range().start) * gantt.pixelsPerDay()}px`,
            'max-width': `${Math.max(0, (gantt.visibleRange().end - gantt.visibleRange().start) * gantt.pixelsPerDay() - 16)}px`,
            translate: `clamp(${(gantt.visibleRange().start - guide().day) * gantt.pixelsPerDay() + 8}px, -50%, calc(${(gantt.visibleRange().end - guide().day) * gantt.pixelsPerDay() - 8}px - 100%)) 0`,
          }}
        >
          {gantt.scale() === 'hour'
            ? cursorTime(guide().day)
            : formatGanttDay(
                // An end on a day boundary is exclusive; a timed end is in its day.
                guide().edge === 'end' && Number.isInteger(guide().day)
                  ? guide().day - 1
                  : Math.floor(guide().day),
                false
              )}
        </span>
      )}
    </Show>
  );
}
/** `Oct 9, 9:15 AM`: the quarter hour under the cursor at hours zoom. */
function cursorTime(position: number): string {
  const instant = snapGanttInstant(ganttInstant(position), 15);
  return `${formatGanttDay(Math.floor(ganttPosition(instant)), false)}, ${formatGanttTime(instant)}`;
}

export function GanttTodayButton() {
  const gantt = useGantt();
  return (
    <Button
      size="md"
      variant="secondary"
      class="bg-surface shadow-sm"
      onClick={() => (gantt.hours() ? gantt.fitToday() : gantt.scrollToToday())}
    >
      Today
    </Button>
  );
}

/**
 * Compose inside Gantt.Label so invalid-date explanations remain visible
 * while scrolling. A `timed` interval also shows its times, which a short
 * bar has no room for.
 */
export function GanttDateHint(props: {
  start: GanttDate;
  end?: GanttDate;
  timed?: boolean;
  class?: string;
}) {
  const gantt = useGantt();
  const times = () => {
    const start = toGanttInstant(props.start);
    const end = toGanttInstant(props.end);
    return props.timed && start && end ? { start, end } : undefined;
  };
  const hint = () => {
    const shown = times();
    if (shown && shown.end < shown.start) return 'End date precedes start';
    const problem = match(
      ganttBarGeometry(props, gantt.range(), gantt.pixelsPerDay()).kind
    )
      .with('missing-start', () => 'No start date')
      .with('invalid-start', () => 'Invalid start date')
      .with('invalid-end', () => 'Invalid end date')
      .with('reversed', () => 'End date precedes start')
      .otherwise(() => '');
    return problem || (shown ? formatGanttTimeRange(shown) : '');
  };
  return (
    <Show when={hint()}>
      <span
        class={cn('block truncate text-xxs text-ink-muted', props.class)}
        title={hint()}
      >
        {hint()}
      </span>
    </Show>
  );
}

export function GanttTodayLine(props: { date?: GanttDate; header?: boolean }) {
  const gantt = useGantt();
  // At hours zoom the line marks the current time rather than the day.
  const showsNow = () => props.date == null && gantt.scale() === 'hour';
  const position = () => {
    if (showsNow()) return ganttPosition(gantt.now());
    const day = props.date == null ? gantt.today() : toGanttDay(props.date);
    return day === undefined ? undefined : day + 0.5;
  };
  const left = (current: number) =>
    (props.header ? 0 : gantt.labelWidth()) +
    (current - gantt.range().start) * gantt.pixelsPerDay();
  const visible = () => {
    const current = position();
    return current !== undefined &&
      current >= gantt.visibleRange().start &&
      current < gantt.visibleRange().end
      ? current
      : undefined;
  };
  const marker = (current: number) => (
    <Show
      when={showsNow()}
      fallback={
        <div
          aria-hidden="true"
          data-gantt-today={props.header ? 'header' : 'body'}
          class="pointer-events-none absolute inset-y-0 z-0 w-px bg-ink-muted/60"
          style={{ left: `${left(current)}px` }}
        />
      }
    >
      <div
        aria-hidden="true"
        data-gantt-today={props.header ? 'header' : 'body'}
        data-gantt-now=""
        class="pointer-events-none absolute inset-y-0 z-20 w-px bg-accent"
        style={{ left: `${left(current)}px` }}
      >
        <Show
          when={props.header}
          fallback={
            <span class="absolute top-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-accent" />
          }
        >
          <span class="absolute bottom-1 left-1/2 -translate-x-1/2 rounded-sm bg-accent px-1 text-xxs leading-4 font-semibold text-surface tabular-nums whitespace-nowrap">
            {formatGanttTime(gantt.now())}
          </span>
        </Show>
      </div>
    </Show>
  );
  return (
    <Show when={visible()}>
      {(current) => (
        <Show
          when={props.header}
          fallback={
            <GanttCalendarScene class={showsNow() ? 'z-20' : 'z-0'}>
              {marker(current())}
            </GanttCalendarScene>
          }
        >
          {marker(current())}
        </Show>
      )}
    </Show>
  );
}
export function GanttTodayMarker(props: { date?: GanttDate }) {
  return <GanttTodayLine date={props.date} />;
}
