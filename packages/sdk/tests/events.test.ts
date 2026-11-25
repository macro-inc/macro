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

  test('listen() skips the stream heartbeats a newer server sends', async () => {
    const delivered = Promise.withResolvers<string>();
    const errors: unknown[] = [];
    const onError = (error: unknown) => errors.push(error);
    process.on('unhandledRejection', onError);
    globalThis.fetch = (async (_input) =>
      new Response(`event: heartbeat\ndata: {}\n\n${sseBody(created)}`, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof fetch;

    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    macro.events.on('document.created', (event) => {
      delivered.resolve(event.event_type);
    });
    const stop = await macro.events.listen();
    const eventType = await delivered.promise;
    stop();
    process.off('unhandledRejection', onError);

    expect(eventType).toBe('document.created');
    expect(errors).toEqual([]);
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
      fetch: (request) => {
        if (new URL(request.url).pathname !== '/webhook/events/stream')
          return new Response(null, { status: 404 });
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(sseBody(created)));
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
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
      fetch: (request) => {
        if (new URL(request.url).pathname !== '/webhook/events/stream')
          return new Response(null, { status: 404 });
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
      const opens: Date[] = [];
      const stop = await macro.events.listen({
        onDrop: (at) => drops.push(at),
        onOpen: (at) => opens.push(at),
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
      // Told of the drop once, and of each open (the first and the reopen),
      // so a caller can resync what the gap may have missed once events reach
      // it again.
      expect(drops).toHaveLength(1);
      expect(opens).toHaveLength(2);
      const [, reopened] = opens;
      const [dropped] = drops;
      expect(reopened && dropped && reopened >= dropped).toBe(true);
    } finally {
      await server.stop(true);
    }
  }, 15_000);

  test('a resumed stream asks for the events after its last id, and says which it handled', async () => {
    const requests: { url: string; lastEventId: string | null }[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname !== '/webhook/events/stream')
          return new Response(null, { status: 404 });
        requests.push({
          url: request.url,
          lastEventId: request.headers.get('last-event-id'),
        });
        const event = {
          event_type: 'document.created' as const,
          metadata: {
            document_id: 'd1',
            document_name: 'd1',
            owner: 'macro|o@example.com',
          },
        };
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(`id: e1\n${sseBody(event)}`),
              );
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
      const handled: string[] = [];
      const seen = Promise.withResolvers<string>();
      macro.events.on('document.created', (event) => {
        handled.push(`handler ${event.metadata.document_id}`);
      });
      const stop = await macro.events.listen({
        resume: { lastEventId: 'e0' },
        onEventId: (id) => {
          handled.push(`id ${id}`);
          seen.resolve(id);
        },
      });

      expect(
        await Promise.race([
          seen.promise,
          Bun.sleep(5_000).then(() => 'no event id'),
        ]),
      ).toBe('e1');
      stop();

      const [first] = requests;
      expect(first && new URL(first.url).searchParams.get('resume')).toBe(
        'true',
      );
      expect(first?.lastEventId).toBe('e0');
      // The id is reported once its event was handled.
      expect(handled).toEqual(['handler d1', 'id e1']);
    } finally {
      await server.stop(true);
    }
  });

  const createdFor = (id: string) => ({
    event_type: 'document.created' as const,
    metadata: {
      document_id: id,
      document_name: id,
      owner: 'macro|o@example.com',
    },
  });
  const eventStream = (body: string, close: boolean) =>
    new Response(
      new ReadableStream({
        start(controller) {
          if (body) controller.enqueue(new TextEncoder().encode(body));
          if (close) controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );

  test('a drop is told once, however many reconnects fail before the stream is back', async () => {
    let connections = 0;
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname !== '/webhook/events/stream')
          return new Response(null, { status: 404 });
        connections += 1;
        if (connections === 1)
          return eventStream(sseBody(createdFor('before')), true);
        if (connections === 2) return new Response('down', { status: 503 });
        return eventStream(sseBody(createdFor('after')), false);
      },
    });
    try {
      const macro = new Macro({
        token: 'user-token',
        hosts: { storage: `http://localhost:${server.port}` },
      });
      const after = Promise.withResolvers<void>();
      macro.events.on('document.created', (event) => {
        if (event.metadata.document_id === 'after') after.resolve();
      });
      const drops: Date[] = [];
      const opens: Date[] = [];
      const stop = await macro.events.listen({
        onDrop: (at) => drops.push(at),
        onOpen: (at) => opens.push(at),
      });
      await Promise.race([
        after.promise,
        Bun.sleep(15_000).then(() => {
          throw new Error('the stream never came back');
        }),
      ]);
      stop();

      expect(connections).toBe(3);
      expect(drops).toHaveLength(1);
      expect(opens).toHaveLength(2);
    } finally {
      await server.stop(true);
    }
  }, 20_000);

  test('a stream that ends at once, with no event, backs off longer each time', async () => {
    const at: number[] = [];
    const opened = Promise.withResolvers<void>();
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname !== '/webhook/events/stream')
          return new Response(null, { status: 404 });
        return eventStream('', true);
      },
    });
    try {
      const macro = new Macro({
        token: 'user-token',
        hosts: { storage: `http://localhost:${server.port}` },
      });
      macro.events.on('document.created', () => undefined);
      // Count SDK reconnects, not transport retries below the fetch boundary.
      const stop = await macro.events.listen({
        onOpen: () => {
          at.push(Date.now());
          if (at.length === 3) opened.resolve();
        },
      });
      await opened.promise;
      stop();

      const [first = 0, second = 0, third = 0] = at;
      expect(third - second).toBeGreaterThan((second - first) * 1.5);
    } finally {
      await server.stop(true);
    }
  }, 20_000);

  test('a handler that throws is reported, and the stream goes on', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname !== '/webhook/events/stream')
          return new Response(null, { status: 404 });
        return eventStream(
          `${sseBody(createdFor('bad'))}${sseBody(createdFor('good'))}`,
          false,
        );
      },
    });
    try {
      const macro = new Macro({
        token: 'user-token',
        hosts: { storage: `http://localhost:${server.port}` },
      });
      const good = Promise.withResolvers<void>();
      macro.events.on('document.created', (event) => {
        if (event.metadata.document_id === 'bad')
          throw new Error('handler broke');
        good.resolve();
      });
      const errors: unknown[] = [];
      const stop = await macro.events.listen({
        onHandlerError: (error) => errors.push(error),
      });
      await Promise.race([
        good.promise,
        Bun.sleep(5_000).then(() => {
          throw new Error('the event after the failed one never arrived');
        }),
      ]);
      stop();

      expect(errors).toEqual([new Error('handler broke')]);
    } finally {
      await server.stop(true);
    }
  });

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
