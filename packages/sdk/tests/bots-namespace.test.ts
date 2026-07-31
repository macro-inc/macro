import { afterEach, describe, expect, test } from 'bun:test';
import type { Bot } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('BotsNamespace', () => {
  test('uses user scope for self lookup with default bot auth', async () => {
    const bot: Bot = {
      id: '0198a4cc-e138-7670-a308-a6b766602700',
      kind: 'owned',
      owner: { type: 'user', user_id: 'macro|owner@example.com' },
      name: 'Mention Bot',
      handle: 'mention-bot',
      description: null,
      avatar_url: null,
      created_by: 'macro|owner@example.com',
      created_at: '2026-07-31T12:00:00Z',
      updated_at: '2026-07-31T12:00:00Z',
      deleted_at: null,
    };
    let request: Request | undefined;
    globalThis.fetch = (async (input) => {
      request = input instanceof Request ? input : new Request(input);
      return new Response(JSON.stringify(bot), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const macro = new Macro({
      auth: { type: 'bot', token: 'mbot_user_owned' },
      hosts: { storage: 'https://storage.example.test' },
    });

    await expect(macro.bots.me()).resolves.toEqual(bot);
    expect(request?.url).toBe('https://storage.example.test/bots/me');
    expect(request?.headers.get('x-macro-bot-token')).toBe('mbot_user_owned');
    expect(request?.headers.get('x-macro-bot-scope')).toBe('user');
    expect(request?.headers.has('x-macro-bot-for-macro-user-id')).toBe(false);
  });
});
