import { afterEach, describe, expect, test } from 'bun:test';
import { EventStreamRevokedError, Macro } from '../src/macro';
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
      'https://storage.example.test/events/stream',
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

  test('listen() reconnects against a server without cursors and continues live after a reset', async () => {
    const requests: Request[] = [];
    const bodies = [
      // A server without the beta: SSE ids are event ids, then it closes.
      `id: e1\nevent: document.created\ndata: ${JSON.stringify({ ...created, event_id: 'e1' })}\n\n`,
      'event: reset\ndata: {"type":"reset"}\n\n',
      `id: e2\nevent: document.created\ndata: ${JSON.stringify({ ...created, event_id: 'e2' })}\n\n`,
    ];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return new Response(bodies.shift() ?? '', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    const seen: string[] = [];
    const twice = Promise.withResolvers<void>();
    macro.events.on('document.created', (event) => {
      seen.push(event.document.id);
      if (seen.length === 2) twice.resolve();
    });
    const stop = await macro.events.listen();
    await twice.promise;
    stop();

    expect(seen).toEqual(['doc_1', 'doc_1']);
    expect(requests[1]?.headers.get('last-event-id')).toBe('e1');
    // After the reset it reconnects live, without a cursor.
    expect(requests[2]?.headers.get('last-event-id')).toBeNull();
  });

  test('listen() reconnects with a refreshed token after the credential is revoked', async () => {
    const requests: Request[] = [];
    const bodies = [
      `id: 1-0\nevent: document.created\ndata: ${JSON.stringify({ ...created, event_id: 'e1' })}\n\n` +
        'event: revoked\ndata: {"type":"revoked","reason":"credential"}\n\n',
      `id: 2-0\nevent: document.created\ndata: ${JSON.stringify({ ...created, event_id: 'e2' })}\n\n`,
    ];
    globalThis.fetch = (async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return new Response(bodies.shift() ?? '', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }) as typeof fetch;

    let issued = 0;
    const macro = new Macro({
      auth: { type: 'user', token: () => `token-${++issued}` },
      hosts: { storage: 'https://storage.example.test' },
    });
    const errors: unknown[] = [];
    const twice = Promise.withResolvers<void>();
    let seen = 0;
    macro.events.on('document.created', () => {
      seen += 1;
      if (seen === 2) twice.resolve();
    });
    const stop = await macro.events.listen({
      onError: (error) => errors.push(error),
    });
    await twice.promise;
    stop();

    expect(errors).toEqual([]);
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer token-1');
    expect(requests[1]?.headers.get('authorization')).toBe('Bearer token-2');
    expect(requests[1]?.headers.get('last-event-id')).toBe('1-0');
  });

  test('listen() does not reconnect a deleted bot, even with a token function', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input) => {
      requests.push(input instanceof Request ? input : new Request(input));
      return new Response(
        'event: revoked\ndata: {"type":"revoked","reason":"bot_deleted"}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;

    const macro = new Macro({
      auth: { type: 'user', token: () => 'fresh-token' },
      hosts: { storage: 'https://storage.example.test' },
    });
    macro.events.on('document.created', () => {});
    const reported = Promise.withResolvers<unknown>();
    await macro.events.listen({ onError: reported.resolve });

    const error = await reported.promise;
    expect(error).toBeInstanceOf(EventStreamRevokedError);
    expect((error as EventStreamRevokedError).reason).toBe('bot_deleted');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).toHaveLength(1);
  });

  test('listen() gives up after 3 revoked closes in a row with no event', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input) => {
      requests.push(input instanceof Request ? input : new Request(input));
      return new Response(
        'event: revoked\ndata: {"type":"revoked","reason":"credential"}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;

    const macro = new Macro({
      auth: { type: 'user', token: () => 'soon-expiring-token' },
      hosts: { storage: 'https://storage.example.test' },
    });
    macro.events.on('document.created', () => {});
    const reported = Promise.withResolvers<unknown>();
    await macro.events.listen({ onError: reported.resolve });

    const error = await reported.promise;
    expect(error).toBeInstanceOf(EventStreamRevokedError);
    expect((error as EventStreamRevokedError).reason).toBe('credential');
    expect(requests).toHaveLength(3);
  }, 10_000);

  test('listen() stops and reports a revoked fixed credential', async () => {
    const requests: Request[] = [];
    globalThis.fetch = (async (input) => {
      requests.push(input instanceof Request ? input : new Request(input));
      return new Response(
        'event: revoked\ndata: {"type":"revoked","reason":"credential"}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof fetch;

    const macro = new Macro({
      token: 'user-token',
      hosts: { storage: 'https://storage.example.test' },
    });
    macro.events.on('document.created', () => {});
    const reported = Promise.withResolvers<unknown>();
    await macro.events.listen({ onError: reported.resolve });

    expect(await reported.promise).toBeInstanceOf(EventStreamRevokedError);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requests).toHaveLength(1);
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
