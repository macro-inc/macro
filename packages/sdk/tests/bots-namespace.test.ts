import { afterEach, describe, expect, test } from 'bun:test';
import type { Bot } from '../generated/storage/types.gen';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('BotsNamespace', () => {
  test('uses the configured bot scope for self lookup', async () => {
    const bot: Bot = {
      id: '0198a4cc-e138-7670-a308-a6b766602700',
      kind: 'owned',
      owner: { type: 'team', team_id: '0198a4cc-e138-7670-a308-a6b766602701' },
      name: 'Mention Bot',
      handle: 'mention-bot',
      description: null,
      avatar_url: null,
      created_by: 'macro|owner@example.com',
      created_at: '2026-07-31T12:00:00Z',
      updated_at: '2026-07-31T12:00:00Z',
      deleted_at: null,
      has_agent: false,
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
      auth: { type: 'bot', token: 'mbot_team_owned', scope: 'team' },
      hosts: { storage: 'https://storage.example.test' },
    });

    await expect(macro.bots.me()).resolves.toEqual(bot);
    expect(request?.url).toBe('https://storage.example.test/bots/me');
    expect(request?.headers.get('x-macro-bot-token')).toBe('mbot_team_owned');
    expect(request?.headers.get('x-macro-bot-scope')).toBe('team');
    expect(request?.headers.has('x-macro-bot-for-macro-user-id')).toBe(false);
  });
});
