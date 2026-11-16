import { describe, expect, test } from 'bun:test';
import {
  constantTimeEqual,
  relayHandler,
  type SocketTarget,
  socketTarget,
  startRelay,
} from '../relay.ts';

const capability = 'capability-token';
const apiKey = 'mak_real_key';

/** A Macro that records what reached it. */
const upstream = () => {
  const seen: Request[] = [];
  return {
    seen,
    fetch: async (request: Request): Promise<Response> => {
      seen.push(request);
      return Response.json({ ok: true, url: request.url }, { status: 201 });
    },
  };
};

const handler = (fetch: (request: Request) => Promise<Response>) =>
  relayHandler({
    targets: {
      storage: 'https://macro.example/dss',
      auth: 'https://auth.example',
    },
    capability,
    apiKey,
    fetch,
    equal: constantTimeEqual,
  });

describe('relayHandler: Anthropic', () => {
  const anthropicHandler = (fetch: (request: Request) => Promise<Response>) =>
    relayHandler({
      targets: { storage: 'https://macro.example/dss' },
      capability,
      apiKey,
      fetch,
      equal: constantTimeEqual,
      anthropic: {
        url: 'https://egress.example/brain/anthropic',
        token: apiKey,
      },
    });

  test('Claude presents the capability as its bearer token, and the gateway gets the real one', async () => {
    const macro = upstream();
    const response = await anthropicHandler(macro.fetch)(
      new Request('http://127.0.0.1:1/anthropic/v1/messages?beta=true', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${capability}`,
          'x-api-key': 'ignored',
          'anthropic-version': '2023-06-01',
        },
        body: '{}',
      })
    );
    expect(response.status).toBe(201);
    const [sent] = macro.seen;
    expect(sent?.url).toBe(
      'https://egress.example/brain/anthropic/v1/messages?beta=true'
    );
    expect(sent?.headers.get('authorization')).toBe(`Bearer ${apiKey}`);
    expect(sent?.headers.get('x-api-key')).toBeNull();
    expect(sent?.headers.get('anthropic-version')).toBe('2023-06-01');
  });

  test('a wrong bearer, or no Anthropic gateway, is refused', async () => {
    const macro = upstream();
    const wrong = await anthropicHandler(macro.fetch)(
      new Request('http://127.0.0.1:1/anthropic/v1/messages', {
        method: 'POST',
        headers: { authorization: 'Bearer nope' },
      })
    );
    expect(wrong.status).toBe(401);
    const none = await handler(macro.fetch)(
      new Request('http://127.0.0.1:1/anthropic/v1/messages', {
        method: 'POST',
        headers: { authorization: `Bearer ${capability}` },
      })
    );
    expect(none.status).toBe(404);
    expect(macro.seen).toEqual([]);
  });
});

describe('relayHandler', () => {
  test('forwards a call to the real host with the real key, and nothing of the caller’s auth', async () => {
    const macro = upstream();
    const response = await handler(macro.fetch)(
      new Request('http://127.0.0.1:9/storage/documents/1?x=2', {
        method: 'POST',
        headers: {
          'x-macro-user-api-key': capability,
          authorization: 'Bearer forged',
          cookie: 'session=forged',
          'x-macro-bot-token': 'mbot_forged',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'a' }),
      })
    );
    expect(response.status).toBe(201);
    const [forwarded] = macro.seen;
    expect(forwarded?.url).toBe('https://macro.example/dss/documents/1?x=2');
    expect(forwarded?.method).toBe('POST');
    expect(forwarded?.headers.get('x-macro-user-api-key')).toBe(apiKey);
    expect(forwarded?.headers.get('authorization')).toBeNull();
    expect(forwarded?.headers.get('cookie')).toBeNull();
    expect(forwarded?.headers.get('x-macro-bot-token')).toBeNull();
    expect(forwarded?.headers.get('content-type')).toBe('application/json');
    expect(await forwarded?.text()).toBe('{"title":"a"}');
  });

  test('refuses a wrong or missing capability, and forwards nothing', async () => {
    const macro = upstream();
    for (const headers of [
      new Headers({ 'x-macro-user-api-key': 'guess' }),
      new Headers(),
    ]) {
      const response = await handler(macro.fetch)(
        new Request('http://127.0.0.1:9/auth/user/me', { headers })
      );
      expect(response.status).toBe(401);
    }
    expect(macro.seen).toEqual([]);
  });

  test('refuses a websocket upgrade', async () => {
    const macro = upstream();
    const response = await handler(macro.fetch)(
      new Request('http://127.0.0.1:9/storage/socket', {
        headers: {
          'x-macro-user-api-key': capability,
          connection: 'Upgrade',
          upgrade: 'websocket',
        },
      })
    );
    expect(response.status).toBe(403);
    expect(macro.seen).toEqual([]);
  });

  test('refuses a service it has no address for, or a path out of its service', async () => {
    const macro = upstream();
    for (const path of [
      '/email/threads',
      '/',
      '/storage/%2e%2e/admin',
      '/storage/..%2fadmin',
    ]) {
      const response = await handler(macro.fetch)(
        new Request(`http://127.0.0.1:9${path}`, {
          headers: { 'x-macro-user-api-key': capability },
        })
      );
      expect(response.status).toBe(404);
    }
    expect(macro.seen).toEqual([]);
  });

  test('answers 502, saying only which service, when Macro is unreachable', async () => {
    const response = await handler(async () => {
      throw new Error(`connect failed with ${apiKey}`);
    })(
      new Request('http://127.0.0.1:9/auth/user/me', {
        headers: { 'x-macro-user-api-key': capability },
      })
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(apiKey);
  });
});

