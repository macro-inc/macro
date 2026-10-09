import './gantt-clip.css';
import { cn } from '@ui';
import type { ParentProps } from 'solid-js';
import { HEADER_HEIGHT, useGantt } from './gantt-context';

/** The transformed parent owns positioning; native sticky clipping excludes the label column. */
export function GanttCalendarClip(
  props: ParentProps<{ width: number; inset?: number; closingInset?: number }>
) {
  const gantt = useGantt();
  return (
    <div
      data-gantt-calendar-clip=""
      class={cn(
        'sticky h-full w-0',
        props.closingInset !== undefined &&
          'animate-[gantt-scene-close_200ms_linear] motion-reduce:animate-none'
      )}
      style={{
        left: `${props.inset ?? gantt.labelWidth()}px`,
        'clip-path': `inset(0 -${props.width}px 0 0)`,
        '--gantt-closing-inset': `${props.closingInset ?? 0}px`,
      }}
    >
      <div class="fixed inset-0">{props.children}</div>
    </div>
  );
}

/** Native clipping keeps decoration out of both fixed labels and floating item panels. */
export function GanttCalendarScene(props: ParentProps<{ class?: string }>) {
  const gantt = useGantt();
  return (
    <div
      aria-hidden="true"
      class={cn('pointer-events-none absolute inset-x-0 bottom-0', props.class)}
      style={{ top: `${HEADER_HEIGHT}px`, transform: 'translateZ(0)' }}
    >
      <GanttCalendarClip
        width={gantt.width()}
        inset={
          gantt.labelWidth() ||
          (gantt.sidebar.open() ? gantt.sidebar.width() : 0)
        }
        closingInset={
          gantt.labelWidth() === 0 && !gantt.sidebar.open()
            ? gantt.sidebar.width()
            : undefined
        }
      >
        {props.children}
      </GanttCalendarClip>
    </div>
  );
}
