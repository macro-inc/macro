import { GithubPullRequestStatusIcon } from '@app/component/side-panel';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { TOKENS } from '@core/hotkey/tokens';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import GithubIcon from '@icon/mcp-github.svg';
import GitBranch from '@phosphor/git-branch.svg';
import { useDocumentGithubPullRequestsQuery } from '@queries/storage/github-pull-requests';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { Button, Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { createMemo, For, type JSX, Show, Suspense } from 'solid-js';

const PILL_CLASS = cn(
  'inline-flex items-center gap-1.5 min-w-0 ring ring-edge-muted',
  'px-2 py-1 leading-tight text-left rounded-full',
  'bg-surface text-ink-muted hover:bg-hover hover:text-ink',
  'focus-visible:outline-none focus-visible:ring-accent/20'
);

function pullRequestName(pr: GithubPullRequest): string | undefined {
  return pr.name?.trim() || undefined;
}

function pullRequestLabel(pr: GithubPullRequest): string {
  const name = pullRequestName(pr);
  return name ? `${name} ${pr.displayName}` : pr.displayName;
}

function hasLineChanges(pr: GithubPullRequest): boolean {
  return pr.additions != null || pr.deletions != null;
}

function formatLineCount(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString();
}

function lineChangesLabel(pr: GithubPullRequest): string | undefined {
  if (!hasLineChanges(pr)) return undefined;
  return `+${formatLineCount(pr.additions)} / -${formatLineCount(pr.deletions)}`;
}

function pullRequestTitle(pr: GithubPullRequest): string {
  const changes = lineChangesLabel(pr);
  const label = pullRequestLabel(pr);
  return changes ? `${label} · ${changes}` : label;
}

function InlineTaskGithubPullRequestsSkeleton(): JSX.Element {
  return (
    <Layer depth={2}>
      <div
        aria-hidden="true"
        class={cn(PILL_CLASS, 'pointer-events-none select-none')}
      >
        <GithubIcon class="size-3 shrink-0 text-ink-extra-muted" />
        <span class="skeleton-shimmer h-3 w-24 rounded-full bg-ink/10" />
      </div>
    </Layer>
  );
}

function InlineTaskGithubPullRequestsContent(props: {
  blockId: string;
}): JSX.Element {
  const query = useDocumentGithubPullRequestsQuery(props.blockId);

  const pullRequests = createMemo((): GithubPullRequest[] => {
    if (query.isError) return [];
    return query.data?.pullRequests ?? [];
  });

  const isWaitingForPullRequests = () =>
    !query.isError && query.isFetching && pullRequests().length === 0;

  return (
    <>
      <Show when={isWaitingForPullRequests()}>
        <InlineTaskGithubPullRequestsSkeleton />
      </Show>
      <For each={pullRequests()}>
        {(pr) => {
          const name = pullRequestName(pr);
          return (
            <Layer depth={2}>
              <a
                aria-label={`Open GitHub pull request ${pullRequestLabel(pr)}`}
                class={PILL_CLASS}
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                title={pullRequestTitle(pr)}
              >
                <Show
                  when={pr.status}
                  fallback={
                    <GithubIcon class="size-3 shrink-0" aria-hidden="true" />
                  }
                >
                  {(status) => (
                    <GithubPullRequestStatusIcon
                      status={status()}
                      class="size-3 shrink-0"
                    />
                  )}
                </Show>
                <Show
                  when={name}
                  fallback={
                    <span class="min-w-0 truncate">{pr.displayName}</span>
                  }
                >
                  {(title) => (
                    <>
                      <span class="min-w-0 truncate text-ink">{title()}</span>
                      <span class="shrink-0 text-ink-extra-muted">
                        {pr.displayName}
                      </span>
                    </>
                  )}
                </Show>
                <Show when={hasLineChanges(pr)}>
                  <span class="shrink-0 font-mono text-xs tabular-nums">
                    <span class="text-success">
                      +{formatLineCount(pr.additions)}
                    </span>
                    <span class="text-ink-extra-muted mx-0.5">/</span>
                    <span class="text-failure">
                      -{formatLineCount(pr.deletions)}
                    </span>
                  </span>
                </Show>
              </a>
            </Layer>
          );
        }}
      </For>
      <Show when={!isWaitingForPullRequests() && pullRequests().length === 0}>
        <Button
          variant="ghost"
          size="sm"
          depth={2}
          tooltip="Copy branch name"
          hotkey={TOKENS.entity.action.copyBranchName}
          class={cn(PILL_CLASS, 'bg-surface px-1.5')}
          onClick={() => void copyBranchNameToClipboard(props.blockId)}
        >
          <GitBranch class="size-3 shrink-0" />
        </Button>
      </Show>
    </>
  );
}

export function InlineTaskGithubPullRequests(): JSX.Element {
  const blockId = useBlockId();
  const isTask = useBlockAliasedName() === 'task';

  return (
    <Show when={isTask}>
      <Suspense fallback={<InlineTaskGithubPullRequestsSkeleton />}>
        <InlineTaskGithubPullRequestsContent blockId={blockId} />
      </Suspense>
    </Show>
  );
}