describe('startRelay', () => {
  test('listens on loopback with a fresh capability each time', async () => {
    const macro = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) =>
        Response.json({ key: request.headers.get('x-macro-user-api-key') }),
    });
    const first = startRelay({
      targets: { auth: macro.url.href },
      speech: 'https://egress.example/brain/inference',
      apiKey,
    });
    const second = startRelay({
      targets: {},
      speech: 'https://egress.example/brain/inference',
      apiKey,
    });
    try {
      expect(new URL(first.url).hostname).toBe('127.0.0.1');
      expect(first.token).not.toBe(second.token);
      expect(first.token.length).toBeGreaterThanOrEqual(32);
      const response = await fetch(`${first.url}/auth/user/me`, {
        headers: { 'x-macro-user-api-key': first.token },
      });
      expect(await response.json()).toEqual({ key: apiKey });
    } finally {
      first.stop();
      second.stop();
      macro.stop(true);
    }
  });

  test('passes a compressed answer through as it came, so the caller can decode it', async () => {
    const body = JSON.stringify({
      token: 'livekit-token',
      url: 'wss://rtc.example',
    });
    const macro = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () =>
        new Response(Bun.gzipSync(body), {
          headers: {
            'content-type': 'application/json',
            'content-encoding': 'gzip',
          },
        }),
    });
    const relay = startRelay({
      targets: { storage: macro.url.href },
      speech: 'https://egress.example/brain/inference',
      apiKey,
    });
    try {
      const response = await fetch(`${relay.url}/storage/call/record/c/join`, {
        method: 'POST',
        headers: { 'x-macro-user-api-key': relay.token },
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(JSON.parse(body));
    } finally {
      relay.stop();
      macro.stop(true);
    }
  });
});

const upgrade = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1:9${path}`, {
    headers: { connection: 'Upgrade', upgrade: 'websocket', ...headers },
  });

const target = socketTarget({
  speech: 'https://gateway.example/agent-harness-egress/brain/inference/',
  capability,
  apiKey,
  equal: constantTimeEqual,
});

const relayed = (result: SocketTarget | Response): SocketTarget => {
  if (result instanceof Response) throw new Error(`refused ${result.status}`);
  return result;
};

describe('socketTarget', () => {
  test('opens speech sockets with the agent key as a bearer token, its own model and the trace context only', () => {
    for (const [path, model] of [
      ['stt', 'deepgram%2Fnova-3'],
      ['tts', 'deepgram%2Faura-2'],
    ] as const) {
      const found = relayed(
        target(
          upgrade(`/speech/${path}?model=evil&x=1`, {
            'x-macro-user-api-key': capability,
            authorization: 'Bearer forged',
            cookie: 'session=forged',
            'x-macro-bot-token': 'mbot_forged',
            traceparent:
              '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
          })
        )
      );
      expect(found.url).toBe(
        `wss://gateway.example/agent-harness-egress/brain/inference/${path}?model=${model}`
      );
      expect(found.headers).toEqual({
        authorization: `Bearer ${apiKey}`,
        traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      });
    }
  });

  test('refuses a wrong or missing capability before anything else', () => {
    const given: Record<string, string>[] = [
      { 'x-macro-user-api-key': 'guess' },
      {},
    ];
    for (const headers of given) {
      const refused = target(upgrade('/storage/socket', headers));
      expect(refused instanceof Response && refused.status).toBe(401);
    }
  });

  test('refuses every other path and service, and any method but GET', () => {
    const headers = { 'x-macro-user-api-key': capability };
    for (const path of [
      '/speech',
      '/speech/stt/',
      '/speech/%73tt',
      '/agent-harness/brain/inference/stt',
      '/agent-harness/agent-session/socket',
      '/storage/speech/stt',
      '/connection/socket',
      '/',
    ]) {
      const refused = target(upgrade(path, headers));
      expect(refused instanceof Response && refused.status).toBe(403);
    }
    const posted = target(
      new Request('http://127.0.0.1:9/speech/stt', {
        method: 'POST',
        headers: { ...headers, connection: 'Upgrade', upgrade: 'websocket' },
      })
    );
    expect(posted instanceof Response && posted.status).toBe(405);
  });
});

