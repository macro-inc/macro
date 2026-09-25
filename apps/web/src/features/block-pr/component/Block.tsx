import { SidePanel } from '@components/app/side-panel';
import { useBlockId } from '@core/block';
import { Show } from 'solid-js';
import { PrDetailBody, usePrDetail } from '../views/PrDetail';
import { PrSplitHeader } from './PrSplitHeader';
import { PrSidePanelSections } from './sidepanel/PrSidePanelSections';

/** Legacy block boundary for previews until the block runtime is retired. */
export default function PrBlock() {
  const foreignEntityId = useBlockId();
  const detail = usePrDetail(() => foreignEntityId);
  return (
    <div class="size-full overflow-hidden flex flex-col relative">
      <SidePanel.Layout>
        <PrSidePanelSections enrichment={detail.data()?.pullRequest} />
        <div class="flex flex-col size-full min-w-0">
          <Show when={detail.data()}>
            {(data) => (
              <PrSplitHeader
                foreignEntityId={foreignEntityId}
                prRef={data().prRef}
                enrichment={data().pullRequest}
              />
            )}
          </Show>
          <PrDetailBody
            foreignEntityId={foreignEntityId}
            data={detail.data()}
            status={detail.query.status}
            discussionSource={detail.discussionSource}
            onRetry={() => void detail.query.refetch()}
          />
        </div>
      </SidePanel.Layout>
    </div>
  );
}
