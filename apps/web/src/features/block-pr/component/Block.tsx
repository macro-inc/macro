import { ViewShell } from '@app/components/view-shell';
import { ChangesSplit } from '@app/features/changes/changes';
import { SidePanel } from '@components/app/side-panel';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { SplitPanel } from '@components/app/split-panel';
import { useBlockId } from '@core/block';
import { fireAndForget } from '@core/util/fireAndForget';
import { Show } from 'solid-js';
import { createPrActions } from '../primitives/create-pr-actions';
import { prDisplayName, prHtmlUrl } from '../util/prKey';
import { PrDetailActions, PrDetailBody, usePrDetail } from '../views/PrDetail';
import { confirmMergePullRequest } from './MergePullRequestButton';
import { PrChangesProvider } from './PrChanges';
import { PrSplitHeader } from './PrSplitHeader';
import { PrStatusIcon } from './PrStatus';
import { PrSidePanelSections } from './sidepanel/PrSidePanelSections';

/** Legacy block boundary for previews until the block runtime is retired. */
export default function PrBlock() {
  const foreignEntityId = useBlockId();
  const detail = usePrDetail(() => foreignEntityId);
  const actions = createPrActions(detail.data, confirmMergePullRequest);
  const panel = useSplitPanel();
  // Home and other inline previews own the header. Their right slot is where
  // Share, Changes, and details belong; the in-block bar is only a fallback.
  const hostedHeader = () => panel?.layoutRefs.headerRight != null;
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
    <div class="size-full overflow-hidden flex flex-col relative">
      <PrChangesProvider
        foreignEntityId={foreignEntityId}
        pullRequestUrl={githubUrl()}
        pullRequestTitle={detail.data()?.pullRequest.name ?? undefined}
        pullRequestChangeCounts={detail.changeCounts()}
      >
        <SidePanel.Layout floating headerToggle={false}>
          <PrSidePanelSections
            enrichment={detail.data()?.pullRequest}
            status={detail.query.status}
          />
          <ChangesSplit>
            <div class="flex flex-col size-full min-w-0">
              <Show when={!hostedHeader()}>
                <ViewShell.TopBar class="hidden touch:flex">
                  <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
                  <Show when={detail.data()?.pullRequest.status}>
                    {(status) => <PrStatusIcon status={status()} />}
                  </Show>
                  <span class="min-w-0 truncate text-sm font-semibold">
                    {name()}
                  </span>
                  <PrDetailActions detail={detail.data()} actions={actions} />
                </ViewShell.TopBar>
              </Show>
              <Show when={detail.data()}>
                {(data) => <PrSplitHeader detail={data()} actions={actions} />}
              </Show>
              <SplitHeaderRight>
                <PrDetailActions detail={detail.data()} actions={actions} />
              </SplitHeaderRight>
              <PrDetailBody
                foreignEntityId={foreignEntityId}
                data={detail.data()}
                status={detail.query.status}
                discussionSource={detail.discussionSource}
                onRetry={() =>
                  fireAndForget(detail.query.refetch(), 'pr-detail')
                }
              />
            </div>
          </ChangesSplit>
        </SidePanel.Layout>
      </PrChangesProvider>
    </div>
  );
}
