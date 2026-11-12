import { describe, expect, test } from 'bun:test';
import type {
  MessageListItem,
  Message as MessageRecord,
} from '../../../generated/storage/types.gen';
import type { MacroClient } from '../../utils/client';
import { Message } from './message';

function record(id: string, threadId?: string): MessageRecord {
  return {
    id,
    thread_id: threadId ?? null,
    content: `body of ${id}`,
    sender_id: 'macro|user@example.com',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    mentions: [],
  } as unknown as MessageRecord;
}

function contextClient(target: MessageRecord) {
  const selections: unknown[] = [];
  const client = {
    storage: {
      entityMessageGetMessage: async () => ({ data: target }),
      // The timeline answers newest first.
      messageTimeline: async (options: { query: { selection: string } }) => {
        selections.push(JSON.parse(options.query.selection));
        return {
          data: {
            items: ['root-5', 'root-4', 'root-3', 'root-2', 'root-1'].map(
              (id) => record(id) as MessageListItem,
            ),
          },
        };
      },
      entityMessageGetThread: async () => ({
        data: {
          replies: ['reply-1', 'reply-2', 'reply-3', 'reply-4'].map((id) =>
            record(id, 'root-3'),
          ),
        },
      }),
    },
  } as unknown as MacroClient;
  return { client, selections };
}

describe('Message.context', () => {
  test('a reply gets its root, the roots around it and its neighbouring replies', async () => {
    const { client, selections } = contextClient(record('reply-3', 'root-3'));

    const context = await Message.byId(client, 'channel-1', 'reply-3').context({
      channelBefore: 2,
      channelAfter: 2,
      threadBefore: 1,
      threadAfter: 0,
    });

    expect(selections).toEqual([{ around: 'reply-3', limit: 5 }]);
    expect(context.message.id).toBe('reply-3');
    expect(context.root.id).toBe('root-3');
    expect(context.before.map((m) => m.id)).toEqual(['root-1', 'root-2']);
    expect(context.after.map((m) => m.id)).toEqual(['root-4', 'root-5']);
    expect(context.thread?.before.map((m) => m.id)).toEqual(['reply-2']);
    expect(context.thread?.after.map((m) => m.id)).toEqual([]);
    expect(context.thread?.omittedBefore).toBe(1);
    expect(context.thread?.omittedAfter).toBe(1);
  });

  test('a top-level message is its own root and has no thread context', async () => {
    const { client, selections } = contextClient(record('root-3'));

    const context = await Message.byId(client, 'channel-1', 'root-3').context();

    expect(selections).toEqual([{ around: 'root-3', limit: 7 }]);
    expect(context.root.id).toBe('root-3');
    expect(context.before.map((m) => m.id)).toEqual(['root-1', 'root-2']);
    expect(context.after.map((m) => m.id)).toEqual(['root-4', 'root-5']);
    expect(context.thread).toBeUndefined();
  });

  test('options that are not finite numbers fall back to the defaults', async () => {
    const { client, selections } = contextClient(record('root-3'));

    await Message.byId(client, 'channel-1', 'root-3').context({
      channelBefore: Number.NaN,
      channelAfter: Number.POSITIVE_INFINITY,
    });

    expect(selections).toEqual([{ around: 'root-3', limit: 7 }]);
  });
});
