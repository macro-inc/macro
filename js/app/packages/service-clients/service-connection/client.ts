import { ok } from '@core/util/maybeResult';
import type { TrackEntityMessage } from './generated/schemas/trackEntityMessage';
import { clearStream } from './stream';
import { ws } from './websocket';

export const connectionGatewayClient = {
  async trackEntity(args: TrackEntityMessage) {
    if (args.action === 'close') clearStream(args.entity_id);
    ws.send({
      type: 'track_entity',
      ...args,
    });
    return ok({});
  },
};
