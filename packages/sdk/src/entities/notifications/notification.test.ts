import { describe, expect, test } from 'bun:test';
import type { ApiUserNotification } from '../../../generated/notification/types.gen';
import type { MacroClient } from '../../utils/client';
import { Notification } from './notification';

const client = new Proxy({} as MacroClient, {
  get() {
    throw new Error('Seeded state access must not fetch');
  },
});

describe('notification lifecycle state', () => {
  for (const state of ['unseen', 'seen', 'done'] as const) {
    test(`${state} is authoritative regardless of viewing timestamp`, async () => {
      for (const viewed_at of [null, '2020-01-02T00:00:00Z']) {
        const record: ApiUserNotification = {
          id: 'notification-1',
          entity_id: 'channel-1',
          entity_type: 'channel',
          owner_id: 'macro|user@example.com',
          notification_event_type: 'channel_invite',
          notification_metadata: {
            tag: 'channel_invite',
            content: { invitedBy: 'macro|other@example.com' },
          },
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2020-01-01T00:00:00Z',
          sent: true,
          state,
          viewed_at,
        };
        const notification = Notification.from(client, record);
        expect(await notification.state()).toBe(state);
        const done = notification.done;
        expect(await done()).toBe(state === 'done');
        expect(await notification.seen()).toBe(state !== 'unseen');
      }
    });
  }
});
