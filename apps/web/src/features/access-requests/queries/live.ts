import {
  type AccessChangeEntity,
  refreshSharedAccess,
} from '@queries/access-requests/requests';
import {
  createConnectionWebsocketEffect,
  parseWebsocketPayload,
} from '@service-connection/websocket';
import { shareEntity } from '../core/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function accessChangeEntity(
  entityType: string,
  entityId: string
): AccessChangeEntity | undefined {
  if (
    (entityType === 'calendar_event' || entityType === 'channel') &&
    UUID.test(entityId)
  )
    return { entityType, entityId };
  return shareEntity(entityType, entityId);
}

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
    const entity = accessChangeEntity(data.entityType, data.entityId);
    if (entity) refreshSharedAccess(entity);
  });
}
