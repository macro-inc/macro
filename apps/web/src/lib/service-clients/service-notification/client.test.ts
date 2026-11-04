import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationServiceClient } from './client';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@core/constant/servers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/servers')>()),
  SERVER_HOSTS: { 'notification-service': 'http://localhost/notifications' },
}));
vi.mock('@core/util/fetchWithToken', () => ({ fetchWithToken: fetchMock }));

beforeEach(() =>
  fetchMock.mockReset().mockResolvedValue(ok({ items: [], next_cursor: null }))
);

describe('notification list state query parameters', () => {
  it('sends exact state unions and safely encodes cursors', async () => {
    await notificationServiceClient.userNotifications({
      limit: 25,
      cursor: 'a+b/==',
      states: ['unseen', 'seen'],
    });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('states')).toBe('unseen,seen');
    expect(url.searchParams.get('cursor')).toBe('a+b/==');
    expect(url.searchParams.get('limit')).toBe('25');
    expect(url.searchParams.has('done')).toBe(false);
  });

  it('distinguishes default active filtering from explicitly selecting all states', async () => {
    await notificationServiceClient.userNotifications({});
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.has('states')).toBe(
      false
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain('undefined');
    await notificationServiceClient.bulkGetUserNotificationsByEventItemId({
      eventItemIds: ['item'],
      states: [],
    });
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('states')).toBe(
      ''
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      eventItemIds: ['item'],
    });
  });
});

describe('bulk notification preferences', () => {
  it.each(['unsubscribeItems', 'removeUnsubscribeItems'] as const)(
    '%s returns a typed error without sending a partially valid batch',
    async (method) => {
      const result = await notificationServiceClient[method]([
        { item_id: 'valid', item_type: 'channel' },
        { item_id: 'invalid', item_type: 'unsupported' },
      ]);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toEqual([
          {
            code: 'INVALID_ITEM_TYPE',
            message: 'Unsupported notification item type.',
            arg: 'item_type',
          },
        ]);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['unsubscribeItems', 'POST'],
    ['removeUnsubscribeItems', 'DELETE'],
  ] as const)(
    '%s preserves supported types and normalizes aliases',
    async (method, httpMethod) => {
      const result = await notificationServiceClient[method]([
        { item_id: 'channel', item_type: 'channel' },
        { item_id: 'email', item_type: 'email' },
        { item_id: 'thread', item_type: 'thread' },
        { item_id: 'foreign', item_type: 'foreign' },
      ]);

      expect(result.isOk()).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost/notifications/unsubscribe/items',
        {
          method: httpMethod,
          body: JSON.stringify({
            items: [
              { item_id: 'channel', item_type: 'channel' },
              { item_id: 'email', item_type: 'email_thread' },
              { item_id: 'thread', item_type: 'email_thread' },
              { item_id: 'foreign', item_type: 'foreign_entity' },
            ],
          }),
        }
      );
    }
  );
});
