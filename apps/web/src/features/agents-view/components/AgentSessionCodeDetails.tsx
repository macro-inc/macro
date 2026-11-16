import GitBranchIcon from '@icon/system/regular/git-branch.svg';
import GitMergeIcon from '@icon/system/regular/git-merge.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import { cn, HoverCard } from '@ui';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  SessionCodeDetails,
  SessionPullRequest,
} from '../core/session-code-details';

function pullRequestStatusLabel(pr: SessionPullRequest) {
  return match(pr.status)
    .with('open', () => 'Open')
    .with('draft', () => 'Draft')
    .with('merged', () => 'Merged')
    .with('closed', () => 'Closed')
    .with(undefined, () => undefined)
    .exhaustive();
}

function PullRequestStatusIcon(props: { pr: SessionPullRequest }) {
  const statusClass = () =>
    match(props.pr.status)
      .with('open', () => 'text-success')
      .with('merged', () => 'text-note')
      .with('closed', () => 'text-failure')
      .with('draft', undefined, () => 'text-ink-extra-muted')
      .exhaustive();

  return (
    <Show
      when={props.pr.status === 'merged'}
      fallback={
        <GitPullRequestIcon
          aria-hidden="true"
          class={cn('size-3.5 shrink-0', statusClass())}
        />
      }
    >
      <GitMergeIcon aria-hidden="true" class="size-3.5 shrink-0 text-note" />
    </Show>
  );
}

function pullRequestLabel(pr: SessionPullRequest, opensInMacro: boolean) {
  const status = pullRequestStatusLabel(pr);
  const where = opensInMacro ? '' : ' on GitHub';
  return `Open pull request #${pr.number}${status ? `, ${status}` : ''}${where}`;
}

/** Opens the PR in Macro when it has synced, otherwise on GitHub. */
function PullRequestLink(props: {
  pr: SessionPullRequest;
  onOpenPullRequest?: (event: MouseEvent) => void;
  children: JSX.Element;
}) {
  return (
    <a
      href={props.pr.url}
      target="_blank"
      rel="noreferrer"
      class="pointer-events-auto relative inline-flex shrink-0 items-center gap-1.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-accent"
      aria-label={pullRequestLabel(props.pr, Boolean(props.onOpenPullRequest))}
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
      {props.children}
    </a>
  );
}

/** The repository, branch, and pull request beneath a Home row's title. */
export function AgentSessionCodeDetails(props: {
  details: SessionCodeDetails;
  onOpenPullRequest?: (event: MouseEvent) => void;
}) {
  const context = () =>
    [props.details.repository, props.details.branch]
      .filter(Boolean)
      .join(' · ');

  return (
    <span
      data-agent-code-details
      class="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-ink-extra-muted"
    >
      <Show when={props.details.pullRequest}>
        {(pr) => (
          <PullRequestLink
            pr={pr()}
            onOpenPullRequest={props.onOpenPullRequest}
          >
            <PullRequestStatusIcon pr={pr()} />
            <span class="tabular-nums">#{pr().number}</span>
          </PullRequestLink>
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

/**
 * The merge-status icon on a single-line Agents row. Repository, branch, and
 * PR number wait in its hover card; a press opens the PR like Home's link.
 */
export function AgentSessionPullRequestStatus(props: {
  details: SessionCodeDetails;
  pullRequest: SessionPullRequest;
  onOpenPullRequest?: (event: MouseEvent) => void;
}) {
  const open = (event: MouseEvent) => {
    event.stopPropagation();
    if (props.onOpenPullRequest) {
      props.onOpenPullRequest(event);
      return;
    }
    window.open(props.pullRequest.url, '_blank', 'noreferrer');
  };

  return (
    <span
      data-agent-pull-request-status
      class="pointer-events-auto relative flex"
    >
      <HoverCard
        as="button"
        triggerAriaLabel={pullRequestLabel(
          props.pullRequest,
          Boolean(props.onOpenPullRequest)
        )}
        triggerOnClick={open}
        triggerClass="rounded-sm focus-visible:outline-2 focus-visible:outline-accent"
        placement="right-start"
        contentClass="max-w-72 items-start"
        content={
          <span
            data-agent-code-card
            class="flex min-w-0 flex-col gap-1 text-left"
          >
            <Show when={props.details.repository}>
              {(repository) => (
                <span class="truncate font-medium text-ink">
                  {repository()}
                </span>
              )}
            </Show>
            <Show when={props.details.branch}>
              {(branch) => (
                <span class="flex min-w-0 items-center gap-1.5">
                  <GitBranchIcon aria-hidden="true" class="size-3.5 shrink-0" />
                  <span class="truncate">{branch()}</span>
                </span>
              )}
            </Show>
            <span class="flex min-w-0 items-center gap-1.5">
              <PullRequestStatusIcon pr={props.pullRequest} />
              <span class="tabular-nums">#{props.pullRequest.number}</span>
              <Show when={pullRequestStatusLabel(props.pullRequest)}>
                {(status) => <span>{status()}</span>}
              </Show>
            </span>
          </span>
        }
      >
        <PullRequestStatusIcon pr={props.pullRequest} />
      </HoverCard>
    </span>
  );
}
