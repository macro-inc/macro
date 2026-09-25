import { ViewShell } from '@app/components/view-shell';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { SidePanel } from '@components/app/side-panel';
import { SplitPanel } from '@components/app/split-panel';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { openExternalUrl } from '@core/util/url';
import { DebouncedNotificationReadMarker } from '@notifications';
import type { GithubPullRequestWithDetails } from '@queries/storage/github-pull-requests';
import { Button, cn, Layer, Scroll } from '@ui';
import { type Accessor, createMemo, type JSX, Show } from 'solid-js';
import {
  PrDescriptionSkeleton,
  PrMetadataSkeleton,
  PrTimelineSkeleton,
  PrTitleSkeleton,
} from '../component/PrSkeletons';
import { PR_PILL_CLASS, PrStatusChip, PrStatusIcon } from '../component/PrStatus';
import { PrTimeline } from '../component/PrTimeline';
import { PrSidePanelSections } from '../component/sidepanel/PrSidePanelSections';
import { createPrDiscussionSource } from '../data/prDiscussionSource';
import { usePrForeignEntityQuery } from '../data/queries';
import {
  cleanGithubMarkdown,
  githubAvatarUrl,
  githubDisplayLogin,
} from '../util/githubMarkdown';
import type { PrRef } from '../util/prKey';
import { prDisplayName, prHtmlUrl } from '../util/prKey';

export type PrDetailContext = {
  prRef: Accessor<PrRef | undefined>;
  pullRequest: Accessor<GithubPullRequestWithDetails | undefined>;
  loadFailed: Accessor<boolean>;
  discussionSource: ReturnType<typeof createPrDiscussionSource>;
};

/** Owns the PR query and discussion state; consumers compose their own chrome. */
export function PrDetail(props: {
  foreignEntityId: string;
  children: (context: PrDetailContext) => JSX.Element;
}) {
  const notificationSource = useGlobalNotificationSource();
  const foreignEntityQuery = usePrForeignEntityQuery(
    () => props.foreignEntityId
  );
  const data = () =>
    foreignEntityQuery.isSuccess ? foreignEntityQuery.data : undefined;
  const prRef = () => data()?.prRef;
  const pullRequest = () => data()?.pullRequest;
  const loadFailed = () => !pullRequest() && !!foreignEntityQuery.error;

  // Detail-lifetime local Macro discussion (prototype-only, lost on reload).
  const discussionSource = createPrDiscussionSource();

  return (
    <>
      <DebouncedNotificationReadMarker
        notificationSource={notificationSource}
        entity={{ type: 'foreign_entity', id: props.foreignEntityId }}
      />
      {props.children({ prRef, pullRequest, loadFailed, discussionSource })}
    </>
  );
}

export function PrDetailBody(props: { detail: PrDetailContext }) {
  return (
    <Scroll class="flex-1 min-h-0">
      <div class="max-w-3xl mx-auto px-6 pt-12 pb-12 min-w-0">
        <Show
          when={props.detail.prRef()}
          fallback={
            <Show
              when={!props.detail.loadFailed()}
              fallback={
                <PrLoadErrorBanner loadFailed={props.detail.loadFailed} />
              }
            >
              <PrTitleSkeleton />
              <div class="spacer h-3" />
              <PrMetadataSkeleton />
              <PrDescriptionSkeleton />
              <PrTimelineSkeleton />
            </Show>
          }
        >
          {(ref) => (
            <>
              <PrTitle prRef={ref()} pullRequest={props.detail.pullRequest} />
              <div class="spacer h-3" />
              <PrMetadata prRef={ref()} pullRequest={props.detail.pullRequest} />
              <PrDescription pullRequest={props.detail.pullRequest} />
              <PrLoadErrorBanner loadFailed={props.detail.loadFailed} />
              <PrTimeline
                githubItems={props.detail.pullRequest()?.comments ?? []}
                source={props.detail.discussionSource}
              />
            </>
          )}
        </Show>
      </div>
    </Scroll>
  );
}

/** Shared native layout. The consumer supplies the top bar above the content and side panel. */
export function PrDetailLayout(props: {
  foreignEntityId: string;
  detail: PrDetailContext;
  children: JSX.Element;
}) {
  return (
    <SidePanel.Root persistKey={`pr:${props.foreignEntityId}`}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
        {props.children}
        <div class="relative min-h-0 min-w-0 flex-1">
          <SidePanel.Layout headerToggle={false}>
            <PrSidePanelSections enrichment={props.detail.pullRequest} />
            <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
              <PrDetailBody detail={props.detail} />
            </div>
          </SidePanel.Layout>
        </div>
      </div>
    </SidePanel.Root>
  );
}

export function PrDetailActions(props: { detail: PrDetailContext }) {
  return (
    <div class="ml-auto flex shrink-0 items-center gap-2">
      <Show when={props.detail.prRef()}>
        {(ref) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openExternalUrl(props.detail.pullRequest()?.url ?? prHtmlUrl(ref()))
            }
          >
            Open on GitHub
          </Button>
        )}
      </Show>
      <SidePanel.Toggle />
    </div>
  );
}

export function StandalonePrDetail(props: { foreignEntityId: string }) {
  return (
    <PrDetail foreignEntityId={props.foreignEntityId}>
      {(detail) => (
        <PrDetailLayout foreignEntityId={props.foreignEntityId} detail={detail}>
          <ViewShell.TopBar class="touch:flex">
            <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
            <Show when={detail.pullRequest()?.status}>
              {(status) => <PrStatusIcon status={status()} />}
            </Show>
            <span class="min-w-0 truncate text-sm font-semibold">
              {detail.pullRequest()?.name ??
                (detail.prRef() ? prDisplayName(detail.prRef()!) : 'Pull request')}
            </span>
            <PrDetailActions detail={detail} />
          </ViewShell.TopBar>
        </PrDetailLayout>
      )}
    </PrDetail>
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
