import { isTabVisible } from '@core/signal/tabFocus';
import { fireAndForget } from '@core/util/fireAndForget';
import { createReconnectEffect } from '@macro-inc/collaboration/websocket';
import {
  connectionGatewayClient,
  GATEWAY_ACTIVITY_WINDOW_MS,
  trackedEntities,
} from '@service-connection/client';
import type { TrackEntityMessage } from '@service-connection/generated/schemas/trackEntityMessage';
import {
  reportHeartbeatResumed,
  reportReopenOnReconnect,
} from '@service-connection/presence-telemetry';
import { ws } from '@service-connection/websocket';
import {
  type Accessor,
  createEffect,
  createMemo,
  on,
  onCleanup,
} from 'solid-js';

type EntityTarget = Pick<TrackEntityMessage, 'entity_id' | 'entity_type'>;
type EntityRefresh = (entity: EntityTarget) => void;

/** Share tracking and heartbeats; refresh once on subscription, reconnect, and refocus after a long absence. */
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
        fireAndForget(
          connectionGatewayClient.trackEntity({ ...value, action }),
          'connection-gateway'
        );
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
    reportReopenOnReconnect(trackedEntities.size);
    for (const [entity_id, tracked] of trackedEntities) {
      const entity = { entity_id, entity_type: tracked.entityType };
      ws.send({
        type: 'track_entity',
        ...entity,
        action: 'open',
      });
      tracked.lastSeen = Date.now();
      for (const onRefresh of tracked.refreshCallbacks.keys())
        onRefresh(entity);
    }
  });
}

/**
 * Pings every tracked entity as soon as the tab is visible again, since the heartbeat pauses in
 * the background. A tab that went unseen longer than the gateway's activity window was left
 * out of the entity's events meanwhile, so its views refresh as they do after a reconnect.
 */
export function useRefreshTrackedEntitiesOnFocus(): void {
  createEffect(
    on(
      isTabVisible,
      (visible) => {
        if (!visible) return;
        const now = Date.now();
        for (const [entity_id, tracked] of trackedEntities) {
          const entity = { entity_id, entity_type: tracked.entityType };
          const pausedMs = now - tracked.lastSeen;
          const missedEvents = pausedMs >= GATEWAY_ACTIVITY_WINDOW_MS;
          if (missedEvents) reportHeartbeatResumed(entity, pausedMs);
          fireAndForget(
            connectionGatewayClient.trackEntity({
              ...entity,
              action: 'ping',
            }),
            'connection-gateway'
          );
          if (missedEvents)
            for (const onRefresh of tracked.refreshCallbacks.keys())
              onRefresh(entity);
        }
      },
      { defer: true }
    )
  );
}
