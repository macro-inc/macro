import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { cn, Layer } from '@ui';
import { Show } from 'solid-js';

const STATUS_ICON_CLASS: Record<string, string> = {
  open: 'text-success',
  merged: 'text-note',
  closed: 'text-failure',
};

const STATUS_TEXT_CLASS: Record<string, string> = {
  open: 'text-success',
  merged: 'text-note',
  closed: 'text-failure',
};

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export const PR_PILL_CLASS =
  'inline-flex items-center gap-1.5 min-w-0 border border-edge-muted px-2 py-1 leading-tight text-left rounded-full bg-surface';

export function PrStatusIcon(props: { status: string; class?: string }) {
  return (
    <Show
      when={props.status === 'merged'}
      fallback={
        <GitPullRequest
          class={cn('size-3.5', STATUS_ICON_CLASS[props.status], props.class)}
        />
      }
    >
      <GitMerge class={cn('size-3.5 text-note', props.class)} />
    </Show>
  );
}

export function PrStatusChip(props: { status: string; class?: string }) {
  return (
    <Layer depth={2}>
      <span
        class={cn(
          PR_PILL_CLASS,
          'shrink-0',
          STATUS_TEXT_CLASS[props.status],
          props.class
        )}
      >
        <PrStatusIcon status={props.status} class="size-3 shrink-0" />
        {capitalize(props.status)}
      </span>
    </Layer>
  );
}
