import { afterEach, describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';
import { MacroApiError } from '../src/utils';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.MACRO_API_KEY;
const originalBotToken = process.env.MACRO_BOT_TOKEN;
const hosts = { auth: 'https://auth.example.test' };

afterEach(() => {
  globalThis.fetch = originalFetch;
  restoreEnv('MACRO_API_KEY', originalApiKey);
  restoreEnv('MACRO_BOT_TOKEN', originalBotToken);
});

function restoreEnv(
  name: 'MACRO_API_KEY' | 'MACRO_BOT_TOKEN',
  value: string | undefined,
) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function mockUserInfoFetch(): {
  request: Request | undefined;
  called: boolean;
} {
  const state: { request: Request | undefined; called: boolean } = {
    request: undefined,
    called: false,
  };
  globalThis.fetch = (async (input) => {
    state.called = true;
    state.request = input instanceof Request ? input : new Request(input);
    return new Response(JSON.stringify({ user_id: 'macro|user@example.com' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return state;
}

describe('auth headers', () => {
  test('MACRO_API_KEY=mak_abc sends the user API key header', async () => {
    process.env.MACRO_API_KEY = 'mak_abc';
    delete process.env.MACRO_BOT_TOKEN;
    const fetchState = mockUserInfoFetch();
    const macro = new Macro({ hosts });

    await macro.users.me();

    expect(fetchState.request?.headers.get('x-macro-user-api-key')).toBe(
      'mak_abc',
    );
    expect(fetchState.request?.headers.has('authorization')).toBe(false);
  });

  test('token: mak_abc sends the user API key header', async () => {
    const fetchState = mockUserInfoFetch();
    const macro = new Macro({ token: 'mak_abc', hosts });

    await macro.users.me();

    expect(fetchState.request?.headers.get('x-macro-user-api-key')).toBe(
      'mak_abc',
    );
    expect(fetchState.request?.headers.has('authorization')).toBe(false);
  });

  test('auth.apiKey sends the user API key header without a prefix check', async () => {
    const fetchState = mockUserInfoFetch();
    const macro = new Macro({
      auth: { type: 'user', apiKey: 'legacy0123' },
      hosts,
    });

    await macro.users.me();

    expect(fetchState.request?.headers.get('x-macro-user-api-key')).toBe(
      'legacy0123',
    );
    expect(fetchState.request?.headers.has('authorization')).toBe(false);
  });

  test('token JWT sends Authorization Bearer and no user API key header', async () => {
    const fetchState = mockUserInfoFetch();
    const macro = new Macro({ token: 'eyJhbGciOi.jwt', hosts });

    await macro.users.me();

    expect(fetchState.request?.headers.get('authorization')).toBe(
      'Bearer eyJhbGciOi.jwt',
    );
    expect(fetchState.request?.headers.has('x-macro-user-api-key')).toBe(false);
  });

  test('token: mbot_x rejects and does not call fetch', async () => {
    const fetchState = mockUserInfoFetch();
    const macro = new Macro({ token: 'mbot_x', hosts });

    const error = await macro.users.me().then(
      () => {
        throw new Error('expected users.me() to reject');
      },
      (caught) => caught,
    );

    expect(fetchState.called).toBe(false);
    expect(error).toBeInstanceOf(MacroApiError);
    expect((error as MacroApiError).data).toEqual(
      expect.objectContaining({
        message:
          "bot token passed as a user credential. Use auth: { type: 'bot', token } or MACRO_BOT_TOKEN.",
      }),
    );
  });

  test('bot auth with a mak_ token rejects', async () => {
    const fetchState = mockUserInfoFetch();
    const macro = new Macro({
      auth: { type: 'bot', token: 'mak_abc' },
      hosts,
    });

    const error = await macro.users.me().then(
      () => {
        throw new Error('expected users.me() to reject');
      },
      (caught) => caught,
    );

    expect(fetchState.called).toBe(false);
    expect(error).toBeInstanceOf(MacroApiError);
    expect((error as MacroApiError).data).toEqual(
      expect.objectContaining({
        message:
          "user API key passed as a bot token. Use auth: { type: 'user', apiKey } or MACRO_API_KEY.",
      }),
    );
  });

  test('requestedAs with a user apiKey throws at construction', () => {
    expect(
      () =>
        new Macro({
          auth: { type: 'user', apiKey: 'mak_abc' },
          requestedAs: 'macro|w@x.com',
          hosts,
        }),
    ).toThrow(
      'requestedAs() requires bot auth — a user token always acts as its own user',
    );
  });
});
