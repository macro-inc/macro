import { SplitHeaderRight } from '@app/component/split-layout/components/SplitHeader';
import { useBlockId } from '@core/block';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { isTabFocused } from '@core/signal/tabFocus';
import { connectionGatewayClient } from '@service-connection/client';
import { onCleanup, onMount } from 'solid-js';

const PING_INTERVAL = 20_000;

export function ChannelTopBarLiveIndicators() {
  const channelId = useBlockId();
  let pingInterval: ReturnType<typeof setInterval> | undefined;

  const trackChannel = (action: 'open' | 'close' | 'ping') => {
    connectionGatewayClient.trackEntity({
      entity_type: 'channel',
      entity_id: channelId,
      action,
    });
  };

  onMount(() => {
    trackChannel('open');
    pingInterval = setInterval(() => {
      if (isTabFocused()) {
        trackChannel('ping');
      }
    }, PING_INTERVAL);
  });

  onCleanup(() => {
    trackChannel('close');
    if (pingInterval) clearInterval(pingInterval);
  });

  return (
    <SplitHeaderRight>
      <div class="-order-1">
        <BlockLiveIndicators />
      </div>
    </SplitHeaderRight>
  );
}
