import { useBlockAliasedName, useBlockId } from '@core/block';
import GithubIcon from '@icon/mcp-github.svg';
import { useDocumentGithubPullRequestsQuery } from '@queries/storage/github-pull-requests';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { createMemo, For, type JSX, Show } from 'solid-js';

const GITHUB_PULL_REQUEST_LINK_CLASS = cn(
  'inline-flex max-w-full min-w-0 items-stretch overflow-hidden rounded-lg',
  'border border-edge-muted bg-surface text-ink-muted shadow-sm',
  'leading-tight hover:bg-hover hover:text-ink',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/20'
);

const GITHUB_PULL_REQUEST_SECTION_CLASS =
  'flex min-w-0 items-center gap-1.5 px-2 py-1.5';

const GITHUB_PULL_REQUEST_DIVIDER_CLASS =
  'w-px shrink-0 self-stretch bg-edge-muted';

function pullRequestName(pullRequest: GithubPullRequest): string | undefined {
  return pullRequest.name?.trim() || undefined;
}

function pullRequestLabel(pullRequest: GithubPullRequest): string {
  const name = pullRequestName(pullRequest);
  return name ? `${name} ${pullRequest.displayName}` : pullRequest.displayName;
}

function hasLineChanges(pullRequest: GithubPullRequest): boolean {
  return pullRequest.additions != null || pullRequest.deletions != null;
}

function formatLineCount(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString();
}

function lineChangesLabel(pullRequest: GithubPullRequest): string | undefined {
  if (!hasLineChanges(pullRequest)) return undefined;

  return `+${formatLineCount(pullRequest.additions)} / -${formatLineCount(
    pullRequest.deletions
  )}`;
}

function pullRequestTitle(pullRequest: GithubPullRequest): string {
  const changes = lineChangesLabel(pullRequest);
  const label = pullRequestLabel(pullRequest);

  return changes ? `${label} · ${changes}` : label;
}

function PullRequestName(props: {
  pullRequest: GithubPullRequest;
}): JSX.Element {
  const name = () => pullRequestName(props.pullRequest);

  return (
    <span class={GITHUB_PULL_REQUEST_SECTION_CLASS}>
      <Show
        when={name()}
        fallback={
          <span class="min-w-0 truncate">{props.pullRequest.displayName}</span>
        }
      >
        {(title) => (
          <>
            <span class="min-w-0 truncate font-medium text-ink">{title()}</span>
            <span class="shrink-0 text-ink-extra-muted">
              {props.pullRequest.displayName}
            </span>
          </>
        )}
      </Show>
    </span>
  );
}

function PullRequestLineChanges(props: {
  pullRequest: GithubPullRequest;
}): JSX.Element {
  return (
    <span
      class={cn(
        GITHUB_PULL_REQUEST_SECTION_CLASS,
        'shrink-0 gap-1 font-mono text-xs tabular-nums'
      )}
    >
      <span class="text-success">
        +{formatLineCount(props.pullRequest.additions)}
      </span>
      <span class="text-ink-extra-muted">/</span>
      <span class="text-failure">
        -{formatLineCount(props.pullRequest.deletions)}
      </span>
    </span>
  );
}

export function InlineTaskGithubPullRequests(): JSX.Element {
  const blockId = useBlockId();
  const isTask = useBlockAliasedName() === 'task';
  const query = useDocumentGithubPullRequestsQuery(blockId, isTask);

  const pullRequests = createMemo((): GithubPullRequest[] => {
    if (!isTask || query.isLoading || query.isError) return [];
    return query.data?.pullRequests ?? [];
  });

  return (
    <Show when={pullRequests().length > 0}>
      <div class="mb-6 flex flex-row flex-wrap items-center gap-2 text-sm">
        <For each={pullRequests()}>
          {(pullRequest) => (
            <Layer depth={2}>
              <a
                aria-label={`Open GitHub pull request ${pullRequestLabel(
                  pullRequest
                )}`}
                class={GITHUB_PULL_REQUEST_LINK_CLASS}
                href={pullRequest.url}
                target="_blank"
                rel="noopener noreferrer"
                title={pullRequestTitle(pullRequest)}
              >
                <span
                  class={cn(
                    GITHUB_PULL_REQUEST_SECTION_CLASS,
                    'shrink-0 text-ink-extra-muted'
                  )}
                >
                  <GithubIcon class="size-4" aria-hidden="true" />
                </span>
                <span class={GITHUB_PULL_REQUEST_DIVIDER_CLASS} />
                <PullRequestName pullRequest={pullRequest} />
                <Show when={hasLineChanges(pullRequest)}>
                  <span class={GITHUB_PULL_REQUEST_DIVIDER_CLASS} />
                  <PullRequestLineChanges pullRequest={pullRequest} />
                </Show>
              </a>
            </Layer>
          )}
        </For>
      </div>
    </Show>
  );
}
