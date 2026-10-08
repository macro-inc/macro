import { cn } from '@ui';
import type { ParentProps } from 'solid-js';
import { HEADER_HEIGHT, useGantt } from './gantt-context';

/** The transformed parent owns positioning; native sticky clipping excludes the label column. */
export function GanttCalendarClip(props: ParentProps<{ width: number }>) {
  const gantt = useGantt();
  return (
    <div
      data-gantt-calendar-clip=""
      class="sticky h-full w-0"
      style={{
        left: `${gantt.labelWidth()}px`,
        'clip-path': `inset(0 -${props.width}px 0 0)`,
      }}
    >
      <div class="fixed inset-0">{props.children}</div>
    </div>
  );
}

/** Decoration shares the calendar's native clip rather than JavaScript scroll offsets. */
export function GanttCalendarScene(props: ParentProps<{ class?: string }>) {
  const gantt = useGantt();
  return (
    <div
      aria-hidden="true"
      class={cn('pointer-events-none absolute inset-x-0 bottom-0', props.class)}
      style={{ top: `${HEADER_HEIGHT}px`, transform: 'translateZ(0)' }}
    >
      <GanttCalendarClip width={gantt.width()}>
        {props.children}
      </GanttCalendarClip>
    </div>
  );
}
