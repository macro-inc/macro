import { ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationServiceClient } from './client';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@core/constant/servers', () => ({
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
