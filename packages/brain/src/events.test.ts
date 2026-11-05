import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  eventStream,
  missedMessages,
  type StreamItem,
  sseData,
} from './events.ts';

const bytes = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
const POSTED =
  '{"event_id":"event-1","event_type":"message.posted","metadata":{"message_id":"message-1","content":"hi","created_at":"2026-11-04T10:00:00Z","parent":{"type":"channel","id":"channel-1"},"root_id":"message-1","sender":"macro|bo@example.com"}}';
test('sseData joins events split across chunks and skips keep-alives', async () => {
  const data = await Array.fromAsync(
    sseData(
      bytes(
        ': keep-alive\n\n',
        'data: {"a":',
        '1}\n\ndata: line one\n',
        'data: line two\r\n\r\n'
      )
    )
  );
  assert.deepEqual(data, ['{"a":1}', 'line one\nline two']);
});
test('a dropped stream reconnects and says when it dropped', async () => {
  const stop = new AbortController();
  const opened: number[] = [];
  const sleeps: number[] = [];
  const streams = [
    bytes(`data: ${POSTED}\n\n`),
    bytes(`data: ${POSTED.replace('event-1', 'event-2')}\n\n`),
  ];
  const items: StreamItem[] = [];
  for await (const item of eventStream(
    {
      open: async () => {
        opened.push(opened.length);
        const next = streams.shift();
        if (!next) {
          stop.abort();
          throw new Error('stopped');
        }
        return next;
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      log: () => {},
      now: () => new Date('2026-11-04T10:05:00Z'),
    },
    stop.signal
  )) {
    items.push(item);
  }
  assert.deepEqual(
    items.map((item) =>
      item.kind === 'event'
        ? item.event.eventId
        : item.disconnectedAt.toISOString()
    ),
    ['event-1', '2026-11-04T10:05:00.000Z', 'event-2']
  );
  assert.deepEqual(sleeps, [1000, 1000]);
});
test('catch-up finds roots and thread replies posted since the drop that were not seen', () => {
  const missed = missedMessages(
    'channel-1',
    [
      {
        id: 'root-1',
        content: 'old root',
        created_at: '2026-11-04T09:00:00Z',
        sender_id: 'macro|bo@example.com',
        thread: {
          preview: [
            {
              id: 'reply-2',
              content: 'new reply',
              created_at: '2026-11-04T10:02:00Z',
              sender_id: 'macro|cy@example.com',
            },
          ],
        },
      },
      {
        id: 'root-2',
        content: 'seen already',
        created_at: '2026-11-04T10:01:00Z',
        sender_id: 'macro|bo@example.com',
      },
      {
        id: 'root-3',
        content: 'new root',
        created_at: '2026-11-04T10:01:30Z',
        sender_id: 'macro|bo@example.com',
      },
    ],
    new Date('2026-11-04T10:00:00Z'),
    (id) => id === 'root-2'
  );
  assert.deepEqual(missed, [
    {
      message_id: 'root-3',
      content: 'new root',
      created_at: '2026-11-04T10:01:30Z',
      mentions: [],
      attachments: [],
      parent: { type: 'channel', id: 'channel-1' },
      root_id: 'root-3',
      thread_id: null,
      sender: 'macro|bo@example.com',
    },
    {
      message_id: 'reply-2',
      content: 'new reply',
      created_at: '2026-11-04T10:02:00Z',
      mentions: [],
      attachments: [],
      parent: { type: 'channel', id: 'channel-1' },
      root_id: 'root-1',
      thread_id: 'root-1',
      sender: 'macro|cy@example.com',
    },
  ]);
});
