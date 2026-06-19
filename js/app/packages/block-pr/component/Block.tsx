import { SidePanel } from '@app/component/side-panel';
import { useBlockId } from '@core/block';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { queryClient } from '@queries/client';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import { cn, Layer, Scroll } from '@ui';
import {
  type Accessor,
  createEffect,
  createMemo,
  type JSX,
  onMount,
  Show,
} from 'solid-js';

import { createPrDiscussionSource } from '../data/prDiscussionSource';
import {
  type PrForeignEntityData,
  prForeignEntityQueryKey,
  usePrForeignEntityQuery,
} from '../data/queries';
import {
  cleanGithubMarkdown,
  githubAvatarUrl,
  githubDisplayLogin,
} from '../util/githubMarkdown';
import type { PrRef } from '../util/prKey';
import { prDisplayName } from '../util/prKey';
import { logPrLoading } from '../util/prLoadingLog';
import {
  PrDescriptionSkeleton,
  PrMetadataSkeleton,
  PrTimelineSkeleton,
  PrTitleSkeleton,
} from './PrSkeletons';
import { PR_PILL_CLASS, PrSplitHeader, PrStatusChip } from './PrSplitHeader';
import { PrTimeline } from './PrTimeline';
import { PrSidePanelSections } from './sidepanel/PrSidePanelSections';

export default function PrBlock() {
  const blockId = useBlockId();

  logPrLoading('PrBlock render', {
    blockId,
  });

  return (
    <Show when={blockId}>
      {(id) => <PrBlockContent foreignEntityId={id()} />}
    </Show>
  );
}

function PrBlockContent(props: { foreignEntityId: string }) {
  onMount(() => {
    logPrLoading('PrBlockContent mounted', {
      foreignEntityId: props.foreignEntityId,
    });
  });

  const foreignEntityQuery = usePrForeignEntityQuery(
    () => props.foreignEntityId
  );
  const foreignEntityData = createMemo(() => {
    foreignEntityQuery.status;
    foreignEntityQuery.dataUpdatedAt;
    return queryClient.getQueryData<PrForeignEntityData>(
      prForeignEntityQueryKey(props.foreignEntityId)
    );
  });

  const prRef = createMemo(() => foreignEntityData()?.prRef);
  const pullRequest = createMemo(() => foreignEntityData()?.pullRequest);

  createEffect(() => {
    logPrLoading('foreign entity query state', {
      id: props.foreignEntityId,
      status: foreignEntityQuery.status,
      fetchStatus: foreignEntityQuery.fetchStatus,
      isPending: foreignEntityQuery.isPending,
      isFetching: foreignEntityQuery.isFetching,
      isSuccess: foreignEntityQuery.isSuccess,
      isError: foreignEntityQuery.isError,
      error: describeError(foreignEntityQuery.error),
      hasData: !!foreignEntityData(),
      dataUpdatedAt: foreignEntityQuery.dataUpdatedAt,
    });
  });

  createEffect(() => {
    logPrLoading('resolved PR data for render', {
      source: 'foreign-entity',
      fields: describePullRequest(pullRequest()),
    });
  });

  const loadFailed = createMemo(
    () => !pullRequest() && !!foreignEntityQuery.error
  );

  // Block-lifetime local Macro discussion (prototype-only, lost on reload).
  const discussionSource = createPrDiscussionSource();

  return (
    <div class="size-full overflow-hidden flex flex-col relative">
      <SidePanel.Layout>
        <PrSidePanelSections enrichment={pullRequest} />
        <div class="flex flex-col size-full min-w-0">
          <Show
            when={prRef()}
            fallback={<LoggedFallback name="split-header" />}
          >
            {(ref) => (
              <PrSplitHeader prRef={ref()} enrichment={pullRequest()} />
            )}
          </Show>

          <Scroll class="flex-1 min-h-0">
            <div class="max-w-3xl mx-auto px-6 pt-12 pb-12 min-w-0">
              <Show
                when={prRef()}
                fallback={
                  <>
                    <LoggedFallback name="content" />
                    <PrTitleSkeleton />
                    <div class="spacer h-3" />
                    <PrMetadataSkeleton />
                    <PrDescriptionSkeleton />
                    <PrTimelineSkeleton />
                  </>
                }
              >
                {(ref) => (
                  <>
                    <PrTitle prRef={ref()} pullRequest={pullRequest} />
                    <div class="spacer h-3" />
                    <PrMetadata prRef={ref()} pullRequest={pullRequest} />
                    <PrDescription pullRequest={pullRequest} />
                    <PrLoadErrorBanner loadFailed={loadFailed} />
                    <PrTimeline
                      githubItems={pullRequest()?.comments ?? []}
                      source={discussionSource}
                    />
                  </>
                )}
              </Show>
            </div>
          </Scroll>
        </div>
      </SidePanel.Layout>
    </div>
  );
}

