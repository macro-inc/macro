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
        <PrSidePanelSections enrichment={detail.pullRequest()} />
        <div class="flex flex-col size-full min-w-0">
          <Show when={detail.prRef()}>
            {(ref) => (
              <PrSplitHeader
                foreignEntityId={foreignEntityId}
                prRef={ref()}
                enrichment={detail.pullRequest()}
              />
            )}
          </Show>
          <PrDetailBody
            foreignEntityId={foreignEntityId}
            prRef={detail.prRef()}
            pullRequest={detail.pullRequest()}
            loadFailed={detail.loadFailed()}
            discussionSource={detail.discussionSource}
          />
        </div>
      </SidePanel.Layout>
    </div>
  );
}
