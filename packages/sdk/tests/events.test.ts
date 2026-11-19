import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';
import { MacroError } from '../src/utils';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const created = {
  event_type: 'document.created' as const,
  metadata: {
    document_id: 'doc_1',
    document_name: 'Notes',
    owner: 'macro|owner@example.com',
  },
};

function sseBody(event: unknown): string {
  return `event: ${typeof event === 'object' && event && 'event_type' in event ? event.event_type : 'message'}\ndata: ${JSON.stringify(event)}\n\n`;
}

async function sign(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${timestamp}.${rawBody}`),
  );
  return `v1=${new Uint8Array(digest).toHex()}`;
}

describe('MacroEvents', () => {
  test('is always available and defaults listen() filters from .on()', async () => {
    let request: Request | undefined;
    const delivered = Promise.withResolvers<typeof created>();
    globalThis.fetch = (async (input) => {
      request = input instanceof Request ? input : new Request(input);
      return new Response(sseBody(created), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    expect(macro.events).toBeDefined();

    macro.events.on('document.created', (event) => {
      delivered.resolve({
        event_type: event.event_type,
        metadata: event.metadata,
      });
    });
    const stop = await macro.events.listen();
    const event = await delivered.promise;
    stop();

    expect(event).toEqual(created);
    expect(request?.method).toBe('GET');
    expect(request?.headers.get('authorization')).toBe('Bearer user-token');
    const url = new URL(request?.url ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://storage.example.test/webhook/events/stream',
    );
    expect(url.searchParams.get('scope')).toBe('user');
    expect(JSON.parse(url.searchParams.get('filters') ?? '[]')).toEqual([
      { events: ['document.created'] },
    ]);
  });

  test('listen() sends explicit filters and scope', async () => {
    const seen = Promise.withResolvers<Request>();
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      seen.resolve(request);
      return new Response('', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    const stop = await macro.events.listen({
      filters: [{ events: ['message.posted'], ids: ['chan_1'] }],
      scope: 'team',
    });
    const request = await seen.promise;
    stop();

    const url = new URL(request.url);
    expect(url.searchParams.get('scope')).toBe('team');
    expect(JSON.parse(url.searchParams.get('filters') ?? '[]')).toEqual([
      { events: ['message.posted'], ids: ['chan_1'] },
    ]);
  });

  test('stopping a live stream is quiet: no unhandled rejection from the abort', async () => {
    // A stream that stays open, as Macro's does between events.
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sseBody(created)));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    });
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    try {
      const macro = new Macro({
        token: 'user-token',
        hosts: { storage: `http://localhost:${server.port}` },
      });
      const delivered = Promise.withResolvers<void>();
      macro.events.on('document.created', () => delivered.resolve());
      const stop = await macro.events.listen();
      await delivered.promise;
      // Idle, as a stream is between events when its listener stops it.
      await Bun.sleep(20);

      stop();
      await Bun.sleep(100);

      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
      await server.stop(true);
    }
  });

  test('a stream the server closes (a restart) is reopened, and events after it still arrive', async () => {
    const posted = (id: string) => ({
      event_type: 'document.created' as const,
      metadata: {
        document_id: id,
        document_name: id,
        owner: 'macro|o@example.com',
      },
    });
    let connections = 0;
    // The first connection delivers one event and ends, as a server that is
    // shutting down does; the next one delivers the event sent after it.
    const server = Bun.serve({
      port: 0,
      fetch: () => {
        connections += 1;
        const first = connections === 1;
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  sseBody(posted(first ? 'before' : 'after')),
                ),
              );
              if (first) controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    try {
      const macro = new Macro({
        token: 'user-token',
        hosts: { storage: `http://localhost:${server.port}` },
      });
      const seen: string[] = [];
      const after = Promise.withResolvers<void>();
      macro.events.on('document.created', (event) => {
        seen.push(event.metadata.document_id);
        if (event.metadata.document_id === 'after') after.resolve();
      });
      const drops: Date[] = [];
      const reconnects: Date[] = [];
      const stop = await macro.events.listen({
        onDrop: (at) => drops.push(at),
        onReconnect: (at) => reconnects.push(at),
      });

      await Promise.race([
        after.promise,
        Bun.sleep(8_000).then(() => {
          throw new Error(
            `no event after the server closed the stream; saw ${seen.join(', ')}`,
          );
        }),
      ]);
      stop();

      expect(seen).toEqual(['before', 'after']);
      expect(connections).toBe(2);
      // Told once each, so a caller can resync what the gap may have missed
      // once events reach it again.
      expect(drops).toHaveLength(1);
      expect(reconnects).toHaveLength(1);
      expect(reconnects[0]!.getTime()).toBeGreaterThanOrEqual(
        drops[0]!.getTime(),
      );
    } finally {
      await server.stop(true);
    }
  }, 15_000);

  test('listen() throws when there are no filters or handlers', async () => {
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    await expect(macro.events.listen()).rejects.toThrow(MacroError);
  });

  test('webhook() requires a signing secret', () => {
    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    expect(() => macro.events.webhook()).toThrow(MacroError);
  });

  test('webhook() verifies the signature and dispatches', async () => {
    const rawBody = JSON.stringify(created);
    const timestamp = '1710000000';
    const secret = 'whsec_test';
    const signature = await sign(secret, timestamp, rawBody);
    const received = Promise.withResolvers<string>();

    const macro = new Macro({
      token: 'user-token',
      webhookSecret: secret,
      hosts: { storage: 'https://storage.example.test' },
    });
    macro.events.on('document.created', (event) => {
      received.resolve(event.document.id);
    });

    const response = await macro.events.webhook()(
      new Request('https://example.test/webhook', {
        method: 'POST',
        body: rawBody,
        headers: {
          'x-macro-event': 'document.created',
          'x-macro-timestamp': timestamp,
          'x-macro-signature': signature,
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(received.promise).resolves.toBe('doc_1');
  });

  test('webhook() rejects a bad signature', async () => {
    const macro = new Macro({
      token: 'user-token',
      webhookSecret: 'whsec_test',
      hosts: { storage: 'https://storage.example.test' },
    });

    await expect(
      macro.events.webhook()(
        new Request('https://example.test/webhook', {
          method: 'POST',
          body: JSON.stringify(created),
          headers: {
            'x-macro-timestamp': '1710000000',
            'x-macro-signature': 'v1=deadbeef',
          },
        }),
      ),
    ).rejects.toThrow('invalid webhook signature');
  });
});
