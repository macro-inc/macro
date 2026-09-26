import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { createMethodRegistration } from '@core/orchestrator';
import { blockHandleSignal } from '@core/signal/load';
import { DebouncedNotificationReadMarker } from '@notifications';
import { queryReadyGate } from '@queries/gate';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import { Button, cn, Layer, Scroll } from '@ui';
import { type Accessor, createMemo, onMount, Show, Suspense } from 'solid-js';

import { createUrlDiffState } from '../../agent-changes/url-diff-state';
import { type PrView, PrViews } from '../components/pr-views';
import { createPrDiscussionSource } from '../data/prDiscussionSource';
import { usePrForeignEntityQuery } from '../data/queries';
import { PrChanges } from '../pr-changes';
import {
  cleanGithubMarkdown,
  githubAvatarUrl,
  githubDisplayLogin,
} from '../util/githubMarkdown';
import type { PrRef } from '../util/prKey';
import { prDisplayName, prHtmlUrl } from '../util/prKey';
import {
  PrDescriptionSkeleton,
  PrMetadataSkeleton,
  PrTimelineSkeleton,
  PrTitleSkeleton,
} from './PrSkeletons';
import { PR_PILL_CLASS, PrSplitHeader, PrStatusChip } from './PrSplitHeader';
import { PrTimeline } from './PrTimeline';
import { PrSidePanelSections } from './sidepanel/PrSidePanelSections';

export default function PrBlock(props: { view?: unknown }) {
  const blockId = useBlockId();
  const blockHandle = blockHandleSignal.get;
  const diffState = createUrlDiffState(() => `pr:${blockId}`);
  const setView = (view: PrView) => {
    const layout = view === 'diff' ? 'changes-only' : 'agent-only';
    if (diffState.layout() !== layout) diffState.setLayout(layout);
  };

  // Navigation params aim a newly opened or already mounted PR at its diff.
  // The URL owns subsequent tab changes and restores them after reload.
  onMount(() => {
    if (props.view === 'diff' || props.view === 'overview') setView(props.view);
  });
  createMethodRegistration(blockHandle, {
    goToLocationFromParams: async (params: Record<string, unknown>) => {
      if (params.view === 'diff' || params.view === 'overview') {
        setView(params.view);
      }
    },
  });

  return (
    <Show when={blockId}>
      {(id) => (
        <Suspense fallback={<PrTitleSkeleton />}>
          <PrBlockContent
            foreignEntityId={id()}
            view={diffState.layout() === 'agent-only' ? 'overview' : 'diff'}
            onViewChange={setView}
            diffStyle={diffState.diffStyle()}
            onDiffStyleChange={diffState.setDiffStyle}
          />
        </Suspense>
      )}
    </Show>
  );
}

function PrBlockContent(props: {
  foreignEntityId: string;
  view: PrView;
  onViewChange: (view: PrView) => void;
  diffStyle: 'unified' | 'split';
  onDiffStyleChange: (style: 'unified' | 'split') => void;
}) {
  const notificationSource = useGlobalNotificationSource();
  const foreignEntityQuery = usePrForeignEntityQuery(
    () => props.foreignEntityId
  );

  const data = () =>
    queryReadyGate(foreignEntityQuery) ? foreignEntityQuery.data : undefined;
  const prRef = () => data()?.prRef;
  const pullRequest = () => data()?.pullRequest;

  const loadFailed = () => foreignEntityQuery.isError;

  // Block-lifetime local Macro discussion (prototype-only, lost on reload).
  const discussionSource = createPrDiscussionSource();

  return (
    <div class="size-full overflow-hidden flex flex-col relative">
      <DebouncedNotificationReadMarker
        notificationSource={notificationSource}
        entity={{ type: 'foreign_entity', id: props.foreignEntityId }}
      />
      <SidePanel.Layout>
        <PrSidePanelSections enrichment={pullRequest} />
        <div class="flex flex-col size-full min-w-0 min-h-0">
          <Show when={prRef()}>
            {(ref) => (
              <PrSplitHeader
                foreignEntityId={props.foreignEntityId}
                prRef={ref()}
                enrichment={pullRequest()}
              />
            )}
          </Show>

          <Show
            when={!loadFailed() || data()}
            fallback={
              <div class="p-6 text-sm text-ink-muted">
                <p>Couldn't load this pull request.</p>
                <Button
                  variant="outline"
                  size="sm"
                  class="mt-3"
                  onClick={() => void foreignEntityQuery.refetch()}
                >
                  Try again
                </Button>
              </div>
            }
          >
            <PrViews
              view={props.view}
              onViewChange={props.onViewChange}
              diff={
                <Show
                  when={prRef()}
                  fallback={
                    <div class="p-6 text-sm text-ink-muted">
                      Loading pull request…
                    </div>
                  }
                >
                  {(ref) => (
                    <PrChanges
                      foreignEntityId={props.foreignEntityId}
                      pullRequestUrl={prHtmlUrl(ref())}
                      diffStyle={props.diffStyle}
                      onDiffStyleChange={props.onDiffStyleChange}
                    />
                  )}
                </Show>
              }
              overview={
                <Scroll class="flex-1 min-h-0">
                  <div class="max-w-3xl mx-auto px-6 pt-12 pb-12 min-w-0">
                    <Show
                      when={prRef()}
                      fallback={
                        <>
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
              }
            />
          </Show>
        </div>
      </SidePanel.Layout>
    </div>
  );
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
