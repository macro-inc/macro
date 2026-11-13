import { afterEach, describe, expect, test } from 'bun:test';
import { EventStreamResetError, Macro } from '../src/macro';
import { MacroError } from '../src/utils';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function created(eventId: string, documentId = 'doc_1') {
  return {
    event_id: eventId,
    schema_version: 1,
    event_type: 'document.created' as const,
    metadata: {
      document_id: documentId,
      document_name: 'Notes',
      owner: 'macro|owner@example.com',
    },
  };
}

/** One SSE frame. */
function frame(event: string, data: unknown, id?: string): string {
  return `${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A connection the fake server answers: frames, then close or hang. */
type Connection = { status: number } | { frames: string[]; hang?: boolean };

/**
 * A fake event stream server: answers each request with the next scripted
 * connection and records the requests.
 */
function fakeServer(connections: Connection[]) {
  const requests: Request[] = [];
  globalThis.fetch = (async (input: Request | string | URL) => {
    const request = input instanceof Request ? input : new Request(input);
    requests.push(request);
    const connection = connections.shift() ?? { frames: [], hang: true };
    if ('status' in connection) {
      return new Response(JSON.stringify({ message: 'refused' }), {
        status: connection.status,
      });
    }
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of connection.frames) {
          controller.enqueue(encoder.encode(chunk));
        }
        if (!connection.hang) {
          controller.close();
          return;
        }
        request.signal.addEventListener('abort', () => {
          try {
            controller.error(new DOMException('aborted', 'AbortError'));
          } catch {
            // already closed
          }
        });
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;
  return requests;
}

function macro() {
  return new Macro({
    token: 'user-token',
    hosts: { storage: 'https://storage.example.test' },
  });
}

async function take<T>(stream: AsyncIterable<T>, count: number): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) {
    items.push(item);
    if (items.length === count) break;
  }
  return items;
}

describe('macro.events.subscribe', () => {
  test('sends its filters and yields hydrated events with their cursor', async () => {
    const requests = fakeServer([
      { frames: [frame('document.created', created('e1'), '1-0')], hang: true },
    ]);
    const channel = { id: 'chan_1' };

    const stream = macro().events.subscribe({
      events: ['document.*', 'message.posted'],
      ids: [channel],
      entityTypes: ['document'],
      scope: 'team',
    });
    const [event] = await take(stream, 1);

    expect(event?.event_type).toBe('document.created');
    if (event?.event_type !== 'document.created') throw new Error('narrowing');
    expect(event.document.id).toBe('doc_1');
    expect(stream.cursor).toBe('1-0');
    expect(stream.closeReason).toBe('closed');

    const url = new URL(requests[0]?.url ?? '');
    expect(url.pathname).toBe('/events/stream');
    expect(url.searchParams.get('scope')).toBe('team');
    expect(url.searchParams.get('cursor')).toBeNull();
    expect(JSON.parse(url.searchParams.get('filters') ?? '')).toEqual([
      {
        events: ['document.*', 'message.posted'],
        ids: ['chan_1'],
        entity_types: ['document'],
      },
    ]);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer user-token');
  });

  test('resumes from a saved cursor', async () => {
    const requests = fakeServer([
      { frames: [frame('document.created', created('e2'), '2-0')], hang: true },
    ]);

    const stream = macro().events.subscribe({
      events: ['document.created'],
      cursor: '1-0',
    });
    await take(stream, 1);

    const url = new URL(requests[0]?.url ?? '');
    expect(url.searchParams.get('cursor')).toBe('1-0');
    expect(requests[0]?.headers.get('last-event-id')).toBe('1-0');
  });

  test('reconnects with its cursor after the server closes and drops duplicates', async () => {
    const requests = fakeServer([
      { frames: [frame('document.created', created('e1'), '1-0')] },
      {
        frames: [
          // Replayed after the cursor by an at-least-once server.
          frame('document.created', created('e1'), '1-0'),
          frame('document.created', created('e2', 'doc_2'), '2-0'),
        ],
        hang: true,
      },
    ]);

    const stream = macro().events.subscribe({ events: ['document.created'] });
    const events = await take(stream, 2);

    expect(events.map((event) => event.metadata.document_id)).toEqual([
      'doc_1',
      'doc_2',
    ]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.headers.get('last-event-id')).toBe('1-0');
    expect(new URL(requests[1]?.url ?? '').searchParams.get('cursor')).toBe(
      '1-0',
    );
    expect(stream.cursor).toBe('2-0');
  });

  test('reconnects at once from the lagged cursor', async () => {
    const requests = fakeServer([
      {
        frames: [
          frame('document.created', created('e1'), '1-0'),
          frame('lagged', { type: 'lagged', cursor: '1-5' }),
        ],
      },
      { frames: [frame('document.created', created('e2'), '2-0')], hang: true },
    ]);

    const stream = macro().events.subscribe({ events: ['document.created'] });
    const started = performance.now();
    await take(stream, 2);

    expect(performance.now() - started).toBeLessThan(400);
    expect(requests[1]?.headers.get('last-event-id')).toBe('1-5');
  });

  test('throws a typed error on reset', async () => {
    fakeServer([
      {
        frames: [
          frame('document.created', created('e1'), '1-0'),
          frame('reset', { type: 'reset' }),
        ],
      },
    ]);

    const stream = macro().events.subscribe({ events: ['document.created'] });
    const seen: string[] = [];
    const error = await (async () => {
      for await (const event of stream) seen.push(event.metadata.document_id);
    })().catch((caught: unknown) => caught);

    expect(seen).toEqual(['doc_1']);
    expect(error).toBeInstanceOf(EventStreamResetError);
    expect(stream.cursor).toBeUndefined();
  });

  test('throws a typed error when the cursor is gone on open (410)', async () => {
    fakeServer([{ status: 410 }]);

    const stream = macro().events.subscribe({
      events: ['document.created'],
      cursor: '0-1',
    });

    await expect(take(stream, 1)).rejects.toBeInstanceOf(EventStreamResetError);
  });

  test('ends without an error when the credential is revoked', async () => {
    fakeServer([
      { frames: [frame('revoked', { type: 'revoked', reason: 'credential' })] },
    ]);

    const stream = macro().events.subscribe({ events: ['document.created'] });
    const events = await take(stream, 1);

    expect(events).toEqual([]);
    expect(stream.closeReason).toBe('revoked');
  });

  test('fails on a refused request instead of retrying', async () => {
    const requests = fakeServer([{ status: 403 }]);

    const stream = macro().events.subscribe({ events: ['document.created'] });

    await expect(take(stream, 1)).rejects.toBeInstanceOf(MacroError);
    expect(requests).toHaveLength(1);
  });

  test('falls back to the original path on servers without /events/stream', async () => {
    const requests = fakeServer([
      { status: 404 },
      { frames: [frame('document.created', created('e1'), 'e1')], hang: true },
    ]);

    await take(macro().events.subscribe({ events: ['document.created'] }), 1);

    expect(new URL(requests[1]?.url ?? '').pathname).toBe(
      '/webhook/events/stream',
    );
  });

  test('stops when its signal aborts', async () => {
    fakeServer([
      { frames: [frame('document.created', created('e1'), '1-0')], hang: true },
    ]);
    const controller = new AbortController();

    const stream = macro().events.subscribe({
      events: ['document.created'],
      signal: controller.signal,
    });
    const seen: string[] = [];
    for await (const event of stream) {
      seen.push(event.metadata.document_id);
      controller.abort();
    }

    expect(seen).toEqual(['doc_1']);
    expect(stream.closeReason).toBe('closed');
  });

  test('hydrates new families and delivers families without a hydrator raw', async () => {
    const project = {
      event_id: 'p1',
      schema_version: 1,
      event_type: 'project.created',
      metadata: {
        project_id: 'proj_1',
        parent_project_id: null,
        created_at: null,
      },
    };
    const team = {
      event_id: 't1',
      schema_version: 1,
      event_type: 'team.created',
      metadata: {
        team_id: 'team_1',
        name: 'Core',
        slug: 'core',
        owner: 'macro|owner@example.com',
      },
    };
    fakeServer([
      {
        frames: [
          frame('project.created', project, '1-0'),
          frame('team.created', team, '2-0'),
        ],
        hang: true,
      },
    ]);

    const stream = macro().events.subscribe({
      events: ['project.*', 'team.created'],
    });
    const [first, second] = await take(stream, 2);

    if (first?.event_type !== 'project.created') throw new Error('narrowing');
    expect(first.project.id).toBe('proj_1');
    expect(first.parent).toBeUndefined();
    expect(second).toEqual({
      ...team,
      event_type: 'team.created',
    } as typeof second);
  });

  test('delivers an unknown member of a known family raw', async () => {
    const pinned = {
      event_id: 'c1',
      schema_version: 1,
      event_type: 'chat.pinned',
      metadata: { chat_id: 'chat_1' },
    };
    fakeServer([{ frames: [frame('chat.pinned', pinned, '1-0')], hang: true }]);

    const [event] = await take(
      macro().events.subscribe({ events: ['chat.*'] }),
      1,
    );

    expect(event as unknown).toEqual(pinned);
  });

  test('stops reading ahead of a slow consumer', async () => {
    let pulled = 0;
    const encoder = new TextEncoder();
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulled += 1;
            controller.enqueue(
              encoder.encode(
                frame('document.created', created(`e${pulled}`), `${pulled}-0`),
              ),
            );
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as unknown as typeof fetch;

    const stream = macro().events.subscribe({ events: ['document.created'] });
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(pulled).toBeLessThan(400);
    await iterator.return?.();
  });

  test('can be iterated only once', async () => {
    fakeServer([]);
    const stream = macro().events.subscribe({ events: ['document.created'] });
    stream[Symbol.asyncIterator]();

    expect(() => stream[Symbol.asyncIterator]()).toThrow(MacroError);
    stream.close();
  });

  test('refuses an empty event list', () => {
    expect(() => macro().events.subscribe({ events: [] })).toThrow(MacroError);
  });
});
