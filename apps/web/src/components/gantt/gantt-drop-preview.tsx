import { GanttBar } from './gantt-bar';
import type { GanttDate } from './gantt-date';
import { GanttLabel } from './gantt-sidebar';

/** A non-interactive, date-preserving outline at the destination's sorted row. */
export function GanttDropPreview(props: {
  start: GanttDate;
  end?: GanttDate;
  title: string;
}) {
  return (
    <>
      <GanttLabel>
        <div class="flex h-7 w-full min-w-0 items-center rounded-md border border-dashed border-ink-muted px-2 text-xs text-ink-muted">
          <span class="truncate">{props.title}</span>
        </div>
      </GanttLabel>
      <GanttBar
        start={props.start}
        end={props.end}
        title={props.title}
        class="border-dashed opacity-50 shadow-none"
      >
        <span class="min-w-0 truncate">{props.title}</span>
      </GanttBar>
    </>
  );
}
