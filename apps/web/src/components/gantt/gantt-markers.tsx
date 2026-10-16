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
          {formatGanttDay(
            guide().edge === 'end' ? guide().day - 1 : Math.floor(guide().day),
            false
          )}
        </span>
      )}
    </Show>
  );
}
export function GanttTodayButton() {
  const gantt = useGantt();
  return (
    <Button
      depth={2}
      size="md"
      variant="outline"
      class="bg-surface shadow-sm"
      onClick={() => gantt.scrollToToday()}
    >
      Today
    </Button>
  );
}

/** Compose inside Gantt.Label so invalid-date explanations remain visible while scrolling. */
export function GanttDateHint(props: {
  start: GanttDate;
  end?: GanttDate;
  class?: string;
}) {
  const gantt = useGantt();
  const problem = () =>
    match(ganttBarGeometry(props, gantt.range(), gantt.pixelsPerDay()).kind)
      .with('missing-start', () => 'No start date')
      .with('invalid-start', () => 'Invalid start date')
      .with('invalid-end', () => 'Invalid end date')
      .with('reversed', () => 'End date precedes start')
      .otherwise(() => '');
  return (
    <Show when={problem()}>
      <span
        class={cn('block truncate text-xxs text-ink-muted', props.class)}
        title={problem()}
      >
        {problem()}
      </span>
    </Show>
  );
}

export function GanttTodayLine(props: { date?: GanttDate; header?: boolean }) {
  const gantt = useGantt();
  const day = () =>
    props.date == null ? gantt.today() : toGanttDay(props.date);
  const visible = () => {
    const current = day();
    return (
      current !== undefined &&
      current + 0.5 >= gantt.visibleRange().start &&
      current + 0.5 < gantt.visibleRange().end
    );
  };
  const marker = () => (
    <div
      aria-hidden="true"
      data-gantt-today={props.header ? 'header' : 'body'}
      class="pointer-events-none absolute inset-y-0 z-0 w-px bg-ink-muted/60"
      style={{
        left: `${(props.header ? 0 : gantt.labelWidth()) + (day()! - gantt.range().start + 0.5) * gantt.pixelsPerDay()}px`,
      }}
    />
  );
  return (
    <Show when={visible()}>
      <Show
        when={props.header}
        fallback={
          <GanttCalendarScene class="z-0">{marker()}</GanttCalendarScene>
        }
      >
        {marker()}
      </Show>
    </Show>
  );
}
export function GanttTodayMarker(props: { date?: GanttDate }) {
  return <GanttTodayLine date={props.date} />;
}
