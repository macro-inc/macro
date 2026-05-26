import { useBlockAliasedName, useBlockId } from '@core/block';
import { useDocumentGithubPullRequestsQuery } from '@queries/storage/github-pull-requests';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { createMemo, For, type JSX, Show } from 'solid-js';

const GITHUB_PULL_REQUEST_LINK_CLASS = cn(
  'inline-flex items-center gap-1.5 min-w-0 ring ring-edge-muted',
  'px-2 py-1 leading-tight text-left rounded-full',
  'bg-surface text-ink-muted hover:bg-hover hover:text-ink',
  'focus-visible:bg-active focus-visible:ring-accent/10'
);

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
      <div class="flex flex-row flex-wrap items-center gap-2 text-sm mb-6">
        <For each={pullRequests()}>
          {(pullRequest) => (
            <Layer depth={2}>
              <a
                class={GITHUB_PULL_REQUEST_LINK_CLASS}
                href={pullRequest.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="truncate">{pullRequest.displayName}</span>
              </a>
            </Layer>
          )}
        </For>
      </div>
    </Show>
  );
}
