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

describe('channel notification settings', () => {
  test('reads the channel among the user’s settings, defaulting when absent', async () => {
    const client = {
      notification: {
        listChannelNotificationSettings: async () => ({
          data: {
            channels: [
              {
                channelId: 'channel-1',
                disabled: ['channel_message_send'],
                enabled: ['channel_mention'],
                overridesSectionMute: true,
              },
            ],
          },
        }),
      },
    } as unknown as MacroClient;

    expect(
      await Channel.byId(client, 'channel-1').notificationSettings(),
    ).toEqual({
      disabled: ['channel_message_send'],
      enabled: ['channel_mention'],
      overridesSectionMute: true,
    });
    expect(
      await Channel.byId(client, 'channel-2').notificationSettings(),
    ).toEqual({
      disabled: [],
      enabled: [],
      overridesSectionMute: false,
    });
  });

  test('sends a partial change for the channel', async () => {
    const updates: unknown[] = [];
    const client = {
      notification: {
        updateChannelNotificationSettings: async (options: unknown) => {
          updates.push(options);
          return {
            data: {
              channelId: 'channel-1',
              disabled: ['channel_message_reaction'],
              enabled: [],
              overridesSectionMute: false,
            },
          };
        },
      },
    } as unknown as MacroClient;

    const settings = await Channel.byId(
      client,
      'channel-1',
    ).setNotificationSettings({
      disable: ['channel_message_reaction'],
      inherit: ['channel_mention'],
    });

    expect(updates).toEqual([
      {
        path: { channel_id: 'channel-1' },
        body: {
          disable: ['channel_message_reaction'],
          inherit: ['channel_mention'],
        },
      },
    ]);
    expect(settings.disabled).toEqual(['channel_message_reaction']);
  });
});
