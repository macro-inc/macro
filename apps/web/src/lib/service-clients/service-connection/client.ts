import { isTabFocused } from '@core/signal/tabFocus';
import type { EntityId } from '@core/types';
import { createReconnectEffect } from '@macro-inc/collaboration/websocket';
import { ok } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';

import type { TrackEntityMessage } from './generated/schemas/trackEntityMessage';
import { clearStream } from './stream';
import { ws } from './websocket';

// ref counting on connection_gateway open/close events is needed to avoid breaking
// events if more than one instance of a block is opened. We also retain the entity_type
// so that `open` can be replayed on the new connection_id after a websocket reconnect.
interface TrackedEntity {
  entityType: TrackEntityMessage['entity_type'];
  count: number;
  heartbeat: ReturnType<typeof setInterval>;
  refreshCallbacks: Map<EntityRefresh, number>;
}
const trackedEntities: Map<EntityId, TrackedEntity> = new Map();
type EntityTarget = Pick<TrackEntityMessage, 'entity_id' | 'entity_type'>;
type EntityRefresh = (entity: EntityTarget) => void;

export const connectionGatewayClient = {
  async trackEntity(args: TrackEntityMessage) {
    const tracked = trackedEntities.get(args.entity_id);
    if (args.action === 'open') {
      if (tracked) {
        tracked.count += 1;
        return ok({});
      } else {
        trackedEntities.set(args.entity_id, {
          entityType: args.entity_type,
          count: 1,
          heartbeat: setInterval(() => {
            if (isTabFocused())
              void connectionGatewayClient.trackEntity({
                ...args,
                action: 'ping',
              });
          }, 20_000),
          refreshCallbacks: new Map(),
        });
      }
    } else if (args.action === 'close') {
      if (!tracked) return ok({});
      else if (tracked.count > 1) {
        tracked.count -= 1;
        return ok({});
      } else {
        clearInterval(tracked.heartbeat);
        trackedEntities.delete(args.entity_id);
        clearStream(args.entity_id);
      }
    }
    ws.send({
      type: 'track_entity',
      ...args,
    });
    return ok({});
  },
};

/** Share tracking and heartbeats; refresh once on subscription and reconnect. */
export function useEntitySubscription(
  entity: Accessor<EntityTarget | undefined>,
  onRefresh?: EntityRefresh
): void {
  const target = createMemo(entity, undefined, {
    equals: (previous, next) =>
      previous?.entity_type === next?.entity_type &&
      previous?.entity_id === next?.entity_id,
  });
  createEffect(
    on(target, (value) => {
      if (!value) return;
      const track = (action: TrackEntityMessage['action']) =>
        void connectionGatewayClient.trackEntity({ ...value, action });
      track('open');
      const callbacks = trackedEntities.get(value.entity_id)!.refreshCallbacks;
      if (onRefresh) {
        const count = callbacks.get(onRefresh) ?? 0;
        callbacks.set(onRefresh, count + 1);
        // A cached view may have missed updates while nobody tracked its parent.
        if (count === 0) onRefresh(value);
      }
      onCleanup(() => {
        if (onRefresh) {
          const count = callbacks.get(onRefresh) ?? 0;
          if (count > 1) callbacks.set(onRefresh, count - 1);
          else callbacks.delete(onRefresh);
        }
        track('close');
      });
    })
  );
}

/**
 * Re-sends `open` for every tracked entity when the socket reconnects. A reconnect gets a new
 * connection_id, but `open` is only sent once on mount (and is ref-count guarded), so without
 * this the new connection has no presence row or stream subscription for still-open entities.
 */
export function useReopenTrackedEntitiesOnReconnect(): void {
  createReconnectEffect(ws, () => {
    for (const [
      entity_id,
      { entityType, refreshCallbacks },
    ] of trackedEntities) {
      const entity = { entity_id, entity_type: entityType };
      ws.send({
        type: 'track_entity',
        ...entity,
        action: 'open',
      });
      for (const onRefresh of refreshCallbacks.keys()) onRefresh(entity);
    }
  });
}