function describeError(error: unknown) {
  if (!error) return null;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }
  return String(error);
}

function describePullRequest(
  pullRequest: GithubPullRequestWithDetails | undefined
) {
  if (!pullRequest) return null;
  return {
    githubKey: pullRequest.githubKey,
    name: pullRequest.name,
    status: pullRequest.status,
    hasDescription: !!pullRequest.description,
    authorLogin: pullRequest.authorLogin,
    checks: pullRequest.checks?.length ?? null,
    comments: pullRequest.comments?.length ?? null,
    additions: pullRequest.additions,
    deletions: pullRequest.deletions,
  };
}

function LoggedFallback(props: { name: string; children?: JSX.Element }) {
  onMount(() => {
    logPrLoading('loading fallback mounted', { name: props.name });
  });
  return <>{props.children}</>;
}

function PrTitle(props: {
  prRef: PrRef;
  pullRequest: Accessor<GithubPullRequestWithDetails | undefined>;
}) {
  return (
    <h1 class="ph-no-capture text-2xl font-semibold">
      {props.pullRequest()?.name ?? prDisplayName(props.prRef)}
    </h1>
  );
}

function PrMetadata(props: {
  prRef: PrRef;
  pullRequest: Accessor<GithubPullRequestWithDetails | undefined>;
}) {
  const pullRequest = () => props.pullRequest();

  return (
    <div class="mb-6 flex flex-row flex-wrap items-center gap-2 text-sm empty:hidden">
      <Show when={pullRequest()?.status}>
        {(status) => <PrStatusChip status={status()} />}
      </Show>
      <Show when={pullRequest()?.authorLogin}>
        {(authorLogin) => (
          <Layer depth={2}>
            <a
              href={`https://github.com/${githubDisplayLogin(authorLogin())}`}
              target="_blank"
              rel="noreferrer"
              class={cn(PR_PILL_CLASS, 'text-ink-muted hover:bg-hover')}
            >
              <img
                src={githubAvatarUrl(authorLogin())}
                alt=""
                class="size-3.5 rounded-full shrink-0"
                loading="lazy"
              />
              <span class="truncate">{githubDisplayLogin(authorLogin())}</span>
            </a>
          </Layer>
        )}
      </Show>
      <Layer depth={2}>
        <a
          href={pullRequest()?.url}
          target="_blank"
          rel="noreferrer"
          class={cn(PR_PILL_CLASS, 'text-ink-muted hover:bg-hover')}
        >
          {prDisplayName(props.prRef)}
        </a>
      </Layer>
      <Show
        when={
          pullRequest()?.additions != null || pullRequest()?.deletions != null
        }
      >
        <Layer depth={2}>
          <span class={PR_PILL_CLASS}>
            <span class="text-success">+{pullRequest()?.additions ?? 0}</span>
            <span class="text-failure">−{pullRequest()?.deletions ?? 0}</span>
          </span>
        </Layer>
      </Show>
    </div>
  );
}

function PrDescription(props: {
  pullRequest: Accessor<GithubPullRequestWithDetails | undefined>;
}) {
  const description = createMemo(() => {
    const raw = props.pullRequest()?.description;
    if (!raw) return null;
    const cleaned = cleanGithubMarkdown(raw);
    return cleaned || null;
  });

  return (
    <Show when={description()}>
      {(markdown) => (
        <StaticMarkdownContext>
          <div class="ph-no-capture text-sm wrap-break-word max-w-full overflow-x-auto">
            <StaticMarkdown markdown={markdown()} target="internal" />
          </div>
        </StaticMarkdownContext>
      )}
    </Show>
  );
}

function PrLoadErrorBanner(props: { loadFailed: Accessor<boolean> }) {
  return (
    <Show when={props.loadFailed()}>
      <div class="mt-6 px-3 py-2 rounded-lg border border-edge-muted text-xs text-ink-muted">
        Couldn't load this pull request from cached GitHub data.
      </div>
    </Show>
  );
}
