import '../polyfills/prism';
import { describe, expect, it } from 'bun:test';
import app from '../index';

const CHANNEL = '0195d2dd-5de9-71f2-9d59-5d9734f1adb7';
const MARKDOWN = `Source: https://macro.com/app/channel/${CHANNEL}?channel_message_id=01a1eaa3-102a-7bbc-8d8f-8a427f9efecb`;

const request = (body: unknown) =>
  app.request(
    '/mentions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-auth-key': 'test-key',
      },
      body: JSON.stringify(body),
    },
    { INTERNAL_AUTH_KEY: 'test-key' }
  );

async function mentions(body: unknown): Promise<unknown> {
  const response = await request(body);
  expect(response.status).toBe(200);
  const { mentions } = await response.json();
  return mentions;
}

describe('mentions endpoint', () => {
  it('ignores Macro links without an app origin, as channel messages send', async () => {
    expect(await mentions({ markdown: MARKDOWN })).toEqual([]);
  });

  it('counts Macro links on the app origin, as document creation sends', async () => {
    expect(
      await mentions({ markdown: MARKDOWN, appOrigin: 'https://macro.com' })
    ).toEqual([{ entityType: 'channel', entityId: CHANNEL }]);
  });

  it('ignores Macro links to another environment', async () => {
    expect(
      await mentions({ markdown: MARKDOWN, appOrigin: 'https://dev.macro.com' })
    ).toEqual([]);
  });
});
