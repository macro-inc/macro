import type { EntityId } from '@core/types';
import { ok } from '@core/util/maybeResult';
import type { TrackEntityMessage } from './generated/schemas/trackEntityMessage';
import { clearStream } from './stream';
import { ws } from './websocket';

// ref counting on connection_gateway open/close events is needed to avoid breaking
// events if more than one incstance of a block is opened
const trackedEntities: Map<EntityId, number> = new Map();

export const connectionGatewayClient = {
  async trackEntity(args: TrackEntityMessage) {
    const trackedCount = trackedEntities.get(args.entity_id);
    if (args.action === 'open') {
      if (trackedCount) {
        trackedEntities.set(args.entity_id, trackedCount + 1);
        return ok({});
      } else {
        trackedEntities.set(args.entity_id, 1);
      }
    } else if (args.action === 'close') {
      if (!trackedCount) return ok({});
      else if (trackedCount > 1) {
        trackedEntities.set(args.entity_id, trackedCount - 1);
        return ok({});
      } else {
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
