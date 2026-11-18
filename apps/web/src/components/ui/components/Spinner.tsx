import { t } from '@app/lib/i18n';
import { Show } from 'solid-js';
import { cn } from '../utils/classname';

export type SpinnerSize = 'sm' | 'md' | 'lg';

export type SpinnerProps = {
  size?: SpinnerSize;
  label?: string;
  /** Use when nearby content already describes the loading state. */
  decorative?: boolean;
  class?: string;
};

const sizes: Record<SpinnerSize, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-8',
};

/**
 * A current-color ring with a quiet track and rounded leading arc.
 * @do Give standalone loaders a label describing the pending operation.
 * @do Use decorative mode beside a loading message or inside a labelled button.
 * @dont Replace determinate progress with an indeterminate spinner.
 */
export function Spinner(props: SpinnerProps) {
  return (
    <span
      role={props.decorative ? undefined : 'status'}
      aria-hidden={props.decorative ? true : undefined}
      class={cn(
        'inline-flex shrink-0 align-middle',
        sizes[props.size ?? 'md'],
        props.class
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        aria-hidden="true"
        class="size-full motion-safe:animate-spin"
      >
        <circle cx="12" cy="12" r="9" opacity="0.2" />
        <circle
          cx="12"
          cy="12"
          r="9"
          pathLength="100"
          stroke-dasharray="25 75"
          stroke-linecap="round"
        />
      </svg>
      <Show when={!props.decorative}>
        <span class="sr-only">{props.label ?? t('common.loading')}</span>
      </Show>
    </span>
  );
}
