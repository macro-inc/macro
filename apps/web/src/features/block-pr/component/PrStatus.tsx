import { rowPillClasses } from '@entity/components/row-pill';
import GitMerge from '@icon/system/regular/git-merge.svg';
import GitPullRequest from '@icon/system/regular/git-pull-request.svg';
import { cn, TagDot } from '@ui';
import { Show } from 'solid-js';

const STATUS_ICON_CLASS: Record<string, string> = {
  open: 'text-success',
  merged: 'text-note',
  closed: 'text-failure',
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function PrStatusIcon(props: { status: string; class?: string }) {
  return (
    <Show
      when={props.status === 'merged'}
      fallback={
        <GitPullRequest
          class={cn('size-4', STATUS_ICON_CLASS[props.status], props.class)}
        />
      }
    >
      <GitMerge class={cn('size-4 text-note', props.class)} />
    </Show>
  );
}

export function PrStatusChip(props: { status: string; class?: string }) {
  return (
    <span class={rowPillClasses(props.class)}>
      <TagDot
        size="sm"
        fill={
          props.status === 'merged'
            ? 'var(--color-note)'
            : props.status === 'open'
              ? 'var(--color-success)'
              : props.status === 'closed'
                ? 'var(--color-failure)'
                : undefined
        }
      />
      {capitalize(props.status)}
    </span>
  );
}
