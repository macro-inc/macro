import { useBlockId } from '@core/block';
import { ENABLE_LIVE_INDICATORS } from '@core/constant/featureFlags';
import { createWebsocketEventEffect } from '@macro-inc/collaboration/websocket';
import { type FromWebsocketMessage, ws } from '@service-connection/websocket';
import type { Accessor } from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import { z } from 'zod';

type IndicatorStore = Record<string, string[]>;

const [indicatorStore, setIndicatorStore] = createStore<IndicatorStore>({});

const trackingUpdate = z.object({
  entity_id: z.string(),
  user_ids: z.array(z.string()),
  entity_type: z.string(),
});

createWebsocketEventEffect(
  ws,
  'user_tracking_change',
  (data: FromWebsocketMessage) => {
    if (!ENABLE_LIVE_INDICATORS) return;
    const update = trackingUpdate.parse(JSON.parse(data.data));
    setIndicatorStore(update.entity_id, update.user_ids);
  }
);

export const useEntityIndicators = (entityId: Accessor<string | undefined>) => {
  if (!ENABLE_LIVE_INDICATORS) return () => [] as string[];
  return () => unwrap(indicatorStore[entityId() ?? '']) ?? [];
};

export const useUserIndicators = () => {
  const blockId = useBlockId();
  return useEntityIndicators(() => blockId);
};
