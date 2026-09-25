import GitBranchIcon from '@phosphor/git-branch.svg';
import GitMergeIcon from '@phosphor/git-merge.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { SessionCodeDetails } from '../core/session-code-details';

export function AgentSessionCodeDetails(props: {
  details: SessionCodeDetails;
  onOpenPullRequest?: (event: MouseEvent) => void;
}) {
  const context = () =>
    [props.details.repository, props.details.branch]
      .filter(Boolean)
      .join(' · ');
  const statusLabel = () =>
    match(props.details.pullRequest?.status)
      .with('open', () => 'Open')
      .with('draft', () => 'Draft')
      .with('merged', () => 'Merged')
      .with('closed', () => 'Closed')
      .otherwise(() => undefined);
  const statusClass = () =>
    match(props.details.pullRequest?.status)
      .with('open', () => 'text-success')
      .with('merged', () => 'text-note')
      .with('closed', () => 'text-failure')
      .otherwise(() => 'text-ink-extra-muted');

  return (
    <span
      data-agent-code-details
      class="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-ink-extra-muted"
    >
      <Show when={props.details.pullRequest}>
        {(pr) => (
          <a
            href={pr().url}
            target="_blank"
            rel="noreferrer"
            class="pointer-events-auto relative inline-flex shrink-0 items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label={`Open pull request #${pr().number}${statusLabel() ? `, ${statusLabel()}` : ''}${props.onOpenPullRequest ? '' : ' on GitHub'}`}
            onMouseDown={(event) => {
              if (props.onOpenPullRequest) event.preventDefault();
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (props.onOpenPullRequest) {
                event.preventDefault();
                props.onOpenPullRequest(event);
              }
            }}
          >
            <Show
              when={pr().status === 'merged'}
              fallback={
                <GitPullRequestIcon
                  aria-hidden="true"
                  class={cn('size-3.5 shrink-0', statusClass())}
                />
              }
            >
              <GitMergeIcon
                aria-hidden="true"
                class="size-3.5 shrink-0 text-note"
              />
            </Show>
            <span class="tabular-nums">#{pr().number}</span>
          </a>
        )}
      </Show>
      <Show when={context()}>
        <Show
          when={props.details.pullRequest}
          fallback={
            <GitBranchIcon aria-hidden="true" class="size-3.5 shrink-0" />
          }
        >
          <span aria-hidden="true">·</span>
        </Show>
        <span class="truncate">{context()}</span>
      </Show>
    </span>
  );
}
