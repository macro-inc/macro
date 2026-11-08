import { describe, expect, test } from 'bun:test';
import type {
  RemoveUnsubscribeItemData,
  UnsubscribeItemData,
} from '../generated/notification/types.gen';
import { Channel } from '../src/entities/channels/channel';
import { Document } from '../src/entities/documents/document';
import type { MacroClient } from '../src/utils/client';

function notificationClient() {
  const muted: Pick<UnsubscribeItemData, 'path' | 'query'>[] = [];
  const unmuted: Pick<RemoveUnsubscribeItemData, 'path'>[] = [];
  const client = {
    notification: {
      unsubscribeItem: async (
        options: Pick<UnsubscribeItemData, 'path' | 'query'>,
      ) => {
        muted.push(options);
        return { data: {} };
      },
      removeUnsubscribeItem: async (
        options: Pick<RemoveUnsubscribeItemData, 'path'>,
      ) => {
        unmuted.push(options);
        return { data: {} };
      },
    },
  } as unknown as MacroClient;
  return { client, muted, unmuted };
}

describe('item notification muting', () => {
  test('mute without a deadline mutes until unmuted', async () => {
    const { client, muted } = notificationClient();

    await Channel.byId(client, 'channel-1').muteNotifications();

    expect(muted).toEqual([
      { path: { item_type: 'channel', item_id: 'channel-1' } },
    ]);
  });

  test('mute with a deadline snoozes until then', async () => {
    const { client, muted } = notificationClient();

    await Document.byId(client, 'document-1').muteNotifications({
      until: new Date('2026-11-06T09:00:00Z'),
    });

    expect(muted).toEqual([
      {
        path: { item_type: 'document', item_id: 'document-1' },
        query: { snoozed_until: '2026-11-06T09:00:00.000Z' },
      },
    ]);
  });

  test('unmute resumes notifications for the item', async () => {
    const { client, unmuted } = notificationClient();

    await Channel.byId(client, 'channel-1').unmuteNotifications();

    expect(unmuted).toEqual([
      { path: { item_type: 'channel', item_id: 'channel-1' } },
    ]);
  });
});
