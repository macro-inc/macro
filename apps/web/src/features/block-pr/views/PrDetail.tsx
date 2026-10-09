import { ViewShell } from '@app/components/view-shell';
import { ChangesSplit, ChangesToggle } from '@app/features/changes/changes';
import { useOptionalChanges } from '@app/features/changes/context/changes-controller';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { SplitPanel } from '@components/app/split-panel';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { GithubLabelPills } from '@entity/components/GithubLabelPill';
import { PrAgentSessionsChip } from '@entity/views/PrAgentSessionsChip';
import { DebouncedNotificationReadMarker } from '@notifications';
import {
  type GithubPullRequestWithDetails,
  useRefreshGithubPullRequest,
} from '@queries/storage/github-pull-requests';
import { githubPullRequestChangesKeys } from '@queries/storage/keys';
import { Button, cn, Layer, Scroll } from '@ui';
import { type Accessor, createMemo, Show, Suspense } from 'solid-js';
import { MergePullRequestButton } from '../component/MergePullRequestButton';
import { PrChangesProvider } from '../component/PrChanges';
import {
  PrDescriptionSkeleton,
  PrMetadataSkeleton,
  PrTimelineSkeleton,
  PrTitleSkeleton,
} from '../component/PrSkeletons';
import {
  PR_PILL_CLASS,
  PrStatusChip,
  PrStatusIcon,
} from '../component/PrStatus';
import { PrTimeline } from '../component/PrTimeline';
import { PrSidePanelSections } from '../component/sidepanel/PrSidePanelSections';
import { createPrDiscussionSource } from '../data/prDiscussionSource';
import {
  invalidatePrForeignEntity,
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
import { prDisplayName, prHtmlUrl } from '../util/prKey';

/** Share PR query state without coupling the host's header to the detail body. */
export function usePrDetail(foreignEntityId: Accessor<string>) {
  const query = usePrForeignEntityQuery(foreignEntityId);
  // Detail-lifetime local Macro discussion (prototype-only, lost on reload).
  const discussionSource = createPrDiscussionSource();
  const data = (): PrForeignEntityData | undefined =>
    query.isPending ? undefined : query.data;
  const changeCounts = () => {
    const pullRequest = data()?.pullRequest;
    return pullRequest?.additions != null && pullRequest.deletions != null
      ? { additions: pullRequest.additions, deletions: pullRequest.deletions }
      : undefined;
  };
  useRefreshGithubPullRequest(
    () => {
      const pullRequest = data()?.pullRequest;
      if (!pullRequest) return undefined;
      return {
        displayName: pullRequest.displayName,
        githubKey: pullRequest.githubKey,
        number: pullRequest.number,
        owner: pullRequest.owner,
        repo: pullRequest.repo,
        url: pullRequest.url,
      };
    },
    () => {
      const id = foreignEntityId();
      return [
        prForeignEntityQueryKey(id),
        githubPullRequestChangesKeys.summary(id).queryKey,
      ];
    }
  );
  return { query, data, discussionSource, changeCounts };
}

type PrDetailBodyProps = {
  foreignEntityId: string;
  data?: PrForeignEntityData;
  status: ReturnType<typeof usePrForeignEntityQuery>['status'];
  discussionSource: ReturnType<typeof createPrDiscussionSource>;
  onRetry: () => void;
};

function PrDetailSkeleton() {
  return (
    <>
      <PrTitleSkeleton />
      <div class="spacer h-3" />
      <PrMetadataSkeleton />
      <PrDescriptionSkeleton />
      <PrTimelineSkeleton />
    </>
  );
}

export function PrDetailBody(props: PrDetailBodyProps) {
  const notificationSource = useGlobalNotificationSource();
  return (
    <>
      <DebouncedNotificationReadMarker
        notificationSource={notificationSource}
        entity={{ type: 'foreign_entity', id: props.foreignEntityId }}
      />
      <Scroll class="flex-1 min-h-0">
        <div class="max-w-3xl mx-auto px-6 pt-12 pb-12 min-w-0">
          <Show
            when={props.data}
            fallback={
              <Show
                when={props.status !== 'error'}
                fallback={<PrLoadErrorBanner onRetry={props.onRetry} />}
              >
                <PrDetailSkeleton />
              </Show>
            }
          >
            {(data) => (
              <>
                <PrTitle
                  prRef={data().prRef}
                  pullRequest={data().pullRequest}
                />
                <div class="spacer h-3" />
                <PrMetadata
                  prRef={data().prRef}
                  pullRequest={data().pullRequest}
                />
                <PrDescription pullRequest={data().pullRequest} />
                <Suspense fallback={<PrTimelineSkeleton />}>
                  <PrTimeline
                    githubItems={data().pullRequest.comments ?? []}
                    source={props.discussionSource}
                  />
                </Suspense>
              </>
            )}
          </Show>
        </div>
      </Scroll>
    </>
  );
}

/** Native hosts place this content below their header inside `PrChangesProvider`. */
export function PrDetailContent(props: PrDetailBodyProps) {
  return (
    <div class="relative min-h-0 min-w-0 flex-1">
      <Suspense
        fallback={
          <Scroll class="size-full min-h-0">
            <div class="max-w-3xl mx-auto px-6 pt-12 pb-12 min-w-0">
              <PrDetailSkeleton />
            </div>
          </Scroll>
        }
      >
        <SidePanel.Layout headerToggle={false} floating>
          <PrSidePanelSections
            enrichment={props.data?.pullRequest}
            status={props.status}
          />
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            <PrDetailBody
              foreignEntityId={props.foreignEntityId}
              data={props.data}
              status={props.status}
              onRetry={props.onRetry}
              discussionSource={props.discussionSource}
            />
          </div>
        </SidePanel.Layout>
      </Suspense>
    </div>
  );
}

export function PrDetailActions(props: { detail?: PrForeignEntityData }) {
  return (
    <div class="ml-auto flex shrink-0 items-center gap-2">
      <Show when={props.detail}>
        {(detail) => (
          <MergePullRequestButton
            target={{ ...detail().prRef, title: detail().pullRequest.name }}
            status={detail().pullRequest.status}
            onMerged={() => invalidatePrForeignEntity(detail().id)}
          />
        )}
      </Show>
      <ChangesToggle />
      <SidePanel.Toggle />
    </div>
  );
}

export function StandalonePrDetail(props: { foreignEntityId: string }) {
  const detail = usePrDetail(() => props.foreignEntityId);
  const name = () => {
    const data = detail.data();
    return (
      data?.pullRequest.name ??
      (data ? prDisplayName(data.prRef) : 'Pull request')
    );
  };
  const githubUrl = () => {
    const data = detail.data();
    return data ? (data.pullRequest.url ?? prHtmlUrl(data.prRef)) : undefined;
  };
  return (
    <SidePanel.Root floating persistKey={`pr:${props.foreignEntityId}`}>
      <PrChangesProvider
        foreignEntityId={props.foreignEntityId}
        pullRequestUrl={githubUrl()}
        pullRequestTitle={detail.data()?.pullRequest.name ?? undefined}
        pullRequestChangeCounts={detail.changeCounts()}
      >
        <ChangesSplit>
          <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
            <ViewShell.TopBar class="touch:flex">
              <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
              <Show when={detail.data()?.pullRequest.status}>
                {(status) => <PrStatusIcon status={status()} />}
              </Show>
              <span class="min-w-0 truncate text-sm font-semibold">
                {name()}
              </span>
              <PrDetailActions detail={detail.data()} />
            </ViewShell.TopBar>
            <PrDetailContent
              foreignEntityId={props.foreignEntityId}
              data={detail.data()}
              status={detail.query.status}
              discussionSource={detail.discussionSource}
              onRetry={() => void detail.query.refetch()}
            />
          </div>
        </ChangesSplit>
      </PrChangesProvider>
    </SidePanel.Root>
  );
}

function PrTitle(props: {
  prRef: PrRef;
  pullRequest?: GithubPullRequestWithDetails;
}) {
  return (
    <h1 class="ph-no-capture text-2xl font-semibold">
      {props.pullRequest?.name ?? prDisplayName(props.prRef)}
    </h1>
  );
}

function PrMetadata(props: {
  prRef: PrRef;
  pullRequest?: GithubPullRequestWithDetails;
}) {
  const changes = useOptionalChanges();
  return (
    <div class="mb-6 flex flex-row flex-wrap items-center gap-2 text-sm empty:hidden">
      <Show when={props.pullRequest?.status}>
        {(status) => <PrStatusChip status={status()} />}
      </Show>
      <Show when={props.pullRequest?.authorLogin}>
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
          href={props.pullRequest?.url}
          target="_blank"
          rel="noreferrer"
          class={cn(PR_PILL_CLASS, 'text-ink-muted hover:bg-hover')}
        >
          {prDisplayName(props.prRef)}
        </a>
      </Layer>
      <Show
        when={
          props.pullRequest?.additions != null ||
          props.pullRequest?.deletions != null
        }
      >
        <Layer depth={2}>
          <Show
            when={changes?.available()}
            fallback={
              <span class={PR_PILL_CLASS}>
                <span class="text-success">
                  +{props.pullRequest?.additions ?? 0}
                </span>
                <span class="text-failure">
                  −{props.pullRequest?.deletions ?? 0}
                </span>
              </span>
            }
          >
            <button
              type="button"
              class={PR_PILL_CLASS}
              aria-label="Open Changes pane"
              aria-expanded={changes?.layout.changesVisible()}
              onClick={() => changes?.layout.open()}
            >
              <span class="text-success">
                +{props.pullRequest?.additions ?? 0}
              </span>
              <span class="text-failure">
                −{props.pullRequest?.deletions ?? 0}
              </span>
            </button>
          </Show>
        </Layer>
      </Show>
      <Layer depth={2}>
        <PrAgentSessionsChip
          url={props.pullRequest?.url ?? prHtmlUrl(props.prRef)}
          class="border-edge-muted bg-surface px-2 text-sm font-normal"
        />
      </Layer>
      <GithubLabelPills
        labels={props.pullRequest?.labels ?? []}
        class="contents"
        pillClass="h-auto px-2 py-1 text-sm leading-tight"
      />
    </div>
  );
}

function PrDescription(props: { pullRequest?: GithubPullRequestWithDetails }) {
  const description = createMemo(() => {
    const raw = props.pullRequest?.description;
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

function PrLoadErrorBanner(props: { onRetry: () => void }) {
  return (
    <div class="mt-6 flex flex-col items-start gap-3 rounded-lg border border-edge-muted px-3 py-2 text-xs text-ink-muted">
      <span>Couldn't load this pull request from cached GitHub data.</span>
      <Button variant="outline" size="sm" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  );
}
