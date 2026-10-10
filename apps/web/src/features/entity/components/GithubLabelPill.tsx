import { DEFAULT_TAG_COLOR } from '@property/tags/tagColors';
import { cn, TagDot } from '@ui';
import { For, Show } from 'solid-js';
import type { GithubPullRequestLabel } from '../types/entity';
import { rowPillClasses } from './row-pill';

const GITHUB_HEX_COLOR = /^#?([0-9a-f]{6})$/i;

/**
 * A GitHub label drawn like Macro's tag pills: a neutral outline pill with
 * the label's color as a dot, so labels read the same as email and task tags.
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
      title={props.name}
      class={rowPillClasses(cn('max-w-full', props.class))}
    >
      <TagDot fill={color()} size="sm" />
      <span data-pill-text class="min-w-0 truncate">
        {props.name}
      </span>
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
      <span class={cn('flex min-w-0 items-center gap-1', props.class)}>
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
