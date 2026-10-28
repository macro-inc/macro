import { ENABLE_LIVE_INDICATORS } from '@core/constant/featureFlags';
import { createWebsocketEventEffect } from '@macro-inc/collaboration/websocket';
import {
  reportInvalidTrackingChange,
  reportTrackingChange,
} from '@service-connection/presence-telemetry';
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
    let update: z.infer<typeof trackingUpdate>;
    try {
      update = trackingUpdate.parse(JSON.parse(data.data));
    } catch (error) {
      reportInvalidTrackingChange(error);
      return;
    }
    const previous = unwrap(indicatorStore[update.entity_id]);
    if (!sameUsers(previous, update.user_ids))
      reportTrackingChange(update, update.user_ids, previous);
    setIndicatorStore(update.entity_id, update.user_ids);
  }
);

function sameUsers(previous: string[] | undefined, next: string[]) {
  if (previous?.length !== next.length) return false;
  const nextSet = new Set(next);
  return previous.every((id) => nextSet.has(id));
}
export const useUserIndicators = (entityId: Accessor<string>) => {
  if (!ENABLE_LIVE_INDICATORS) return () => [];
  const indicators = () => unwrap(indicatorStore[entityId()]);
  return indicators;
};
