import { ok } from '@core/util/maybeResult';
import type { TrackEntityMessage } from './generated/schemas/trackEntityMessage';
import { ws } from './websocket';

export const connectionGatewayClient = {
  async trackEntity(args: TrackEntityMessage) {
    ws.send({
      type: 'track_entity',
      ...args,
    });
    return ok({});
  },
};
