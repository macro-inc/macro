import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('domain blocks preserve the server mailbox explanation and status', async () => {
  const message =
    "Blocking this domain would hide all of a connected mailbox's email from the CRM.";
  const requests: { method: string; path: string }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push({
        method: request.method,
        path: new URL(request.url).pathname,
      });
      return Response.json({ message }, { status: 400 });
    },
    { preconnect: originalFetch.preconnect },
  );
  const macro = new Macro({
    token: 'fixture',
    hosts: { storage: 'https://storage.test' },
  });
  await expect(macro.crm.blockDomain('gmail.com')).rejects.toMatchObject({
    name: 'MacroApiError',
    status: 400,
    message: expect.stringContaining(message),
    data: { message },
  });
  expect(requests).toEqual([
    { method: 'PUT', path: '/crm/blocked-domains/gmail.com' },
  ]);
});
