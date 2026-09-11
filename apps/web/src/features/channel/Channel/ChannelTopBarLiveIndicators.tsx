import { useBlockId } from '@core/block';
import { EntityTopBarLiveIndicators } from '@core/component/LiveIndicators';

export function ChannelTopBarLiveIndicators() {
  const channelId = useBlockId();
  return (
    <EntityTopBarLiveIndicators
      entityType="channel"
      entityId={() => channelId}
    />
  );
}
