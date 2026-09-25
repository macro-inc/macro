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
import { type Accessor, createMemo, Show } from 'solid-js';
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

/** Share PR query state without coupling the host's header to the detail body. */
export function usePrDetail(foreignEntityId: Accessor<string>) {
  const foreignEntityQuery = usePrForeignEntityQuery(foreignEntityId);
  const data = () =>
    foreignEntityQuery.isSuccess ? foreignEntityQuery.data : undefined;
  const prRef = () => data()?.prRef;
  const pullRequest = () => data()?.pullRequest;
  const loadFailed = () => !pullRequest() && !!foreignEntityQuery.error;

  // Detail-lifetime local Macro discussion (prototype-only, lost on reload).
  const discussionSource = createPrDiscussionSource();
  return { prRef, pullRequest, loadFailed, discussionSource };
}

type PrDetailBodyProps = {
  foreignEntityId: string;
  prRef?: PrRef;
  pullRequest?: GithubPullRequestWithDetails;
  loadFailed: boolean;
  discussionSource: ReturnType<typeof createPrDiscussionSource>;
};

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
            when={props.prRef}
            fallback={
              <Show
                when={!props.loadFailed}
                fallback={<PrLoadErrorBanner loadFailed={props.loadFailed} />}
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
                <PrTitle prRef={ref()} pullRequest={props.pullRequest} />
                <div class="spacer h-3" />
                <PrMetadata prRef={ref()} pullRequest={props.pullRequest} />
                <PrDescription pullRequest={props.pullRequest} />
                <PrLoadErrorBanner loadFailed={props.loadFailed} />
                <PrTimeline
                  githubItems={props.pullRequest?.comments ?? []}
                  source={props.discussionSource}
                />
              </>
            )}
          </Show>
        </div>
      </Scroll>
    </>
  );
}

/** Native hosts own their header and place this content below it. */
export function PrDetailContent(props: PrDetailBodyProps) {
  return (
    <div class="relative min-h-0 min-w-0 flex-1">
      <SidePanel.Layout headerToggle={false}>
        <PrSidePanelSections enrichment={props.pullRequest} />
        <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
          <PrDetailBody
            foreignEntityId={props.foreignEntityId}
            prRef={props.prRef}
            pullRequest={props.pullRequest}
            loadFailed={props.loadFailed}
            discussionSource={props.discussionSource}
          />
        </div>
      </SidePanel.Layout>
    </div>
  );
}

export function PrDetailActions(props: {
  prRef?: PrRef;
  pullRequest?: GithubPullRequestWithDetails;
}) {
  return (
    <div class="ml-auto flex shrink-0 items-center gap-2">
      <Show when={props.prRef}>
        {(ref) => (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openExternalUrl(props.pullRequest?.url ?? prHtmlUrl(ref()))
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
  const detail = usePrDetail(() => props.foreignEntityId);
  const name = () => {
    const ref = detail.prRef();
    return (
      detail.pullRequest()?.name ?? (ref ? prDisplayName(ref) : 'Pull request')
    );
  };
  return (
    <SidePanel.Root persistKey={`pr:${props.foreignEntityId}`}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden @container">
        <ViewShell.TopBar class="touch:flex">
          <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
          <Show when={detail.pullRequest()?.status}>
            {(status) => <PrStatusIcon status={status()} />}
          </Show>
          <span class="min-w-0 truncate text-sm font-semibold">{name()}</span>
          <PrDetailActions
            prRef={detail.prRef()}
            pullRequest={detail.pullRequest()}
          />
        </ViewShell.TopBar>
        <PrDetailContent
          foreignEntityId={props.foreignEntityId}
          prRef={detail.prRef()}
          pullRequest={detail.pullRequest()}
          loadFailed={detail.loadFailed()}
          discussionSource={detail.discussionSource}
        />
      </div>
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
          <span class={PR_PILL_CLASS}>
            <span class="text-success">+{props.pullRequest?.additions ?? 0}</span>
            <span class="text-failure">−{props.pullRequest?.deletions ?? 0}</span>
          </span>
        </Layer>
      </Show>
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

function PrLoadErrorBanner(props: { loadFailed: boolean }) {
  return (
    <Show when={props.loadFailed}>
      <div class="mt-6 px-3 py-2 rounded-lg border border-edge-muted text-xs text-ink-muted">
        Couldn't load this pull request from cached GitHub data.
      </div>
    </Show>
  );
}
