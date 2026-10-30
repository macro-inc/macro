import { refreshSharedAccess } from '@queries/access-requests/requests';
import {
  createConnectionWebsocketEffect,
  parseWebsocketPayload,
} from '@service-connection/websocket';
import { shareEntity } from '../core/types';

/** Independent of notification mute/read state; owned once by the app root. */
export function useAccessRequestInvalidations() {
  createConnectionWebsocketEffect((message) => {
    if (message.type !== 'access_requests_changed') return;
    const data = parseWebsocketPayload<unknown>(message.type, message.data);
    if (
      !data ||
      typeof data !== 'object' ||
      !('entityType' in data) ||
      !('entityId' in data) ||
      typeof data.entityType !== 'string' ||
      typeof data.entityId !== 'string'
    )
      return;
    const entity = shareEntity(data.entityType, data.entityId);
    if (entity) refreshSharedAccess(entity);
  });
}
