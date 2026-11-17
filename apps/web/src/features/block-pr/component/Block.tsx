import { SidePanel } from '@components/app/side-panel';
import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { useBlockId } from '@core/block';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Show } from 'solid-js';
import { createPrActions } from '../primitives/create-pr-actions';
import { PrDetailActions, PrDetailBody, usePrDetail } from '../views/PrDetail';
import { confirmMergePullRequest } from './MergePullRequestButton';
import { PrSplitHeader } from './PrSplitHeader';
import { PrSidePanelSections } from './sidepanel/PrSidePanelSections';

/** Legacy block boundary for previews until the block runtime is retired. */
export default function PrBlock() {
  const foreignEntityId = useBlockId();
  const detail = usePrDetail(() => foreignEntityId);
  const actions = createPrActions(detail.data, confirmMergePullRequest);
  return (
    <div class="size-full overflow-hidden flex flex-col relative">
      <SidePanel.Layout floating headerToggle={!isTouchDevice()}>
        <PrSidePanelSections
          enrichment={detail.data()?.pullRequest}
          status={detail.query.status}
        />
        <div class="flex flex-col size-full min-w-0">
          <Show when={detail.data()}>
            {(data) => <PrSplitHeader detail={data()} actions={actions} />}
          </Show>
          {/* Touch headers carry the same actions as the standalone PR. */}
          <Show when={isTouchDevice()}>
            <SplitHeaderRight>
              <PrDetailActions detail={detail.data()} actions={actions} />
            </SplitHeaderRight>
          </Show>
          <PrDetailBody
            foreignEntityId={foreignEntityId}
            data={detail.data()}
            status={detail.query.status}
            discussionSource={detail.discussionSource}
            onRetry={() => fireAndForget(detail.query.refetch(), 'pr-detail')}
          />
        </div>
      </SidePanel.Layout>
    </div>
  );
}
