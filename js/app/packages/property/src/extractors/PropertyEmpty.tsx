import CircleDashedEmpty from '@phosphor/circle-dashed.svg';
import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';

type Props = {
  /** Text to render after the empty icon (e.g. "None", "Set status"). */
  label?: JSX.Element;
  /** Hide the dashed-circle icon (text-only empty state). */
  hideIcon?: boolean;
  class?: string;
};

/**
 * Standard empty-value affordance — dashed circle + optional label.
 */
export function PropertyEmpty(props: Props) {
  return (
    <span
      class={cn('inline-flex items-center gap-1.5 opacity-50', props.class)}
    >
      <Show when={!props.hideIcon}>
        <CircleDashedEmpty class="size-3 shrink-0" />
      </Show>
      <Show when={props.label}>
        <span class="truncate">{props.label}</span>
      </Show>
    </span>
  );
}
