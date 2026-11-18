import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markChannelsAsRead } from '../notification-helpers';

const mocks = vi.hoisted(() => ({
  entitySeen: vi.fn(async () => []),
}));

vi.mock('@queries/notification/entity-mutations', () => ({
  toNotificationEntityRef: vi.fn(),
  updateNotificationsForEntities: mocks.entitySeen,
}));

beforeEach(() => {
  mocks.entitySeen.mockClear();
});

describe('marking channels as read', () => {
  it('writes once per distinct channel', async () => {
    await markChannelsAsRead(['one', 'two', 'one']);
    expect(mocks.entitySeen).toHaveBeenCalledExactlyOnceWith({
      entities: [
        { type: 'channel', id: 'one' },
        { type: 'channel', id: 'two' },
      ],
      operation: 'MARK_SEEN',
    });
  });
});
