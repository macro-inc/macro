import type { ApiChannelMessage } from '@service-comms/client';
import { describe, expect, it } from 'vitest';
import {
  insertTopLevelMessageIntoChannelMessages,
  type ChannelMessagesData,
} from '../channel-messages';
import { buildChannelMessageListMeta } from '@channel/Channel/message-list-meta';

function makeMessage(
  id: string,
  createdAt: string,
  senderId = 'user-1'
): ApiChannelMessage {
  return {
    id,
    channel_id: 'channel-1',
    sender_id: senderId,
    content: `Message ${id}`,
    created_at: createdAt,
    updated_at: createdAt,
    deleted_at: undefined,
    edited_at: undefined,
    attachments: [],
    reactions: [],
    thread: { preview: [], reply_count: 0, latest_reply_at: null },
  };
}

function buildIndex(data: ChannelMessagesData) {
  const items: ApiChannelMessage[] = [];
  const keys: string[] = [];
  const byId = new Map<string, ApiChannelMessage>();
  const pages = data.pages;
  if (!pages.length) return { items, keys, byId };

  const seen = new Set<string>();
  for (let i = pages.length - 1; i >= 0; i--) {
    const pageItems = pages[i].items;
    for (let j = pageItems.length - 1; j >= 0; j--) {
      const message = pageItems[j];
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      items.push(message);
      keys.push(message.id);
      byId.set(message.id, message);
    }
  }
  return { items, keys, byId };
}

describe('channel message deduplication', () => {
  it('deduplicates messages that appear in multiple pages', () => {
    const m1 = makeMessage('m1', '2026-04-23T10:00:00Z', 'user-a');
    const m2 = makeMessage('m2', '2026-04-23T10:01:00Z', 'user-a');
    const m3 = makeMessage('m3', '2026-04-23T10:02:00Z', 'user-b');

    const overlappingData: ChannelMessagesData = {
      pages: [
        { items: [m3], next_cursor: null, previous_cursor: null },
        {
          items: [m3, m2, m1],
          next_cursor: 'cursor-m1',
          previous_cursor: 'cursor-m2',
        },
      ],
      pageParams: [{ next_cursor: null, previous_cursor: 'cursor-m2' }, null],
    };

    const index = buildIndex(overlappingData);

    expect(index.keys).toEqual(['m1', 'm2', 'm3']);

    const meta = buildChannelMessageListMeta(index.items, () => false);
    expect(meta['m3'].isGroupedWithPrevious).toBe(false);
  });

  it('skips optimistic insert when newest page has previous_cursor', () => {
    const m1 = makeMessage('m1', '2026-04-23T10:00:00Z');
    const newMsg = makeMessage('m2', '2026-04-23T10:01:00Z');

    const midConversationData: ChannelMessagesData = {
      pages: [
        {
          items: [m1],
          next_cursor: 'cursor-old',
          previous_cursor: 'cursor-new',
        },
      ],
      pageParams: [null],
    };

    const result = insertTopLevelMessageIntoChannelMessages(
      midConversationData,
      newMsg
    );

    expect(result).toBe(midConversationData);
    expect(result!.pages[0].items).toHaveLength(1);
  });

  it('allows optimistic insert when at the bottom of conversation', () => {
    const m1 = makeMessage('m1', '2026-04-23T10:00:00Z');
    const newMsg = makeMessage('m2', '2026-04-23T10:01:00Z');

    const bottomData: ChannelMessagesData = {
      pages: [
        {
          items: [m1],
          next_cursor: 'cursor-old',
          previous_cursor: null,
        },
      ],
      pageParams: [null],
    };

    const result = insertTopLevelMessageIntoChannelMessages(bottomData, newMsg);

    expect(result!.pages[0].items).toHaveLength(2);
    expect(result!.pages[0].items[0].id).toBe('m2');
  });
});
