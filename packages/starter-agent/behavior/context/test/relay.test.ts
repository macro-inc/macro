import { describe, expect, test } from 'bun:test';
import { constantTimeEqual, relayHandler, startRelay } from '../relay.ts';

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
    const first = startRelay({ targets: { auth: macro.url.href }, apiKey });
    const second = startRelay({ targets: {}, apiKey });
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
});
