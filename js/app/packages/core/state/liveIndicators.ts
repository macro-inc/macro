import { useBlockId } from '@core/block';
import { ENABLE_LIVE_INDICATORS } from '@core/constant/featureFlags';
import { ws } from '@service-connection/websocket';
import { createWebsocketEventEffect } from '@websocket/index';
import { createStore, unwrap } from 'solid-js/store';
import { z } from 'zod';

type IndicatorStore = Record<string, string[]>;

export const [indicatorStore, setIndicatorStore] = createStore<IndicatorStore>(
  {}
);

type IncomingTrackingUpdate = {
  type: 'user_tracking_change';
  data: string;
};

const trackingUpdate = z.object({
  entity_id: z.string(),
  user_ids: z.array(z.string()),
  entity_type: z.string(),
});

createWebsocketEventEffect(
  ws,
  'user_tracking_change',
  (data: IncomingTrackingUpdate) => {
    if (!ENABLE_LIVE_INDICATORS) return;
    const update = trackingUpdate.parse(JSON.parse(data.data));
    setIndicatorStore(update.entity_id, update.user_ids);
  }
);
export const useUserIndicators = () => {
  if (!ENABLE_LIVE_INDICATORS) return () => [];
  const indicators = () => unwrap(indicatorStore[useBlockId()]);
  return indicators;
};
