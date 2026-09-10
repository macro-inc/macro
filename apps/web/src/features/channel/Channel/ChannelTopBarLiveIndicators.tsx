import { SplitHeaderRight } from '@components/app/split-layout/components/SplitHeader';
import { useBlockId } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { useEntitySubscription } from '@service-connection/client';

export function ChannelTopBarLiveIndicators() {
  const channelId = useBlockId();
  useEntitySubscription(() => ({
    entity_type: 'channel',
    entity_id: channelId,
  }));

  return (
    <SplitHeaderRight>
      {/* Hidden on mobile/tablet: no floating-island treatment for live avatars yet. */}
      <div class="-order-1 touch:hidden">
        <BlockLiveIndicators />
      </div>
    </SplitHeaderRight>
  );
}
