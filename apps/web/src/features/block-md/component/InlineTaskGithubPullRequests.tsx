import { GithubPullRequestStatusIcon } from '@components/app/side-panel';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { USE_MACRO_PR_SUMMARY_BLOCK } from '@core/constant/featureFlags';
import { TOKENS } from '@core/hotkey/tokens';
import { copyBranchNameToClipboard } from '@core/util/branchName';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import GithubIcon from '@icon/mcp-github.svg';
import GitBranch from '@phosphor/git-branch.svg';
import { useDocumentGithubPullRequestsQuery } from '@queries/storage/github-pull-requests';
import type { GithubPullRequest } from '@service-storage/generated/schemas';
import { badgeTriggerClasses, CopyButton, Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import { createMemo, For, type JSX, Show, Suspense } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';

const PILL_CLASS = cn(
  'inline-flex items-center gap-1.5 min-w-0 border border-edge-muted',
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
        <span class="skeleton-shimmer h-3 w-24 rounded-full bg-skeleton" />
      </div>
    </Layer>
  );
}

function PullRequestPillFace(props: { pr: GithubPullRequest }): JSX.Element {
  return (
    <>
      <Show
        when={props.pr.status}
        fallback={<GithubIcon class="size-3 shrink-0" aria-hidden="true" />}
      >
        {(status) => (
          <GithubPullRequestStatusIcon
            status={status()}
            class="size-3 shrink-0"
          />
        )}
      </Show>
      <Show
        when={pullRequestName(props.pr)}
        fallback={<span class="min-w-0 truncate">{props.pr.displayName}</span>}
      >
        {(title) => (
          <>
            <span class="min-w-0 truncate text-ink">{title()}</span>
            <span class="shrink-0 text-ink-extra-muted">
              {props.pr.displayName}
            </span>
          </>
        )}
      </Show>
      <Show when={hasLineChanges(props.pr)}>
        <span class="shrink-0 font-mono text-xs tabular-nums">
          <span class="text-success">
            +{formatLineCount(props.pr.additions)}
          </span>
          <span class="text-ink-extra-muted mx-0.5">/</span>
          <span class="text-failure">
            -{formatLineCount(props.pr.deletions)}
          </span>
        </span>
      </Show>
    </>
  );
}

/**
 * Opens the pull request's Macro block in a new split once GitHub has synced
 * it; until then the pill links to GitHub.
 */
function PullRequestPill(props: { pr: GithubPullRequest }): JSX.Element {
  const { openWithSplit } = useSplitLayout();
  const foreignEntityId = () =>
    USE_MACRO_PR_SUMMARY_BLOCK ? props.pr.foreignEntityId : undefined;
  const navHandlers = useSplitNavigationHandler<HTMLButtonElement>((event) => {
    const id = foreignEntityId();
    if (!id) return;
    openWithSplit(
      { type: 'pr', id },
      { preferNewSplit: openInNewSplitForMention(event.shiftKey, true) }
    );
  });

  return (
    <Layer depth={2}>
      <Show
        when={foreignEntityId()}
        fallback={
          <a
            aria-label={`Open GitHub pull request ${pullRequestLabel(props.pr)}`}
            class={PILL_CLASS}
            href={props.pr.url}
            target="_blank"
            rel="noopener noreferrer"
            title={pullRequestTitle(props.pr)}
          >
            <PullRequestPillFace pr={props.pr} />
          </a>
        }
      >
        <button
          type="button"
          aria-label={`Open pull request ${pullRequestLabel(props.pr)}`}
          class={PILL_CLASS}
          title={pullRequestTitle(props.pr)}
          {...navHandlers}
        >
          <PullRequestPillFace pr={props.pr} />
        </button>
      </Show>
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
      <For each={pullRequests()}>{(pr) => <PullRequestPill pr={pr} />}</For>
      <Show when={!isWaitingForPullRequests() && pullRequests().length === 0}>
        <CopyButton
          variant="outline"
          size="sm"
          noTouchResize
          depth={2}
          tooltip="Copy branch name"
          aria-label="Copy branch name"
          hotkey={TOKENS.entity.action.copyBranchName}
          class={badgeTriggerClasses({
            variant: 'outline',
            size: 'sm',
            class: 'gap-1.5 bg-surface-2 border border-edge',
          })}
          onClick={() =>
            copyBranchNameToClipboard(props.blockId, { silent: true })
          }
        >
          <GitBranch class="size-3 shrink-0" />
        </CopyButton>
      </Show>
    </>
  );
}

export function InlineTaskGithubPullRequests(): JSX.Element {
  const { documentId, kind } = useMarkdownDocument();
  const blockId = documentId();
  const isTask = kind() === 'task';

  return (
    <Show when={isTask}>
      <Suspense fallback={<InlineTaskGithubPullRequestsSkeleton />}>
        <InlineTaskGithubPullRequestsContent blockId={blockId} />
      </Suspense>
    </Show>
  );
}
