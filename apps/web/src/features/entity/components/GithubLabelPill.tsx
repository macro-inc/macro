import { DEFAULT_TAG_COLOR } from '@property/tags/tagColors';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import type { GithubPullRequestLabel } from '../types/entity';

const GITHUB_HEX_COLOR = /^#?([0-9a-f]{6})$/i;

/**
 * A GitHub label drawn the way GitHub draws it. Dark themes tint the pill and
 * lighten dark label colors until the text is readable; light themes fill with
 * the label color and flip the text to black or white by its lightness.
 */
export function GithubLabelPill(props: {
  name: string;
  /** GitHub's six-digit hex color, with or without `#`. */
  color?: string | null;
  class?: string;
}) {
  const color = () => {
    const hex = props.color && GITHUB_HEX_COLOR.exec(props.color)?.[1];
    return hex ? `#${hex}` : DEFAULT_TAG_COLOR;
  };

  return (
    <span
      class={cn(
        'inline-flex h-5 max-w-full min-w-0 items-center rounded-full border px-[7px] text-xs leading-none font-medium',
        'dark-mode:border-[color:oklch(from_var(--label-color)_max(l,0.72)_c_h/0.3)] dark-mode:bg-[oklch(from_var(--label-color)_l_c_h/0.18)] dark-mode:text-[color:oklch(from_var(--label-color)_max(l,0.72)_c_h)]',
        'light-mode:border-[color:oklch(from_var(--label-color)_calc(l_-_0.25)_c_h/clamp(0,(l_-_0.95)_*_100,1))] light-mode:bg-(--label-color) light-mode:text-[color:oklch(from_var(--label-color)_clamp(0,(0.66_-_l)_*_1000,1)_0_0)]',
        props.class
      )}
      style={{ '--label-color': color() }}
    >
      <span class="truncate">{props.name}</span>
    </span>
  );
}

/** A pull request's labels as pills, in GitHub's order. */
export function GithubLabelPills(props: {
  labels: readonly GithubPullRequestLabel[];
  class?: string;
  pillClass?: string;
}) {
  return (
    <Show when={props.labels.length > 0}>
      <span
        class={cn('flex min-w-0 items-center gap-1', props.class)}
        title={props.labels.map((label) => label.name).join(', ')}
      >
        <For each={props.labels}>
          {(label) => (
            <GithubLabelPill
              name={label.name}
              color={label.color}
              class={props.pillClass}
            />
          )}
        </For>
      </span>
    </Show>
  );
}
