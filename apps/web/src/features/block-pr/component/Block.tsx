import { ViewShell } from '@app/components/view-shell';
import { SidePanel } from '@components/app/side-panel';
import { SplitPanel } from '@components/app/split-panel';
import { useBlockId } from '@core/block';
import { fireAndForget } from '@core/util/fireAndForget';
import { Show } from 'solid-js';
import { prDisplayName } from '../util/prKey';
import { PrDetailActions, PrDetailBody, usePrDetail } from '../views/PrDetail';
import { PrSplitHeader } from './PrSplitHeader';
import { PrStatusIcon } from './PrStatus';
import { PrSidePanelSections } from './sidepanel/PrSidePanelSections';

/** Legacy block boundary for previews until the block runtime is retired. */
export default function PrBlock() {
  const foreignEntityId = useBlockId();
  const detail = usePrDetail(() => foreignEntityId);
  const name = () => {
    const data = detail.data();
    return (
      data?.pullRequest.name ??
      (data ? prDisplayName(data.prRef) : 'Pull request')
    );
  };
  return (
    <div class="size-full overflow-hidden flex flex-col relative">
      <SidePanel.Layout floating>
        <PrSidePanelSections
          enrichment={detail.data()?.pullRequest}
          status={detail.query.status}
        />
        <div class="flex flex-col size-full min-w-0">
          <ViewShell.TopBar class="hidden touch:flex">
            <SplitPanel.CloseButton class="hidden shrink-0 touch:flex" />
            <Show when={detail.data()?.pullRequest.status}>
              {(status) => <PrStatusIcon status={status()} />}
            </Show>
            <span class="min-w-0 truncate text-sm font-semibold">{name()}</span>
            <PrDetailActions detail={detail.data()} />
          </ViewShell.TopBar>
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
            onRetry={() => fireAndForget(detail.query.refetch(), 'pr-detail')}
          />
        </div>
      </SidePanel.Layout>
    </div>
  );
}
