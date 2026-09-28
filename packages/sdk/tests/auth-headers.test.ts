import { describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';
import { requestAuthHeaders } from '../src/utils/client';

describe('requestAuthHeaders', () => {
  test('token: mak_abc sends the user API key header', async () => {
    expect(
      await requestAuthHeaders({ type: 'user', token: 'mak_abc' }),
    ).toEqual([['x-macro-user-api-key', 'mak_abc']]);
  });

  test('auth.apiKey sends a legacy unprefixed key', async () => {
    expect(
      await requestAuthHeaders({ type: 'user', apiKey: 'legacy0123' }),
    ).toEqual([['x-macro-user-api-key', 'legacy0123']]);
  });

  test('auth.apiKey rejects an mbot_ token', async () => {
    await expect(
      requestAuthHeaders({ type: 'user', apiKey: 'mbot_x' }),
    ).rejects.toThrow(
      "bot token passed as a user credential. Use auth: { type: 'bot', token } or MACRO_BOT_TOKEN.",
    );
  });

  test('token JWT sends Authorization Bearer', async () => {
    expect(
      await requestAuthHeaders({ type: 'user', token: 'eyJhbGciOi.jwt' }),
    ).toEqual([['Authorization', 'Bearer eyJhbGciOi.jwt']]);
  });

  test('token: mbot_x rejects', async () => {
    await expect(
      requestAuthHeaders({ type: 'user', token: 'mbot_x' }),
    ).rejects.toThrow(
      "bot token passed as a user credential. Use auth: { type: 'bot', token } or MACRO_BOT_TOKEN.",
    );
  });

  test('bot auth with a mak_ token rejects', async () => {
    await expect(
      requestAuthHeaders({ type: 'bot', token: 'mak_abc' }),
    ).rejects.toThrow(
      "user API key passed as a bot token. Use auth: { type: 'user', apiKey } or MACRO_API_KEY.",
    );
  });

  test('bot auth with a legacy API key rejects', async () => {
    await expect(
      requestAuthHeaders({ type: 'bot', token: 'legacy0123' }),
    ).rejects.toThrow(
      "user API key passed as a bot token. Use auth: { type: 'user', apiKey } or MACRO_API_KEY.",
    );
  });
});

describe('requestedAs', () => {
  test('throws at construction for a user apiKey', () => {
    expect(
      () =>
        new Macro({
          auth: { type: 'user', apiKey: 'mak_abc' },
          requestedAs: 'macro|w@x.com',
        }),
    ).toThrow(
      'requestedAs() requires bot auth — a user token always acts as its own user',
    );
  });
});
