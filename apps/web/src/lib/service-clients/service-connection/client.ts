import { isTabVisible } from '@core/signal/tabFocus';
import type { EntityId } from '@core/types';
import { fireAndForget } from '@core/util/fireAndForget';
import { ok } from 'neverthrow';
import type { TrackEntityMessage } from './generated/schemas/trackEntityMessage';
import { reportHeartbeatLapse, reportTrack } from './presence-telemetry';
import { clearStream } from './stream';
import { ws } from './websocket';

// ref counting on connection_gateway open/close events is needed to avoid breaking
// events if more than one instance of a block is opened. We also retain the entity_type
// so that `open` can be replayed on the new connection_id after a websocket reconnect.
interface TrackedEntity {
  entityType: TrackEntityMessage['entity_type'];
  count: number;
  heartbeat: ReturnType<typeof setInterval>;
  /** When this tab last told the gateway it is watching, by `open` or `ping`. */
  lastSeen: number;
  lapseReported: boolean;
  refreshCallbacks: Map<EntityRefresh, number>;
}
export const trackedEntities: Map<EntityId, TrackedEntity> = new Map();
type EntityTarget = Pick<TrackEntityMessage, 'entity_id' | 'entity_type'>;
type EntityRefresh = (entity: EntityTarget) => void;

// The gateway sends an entity's events only to connections that opened or
// pinged it this recently (connection_gateway's DEFAULT_TIMEOUT_THRESHOLD).
export const GATEWAY_ACTIVITY_WINDOW_MS = 60_000;

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
          // Visible, not focused: someone reading beside the window they are
          // typing in is still looking, and should keep their presence dot.
          heartbeat: setInterval(() => {
            if (isTabVisible())
              fireAndForget(
                connectionGatewayClient.trackEntity({
                  ...args,
                  action: 'ping',
                }),
                'connection-gateway'
              );
            else reportLapseOnce(args);
          }, 20_000),
          lastSeen: Date.now(),
          lapseReported: false,
          refreshCallbacks: new Map(),
        });
      }
    } else if (args.action === 'ping') {
      if (tracked) {
        tracked.lastSeen = Date.now();
        tracked.lapseReported = false;
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
    if (args.action !== 'ping') reportTrack(args, args.action, isSocketOpen());
    ws.send({
      type: 'track_entity',
      ...args,
    });
    return ok({});
  },
};

// The underlying socket is unassigned until the first URL resolves.
const isSocketOpen = () => {
  try {
    return ws.readyState === WebSocket.OPEN;
  } catch {
    return false;
  }
};

function reportLapseOnce(entity: EntityTarget) {
  const tracked = trackedEntities.get(entity.entity_id);
  if (!tracked || tracked.lapseReported) return;
  const lapsedMs = Date.now() - tracked.lastSeen;
  if (lapsedMs < GATEWAY_ACTIVITY_WINDOW_MS) return;
  tracked.lapseReported = true;
  reportHeartbeatLapse(entity, lapsedMs);
}
