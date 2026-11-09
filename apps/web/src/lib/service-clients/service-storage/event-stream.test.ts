import { describe, expect, it } from 'vitest';
import { parseServerSentEvents, type StreamedEvent } from './event-stream';

/** A byte stream that delivers `chunks` one read at a time. */
function bytes(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<StreamedEvent[]> {
  const events: StreamedEvent[] = [];
  for await (const event of parseServerSentEvents(bytes(chunks)))
    events.push(event);
  return events;
}

describe('parseServerSentEvents', () => {
  it('reads named JSON events and skips keep-alive comments', async () => {
    expect(
      await collect([
        'id: 1\nevent: document.updated\ndata: {"event_type":"document.updated"}\n\n',
        ':keep-alive\n\n',
        'event: document.deleted\ndata: {"a":1}\n\n',
      ])
    ).toEqual([
      { name: 'document.updated', data: { event_type: 'document.updated' } },
      { name: 'document.deleted', data: { a: 1 } },
    ]);
  });

  it('joins events split across reads, including CRLF separators', async () => {
    expect(
      await collect([
        'event: document.cre',
        'ated\r\ndata: {"metadata":',
        '{"document_id":"d1"}}\r\n',
        '\r\nevent: x.y\ndata: 2\n\n',
      ])
    ).toEqual([
      { name: 'document.created', data: { metadata: { document_id: 'd1' } } },
      { name: 'x.y', data: 2 },
    ]);
  });

  it('joins multi-line data and drops events without JSON data', async () => {
    expect(
      await collect([
        'event: a.b\ndata: {"list":\ndata: [1, 2]}\n\n',
        'event: a.c\n\n',
        'event: a.d\ndata: not json\n\n',
      ])
    ).toEqual([{ name: 'a.b', data: { list: [1, 2] } }]);
  });

  it('flushes a final event that ends with the stream', async () => {
    expect(
      await collect(['event: a.b\ndata: 1\n\n', 'event: a.c\ndata: 2'])
    ).toEqual([{ name: 'a.b', data: 1 }]);
  });
});
