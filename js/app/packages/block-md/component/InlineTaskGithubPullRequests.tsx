import { useBlockAliasedName, useBlockId } from '@core/block';
import GithubIcon from '@icon/mcp-github.svg';
import { useDocumentGithubPullRequestsQuery } from '@queries/storage/github-pull-requests';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { createMemo, For, type JSX, Show } from 'solid-js';

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
                <GithubIcon class="size-3 shrink-0" aria-hidden="true" />
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
    </Show>
  );
}
