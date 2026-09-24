import GitMerge from '@phosphor/git-merge.svg';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { cn, Layer } from '@ui';
import { type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

// Status icon colors follow the soup PR rows (entity-icon.tsx):
// open → green pull-request icon, merged → purple merge icon, closed → red.
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

/** Pill surface shared by the PR status and metadata. */
export function PrPill(props: {
  href?: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <Layer depth={2}>
      <Dynamic
        component={props.href ? 'a' : 'span'}
        href={props.href}
        target={props.href ? '_blank' : undefined}
        rel={props.href ? 'noreferrer' : undefined}
        class={cn(
          'inline-flex items-center gap-1.5 min-w-0 border border-edge-muted px-2 py-1 leading-tight text-left rounded-full bg-surface',
          props.href && 'hover:bg-hover',
          props.class
        )}
      >
        {props.children}
      </Dynamic>
    </Layer>
  );
}

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

/** Status pill matching the task block's inline property pills. */
export function PrStatusChip(props: { status: string; class?: string }) {
  return (
    <PrPill
      class={cn('shrink-0', STATUS_TEXT_CLASS[props.status], props.class)}
    >
      <PrStatusIcon status={props.status} class="size-3 shrink-0" />
      {capitalize(props.status)}
    </PrPill>
  );
}