describe('startRelay sockets', () => {
  test('carries a speech socket both ways with the key added upstream, never sent to the child', async () => {
    const seen: { authorization: string | null; url: string }[] = [];
    const harness = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request, server) => {
        seen.push({
          authorization: request.headers.get('authorization'),
          url: request.url,
        });
        return server.upgrade(request, { data: undefined })
          ? undefined
          : new Response('no', { status: 400 });
      },
      websocket: {
        message: (socket, message) => {
          socket.send(`echo:${String(message)}`);
        },
      },
    });
    const relay = startRelay({
      targets: {},
      speech: `${harness.url.href}brain/inference`,
      apiKey,
    });
    try {
      const socket = new WebSocket(
        `${relay.url.replace('http', 'ws')}/speech/stt`,
        { headers: { 'x-macro-user-api-key': relay.token } }
      );
      const answers: string[] = [];
      socket.addEventListener('message', ({ data }) =>
        answers.push(String(data))
      );
      // Sent before upstream is open: held, then delivered in order.
      socket.addEventListener('open', () => {
        socket.send('one');
        socket.send('two');
      });
      const closed = new Promise<number>((resolve) =>
        socket.addEventListener('close', ({ code }) => resolve(code))
      );
      const deadline = Date.now() + 5000;
      while (answers.length < 2 && Date.now() < deadline) await Bun.sleep(10);
      expect(answers).toEqual(['echo:one', 'echo:two']);
      expect(answers.join()).not.toContain(apiKey);
      expect(seen).toEqual([
        {
          authorization: `Bearer ${apiKey}`,
          url: `${harness.url.href}brain/inference/stt?model=deepgram%2Fnova-3`,
        },
      ]);
      // Upstream going away closes the child's side.
      harness.stop(true);
      expect(await closed).toBeGreaterThan(0);
    } finally {
      relay.stop();
      harness.stop(true);
    }
  });

  test('a speech socket upstream refuses closes the child as a failure, not a normal close', async () => {
    const harness = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('forbidden', { status: 403 }),
    });
    const relay = startRelay({
      targets: {},
      speech: `${harness.url.href}brain/inference`,
      apiKey,
    });
    try {
      const socket = new WebSocket(
        `${relay.url.replace('http', 'ws')}/speech/tts`,
        { headers: { 'x-macro-user-api-key': relay.token } }
      );
      const closed = await new Promise<{ code: number; reason: string }>(
        (resolve) =>
          socket.addEventListener('close', ({ code, reason }) =>
            resolve({ code, reason })
          )
      );
      expect(closed).toEqual({ code: 1011, reason: 'speech upstream failed' });
    } finally {
      relay.stop();
      harness.stop(true);
    }
  });

  test("passes upstream's own close code and reason on to the child", async () => {
    const harness = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request, server) =>
        server.upgrade(request, { data: undefined })
          ? undefined
          : new Response('no', { status: 400 }),
      websocket: {
        open: (socket) => socket.close(4008, 'session too long'),
        message: () => {},
      },
    });
    const relay = startRelay({
      targets: {},
      speech: `${harness.url.href}brain/inference`,
      apiKey,
    });
    try {
      const socket = new WebSocket(
        `${relay.url.replace('http', 'ws')}/speech/stt`,
        { headers: { 'x-macro-user-api-key': relay.token } }
      );
      const closed = await new Promise<{ code: number; reason: string }>(
        (resolve) =>
          socket.addEventListener('close', ({ code, reason }) =>
            resolve({ code, reason })
          )
      );
      expect(closed).toEqual({ code: 4008, reason: 'session too long' });
    } finally {
      relay.stop();
      harness.stop(true);
    }
  });

  test('refuses a socket to any other path, with nothing opened upstream', async () => {
    const seen: string[] = [];
    const harness = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => {
        seen.push(request.url);
        return new Response('no', { status: 400 });
      },
    });
    const relay = startRelay({
      targets: {},
      speech: `${harness.url.href}brain/inference`,
      apiKey,
    });
    try {
      const response = await fetch(`${relay.url}/agent-harness/socket`, {
        headers: {
          'x-macro-user-api-key': relay.token,
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'sec-websocket-version': '13',
        },
      });
      expect(response.status).toBe(403);
      expect(seen).toEqual([]);
    } finally {
      relay.stop();
      harness.stop(true);
    }
  });
});
