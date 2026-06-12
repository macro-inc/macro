import { SidePanel } from '@app/component/side-panel';
import { useBlockId } from '@core/block';
import { useUrlParams } from '@core/component/ParamsProvider';
import { toast } from '@core/component/Toast/Toast';
import { useDocumentGithubPullRequestsQuery } from '@queries/storage/github-pull-requests';
import { authServiceClient } from '@service-auth/client';
import { cn, Layer, Scroll } from '@ui';
import { createMemo, Show, Suspense } from 'solid-js';

import { URL_PARAMS } from '../constants';
import { createPrDiscussionSource } from '../data/prDiscussionSource';
import { isGithubLinkError, usePrEnrichmentQuery } from '../data/queries';
import type { PrRef } from '../util/prKey';
import { decodePrKey, prDisplayName, toGithubKey } from '../util/prKey';
import { PrContentSkeleton } from './PrSkeletons';
import { PR_PILL_CLASS, PrSplitHeader, PrStatusChip } from './PrSplitHeader';
import { PrTimeline } from './PrTimeline';
import { PrSidePanelSections } from './sidepanel/PrSidePanelSections';

export default function PrBlock() {
  const blockId = useBlockId();
  const prRef = decodePrKey(blockId);

  return (
    <Show
      when={prRef}
      fallback={
        <div class="flex h-full items-center justify-center text-ink-placeholder text-sm">
          Invalid pull request reference
        </div>
      }
    >
      {(ref) => <PrBlockContent prRef={ref()} />}
    </Show>
  );
}

function PrBlockContent(props: { prRef: PrRef }) {
  const params = useUrlParams(URL_PARAMS);
  const taskId = () => params.task() ?? null;

  // Primary source: the linking task's stored GitHub data. Team-visible
  // (populated by the GitHub App installation via webhooks) — no personal
  // GitHub link required. The hook layers live enrichment on top when the
  // user does have a link, and silently falls back to stored data otherwise.
  const taskPullRequestsQuery = useDocumentGithubPullRequestsQuery(
    taskId,
    () => !!taskId()
  );
  const taskPullRequest = createMemo(() => {
    const githubKey = toGithubKey(props.prRef);
    return taskPullRequestsQuery.data?.pullRequests.find(
      (pullRequest) => pullRequest.githubKey === githubKey
    );
  });

  // Fallback when opened without a task (pasted URL, entity lists): live
  // enrichment via the user's personal GitHub link.
  const enrichmentQuery = usePrEnrichmentQuery(
    () => props.prRef,
    () => !taskId()
  );

  const pullRequest = createMemo(() =>
    taskId() ? taskPullRequest() : enrichmentQuery.data
  );

  // Only surface load problems when there's nothing to render — seeded or
  // stored data with a failed background refresh still displays fine.
  const needsGithubLink = createMemo(
    () =>
      !taskId() && !pullRequest() && isGithubLinkError(enrichmentQuery.error)
  );
  const loadFailed = createMemo(
    () =>
      !taskId() &&
      !pullRequest() &&
      !!enrichmentQuery.error &&
      !needsGithubLink()
  );

  // Block-lifetime local Macro discussion (prototype-only, lost on reload).
  const discussionSource = createPrDiscussionSource();

  return (
    <div class="size-full overflow-hidden flex flex-col relative">
      <SidePanel.Layout>
        {/* Fallback registers the same sections without reading query data,
            so the panel shows loading rows instead of suspending the block. */}
        <Suspense fallback={<PrSidePanelSections enrichment={undefined} />}>
          <PrSidePanelSections enrichment={pullRequest()} />
        </Suspense>
        <div class="flex flex-col size-full min-w-0">
          {/* Reading query data suspends until the GitHub roundtrip resolves;
              the fallback renders the same chrome from the URL ref alone. */}
          <Suspense
            fallback={
              <PrSplitHeader prRef={props.prRef} enrichment={undefined} />
            }
          >
            <PrSplitHeader prRef={props.prRef} enrichment={pullRequest()} />
          </Suspense>

          <Scroll class="flex-1 min-h-0">
            <div class="max-w-3xl mx-auto px-6 pt-12 pb-12 min-w-0">
              <Suspense fallback={<PrContentSkeleton prRef={props.prRef} />}>
                <h1 class="ph-no-capture text-2xl font-semibold">
                  {pullRequest()?.name ?? prDisplayName(props.prRef)}
                </h1>

                <div class="spacer h-3" />
                <div class="mb-6 flex flex-row flex-wrap items-center gap-2 text-sm empty:hidden">
                  <Show when={pullRequest()?.status}>
                    {(status) => <PrStatusChip status={status()} />}
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
                      pullRequest()?.additions != null ||
                      pullRequest()?.deletions != null
                    }
                  >
                    <Layer depth={2}>
                      <span class={PR_PILL_CLASS}>
                        <span class="text-success">
                          +{pullRequest()?.additions ?? 0}
                        </span>
                        <span class="text-failure">
                          −{pullRequest()?.deletions ?? 0}
                        </span>
                      </span>
                    </Layer>
                  </Show>
                </div>

                {/* The PR description body isn't returned by the enrich/storage
                  endpoints yet — render it here once the backend exposes it. */}

                <Show when={needsGithubLink()}>
                  <ConnectGithubBanner />
                </Show>
                <Show when={loadFailed()}>
                  <div class="mt-6 px-3 py-2 rounded-lg border border-edge-muted text-xs text-ink-muted">
                    Couldn't load pull request details from GitHub. The
                    discussion below still works.
                  </div>
                </Show>

                <PrTimeline
                  githubItems={pullRequest()?.comments ?? []}
                  source={discussionSource}
                />
              </Suspense>
            </div>
          </Scroll>
        </div>
      </SidePanel.Layout>
    </div>
  );
}

function ConnectGithubBanner() {
  const handleConnect = async () => {
    const result = await authServiceClient.reauthenticateGithub(
      window.location.href
    );
    if (result.isErr()) {
      toast.failure('Failed to start GitHub connect flow');
      return;
    }
    window.location.href = result.value;
  };

  return (
    <div class="mt-6 flex items-center gap-3 px-3 py-2 rounded-lg border border-edge-muted text-xs">
      <span class="text-ink-muted min-w-0">
        Connect your GitHub account to load this pull request's details and
        comments.
      </span>
      <button
        type="button"
        class="ml-auto shrink-0 px-2 py-1 rounded-lg border border-edge-muted hover:bg-hover hover-transition-bg"
        onClick={() => void handleConnect()}
      >
        Connect GitHub
      </button>
    </div>
  );
}
