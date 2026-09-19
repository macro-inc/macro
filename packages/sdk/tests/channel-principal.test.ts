import { describe, expect, test } from 'bun:test';
import { userFromPrincipal } from '../src/events/hydrate/channel';
import type { MacroClient } from '../src/utils/client';

const client = {} as MacroClient;

describe('userFromPrincipal', () => {
  test('resolves user principals, normalizing case', () => {
    expect(userFromPrincipal(client, 'macro|User@Example.COM')?.id).toBe(
      'macro|user@example.com',
    );
  });

  test('only treats a leading bot| as a bot, since | is legal in an email', () => {
    expect(userFromPrincipal(client, 'macro|bot|user@example.com')?.id).toBe(
      'macro|bot|user@example.com',
    );
  });

  test('gives no user for bots or empty principals', () => {
    for (const id of [
      'bot|00000000-0000-0000-0000-000000000001',
      'macro|',
      '',
    ]) {
      expect(userFromPrincipal(client, id)).toBeUndefined();
    }
  });
});
