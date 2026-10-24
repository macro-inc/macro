import { expect, it, vi } from 'vitest';
import { accessChangeEntity } from './live';

vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
  parseWebsocketPayload: vi.fn(),
}));
vi.mock('@queries/access-requests/requests', () => ({
  refreshSharedAccess: vi.fn(),
}));

const ID = '0199aaaa-0000-7000-8000-000000000001';

it('accepts the items people lose without a Share surface of their own', () => {
  expect(accessChangeEntity('calendar_event', ID)).toEqual({
    entityType: 'calendar_event',
    entityId: ID,
  });
  expect(accessChangeEntity('channel', ID)).toEqual({
    entityType: 'channel',
    entityId: ID,
  });
  expect(accessChangeEntity('document', ID)).toEqual({
    entityType: 'document',
    entityId: ID,
  });
  expect(accessChangeEntity('channel', 'not-an-id')).toBeUndefined();
  expect(accessChangeEntity('team', ID)).toBeUndefined();
});
