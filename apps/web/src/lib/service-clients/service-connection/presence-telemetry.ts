import {
  type Websocket,
  WebsocketEvent,
} from '@macro-inc/collaboration/websocket';
import { Telemetry } from '@macro-inc/observability';
import type { TrackEntityMessage } from './generated/schemas/trackEntityMessage';

/** Socket lifecycle; a socket that stops retrying drops the user from every entity's presence. */
export function instrumentGatewaySocket(ws: Websocket<any, any>) {
  ws.addEventListener(WebsocketEvent.Close, (_, event) => {
    Telemetry.warn('connection_gateway.ws.close', {
      'ws.close_code': event.code,
      'ws.close_reason': event.reason,
      'ws.was_clean': event.wasClean,
    });
  });
  ws.addEventListener(WebsocketEvent.Reconnect, (_, event) => {
    Telemetry.info('connection_gateway.ws.reconnect', {
      'ws.retries': event.detail.retries,
    });
  });
  ws.addEventListener(WebsocketEvent.retry, (instance, event) => {
    if (
      instance.maxRetries === undefined ||
      event.detail.retries < instance.maxRetries
    )
      return;
    Telemetry.error('connection_gateway.ws.final_retry', {
      'ws.retries': event.detail.retries,
      'ws.max_retries': instance.maxRetries,
    });
  });
}

type EntityTarget = { entity_id: string; entity_type: string };

const entityAttributes = (entity: EntityTarget) => ({
  'presence.entity_type': entity.entity_type,
  'presence.entity_id': entity.entity_id,
});

/** An `open` or `close` actually sent to the gateway (pings are too frequent to log). */
export function reportTrack(
  entity: EntityTarget,
  action: TrackEntityMessage['action'],
  socketOpen: boolean
) {
  Telemetry.info('presence.track', {
    ...entityAttributes(entity),
    'presence.action': action,
    'presence.socket_open': socketOpen,
  });
}

/**
 * The heartbeat was skipped long enough that the gateway no longer counts this
 * tab as viewing the entity, so other viewers stop seeing this user.
 */
export function reportHeartbeatLapse(entity: EntityTarget, lapsedMs: number) {
  Telemetry.warn('presence.heartbeat_lapsed', {
    ...entityAttributes(entity),
    'presence.lapsed_ms': lapsedMs,
    'presence.visibility_state': document.visibilityState,
    'presence.has_focus': document.hasFocus(),
  });
}

export function reportHeartbeatResumed(entity: EntityTarget, pausedMs: number) {
  Telemetry.info('presence.heartbeat_resumed', {
    ...entityAttributes(entity),
    'presence.paused_ms': pausedMs,
  });
}

export function reportReopenOnReconnect(entityCount: number) {
  Telemetry.info('presence.reopen_on_reconnect', {
    'presence.entity_count': entityCount,
  });
}

export function reportTrackingChange(
  entity: EntityTarget,
  userIds: string[],
  previousUserIds: string[] | undefined
) {
  Telemetry.info('presence.tracking_change', {
    ...entityAttributes(entity),
    'presence.user_ids': userIds,
    'presence.user_count': userIds.length,
    'presence.previous_user_count': previousUserIds?.length,
  });
}

export function reportInvalidTrackingChange(error: unknown) {
  Telemetry.warn('presence.tracking_change_invalid', {
    'presence.error': error instanceof Error ? error.message : String(error),
  });
}
