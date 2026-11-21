import { cn } from '@ui';
import { type JSX, Show } from 'solid-js';

/**
 * The shared layout of an action row and a tool row: a label column on the
 * left and its controls on the right; on a narrow group they stack, with
 * the control full width beneath the label.
 */
export function PermissionRow(props: {
  label: JSX.Element;
  /** Small text after the label: counts, `service.operation`, badges. */
  details?: JSX.Element;
  controls: JSX.Element;
  /** Briefly highlighted, after a deep link scrolls to it. */
  flash?: boolean;
  /** Identifies the row for deep links. */
  rowKey: string;
}) {
  return (
    <div
      data-permission-row={props.rowKey}
      class={cn(
        'flex min-h-11 flex-col items-stretch gap-2 rounded-lg py-2.5 transition-colors duration-1000 touch:min-h-[44px] @min-[460px]/permission-group:flex-row @min-[460px]/permission-group:items-center @min-[460px]/permission-group:justify-between @min-[460px]/permission-group:gap-4 @min-[460px]/permission-group:py-1.5',
        props.flash && 'bg-selected duration-0 motion-reduce:transition-none'
      )}
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {props.label}
        <Show when={props.details}>{props.details}</Show>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">{props.controls}</div>
    </div>
  );
}
