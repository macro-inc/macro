import type { GithubPullRequestEntity } from '@entity';
import GitPullRequest from '@phosphor/git-pull-request.svg';
import { cn } from '@ui';
import { createEffect } from 'solid-js';

export function PullRequestRow(props: {
  item: GithubPullRequestEntity;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  let ref: HTMLDivElement | undefined;
  createEffect(() => {
    if (props.selected) ref?.scrollIntoView({ block: 'nearest' });
  });
  const label = () =>
    `${props.item.metadata.owner}/${props.item.metadata.repo} #${props.item.metadata.number}`;
  return (
    <div
      ref={ref}
      class={cn('flex items-center gap-2 p-1.5 mx-1.5 rounded-md', {
        'bg-ink/5': props.selected,
      })}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={props.onHover}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelect();
      }}
    >
      <GitPullRequest class="size-4 shrink-0 text-ink-muted" />
      <div class="min-w-0">
        <div class="truncate text-sm text-ink" title={props.item.name}>
          {props.item.name}
        </div>
        <div class="truncate text-xs text-ink-muted" title={label()}>
          {label()}
        </div>
      </div>
    </div>
  );
}
