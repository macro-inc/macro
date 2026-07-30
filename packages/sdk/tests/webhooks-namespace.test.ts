import { describe, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

describe('WebhooksNamespace.subscribeToSelfMentions', () => {
  test('rejects bare bot auth before making a request', async () => {
    const macro = new Macro({
      auth: { type: 'bot', token: 'mbot_test' },
      env: 'local',
    });

    await expect(
      macro.webhooks.subscribeToSelfMentions({
        url: 'https://example.com/webhooks',
      }),
    ).rejects.toThrow(
      'subscribeToSelfMentions requires an acting user — call requestedAs(userId) on the bot-authenticated client first',
    );
  });
});
