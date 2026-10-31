import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Macro } from '../src/macro';

afterEach(() => mock.restore());

test('downloading a message returns its original source bytes', async () => {
  const source = 'Subject: hi\r\n\r\nbody';
  const fetchMock = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const request = input instanceof Request ? input : new Request(input);
      expect(request.method).toBe('GET');
      expect(new URL(request.url).pathname).toBe(
        '/email/messages/message-1/eml',
      );
      return new Response(source, {
        headers: { 'Content-Type': 'message/rfc822' },
      });
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
  const macro = new Macro({
    auth: { type: 'user', apiKey: 'mak_test' },
    hosts: { email: 'https://email.example.test' },
  });

  const eml = await macro.email.message('message-1').downloadEml();

  expect(await eml.text()).toBe(source);
});
