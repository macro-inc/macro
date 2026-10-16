import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const macro = () =>
  new Macro({
    token: 'test-user-token',
    hosts: { storage: 'https://storage.example.test' },
  });

test('document content reads live Markdown over the authenticated API', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return Response.json({ text: '# Current live document' });
  }) as typeof fetch;
  expect(await macro().documents.byId('native-document').content()).toBe(
    '# Current live document',
  );
  expect(requests).toHaveLength(1);
  expect(new URL(requests[0].url).pathname).toBe(
    '/documents/native-document/text-content',
  );
  expect(requests[0].headers.get('authorization')).toBe(
    'Bearer test-user-token',
  );
});

test('an empty live document does not fall back to legacy storage', async () => {
  let count = 0;
  globalThis.fetch = (async (_input) => {
    count++;
    return Response.json({ text: '' });
  }) as typeof fetch;
  expect(await macro().documents.byId('empty-document').content()).toBe('');
  expect(count).toBe(1);
});

test('other formats retain presigned export and never forward the user token to storage', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    if (request.url.endsWith('/text-content'))
      return Response.json({ text: null });
    if (request.url.endsWith('/export'))
      return Response.json({
        presigned_url: 'https://files.example.test/object?signature=test',
      });
    return new Response('raw file text');
  }) as typeof fetch;
  expect(await macro().documents.byId('uploaded-file').content()).toBe(
    'raw file text',
  );
  expect(requests).toHaveLength(3);
  expect(requests[2].headers.get('authorization')).toBeNull();
});

test('a failed live read is visible and never silently serves a stale export', async () => {
  let count = 0;
  globalThis.fetch = (async (_input) => {
    count++;
    return Response.json(
      { message: 'live source unavailable' },
      { status: 500 },
    );
  }) as typeof fetch;
  await expect(
    macro().documents.byId('native-document').content(),
  ).rejects.toThrow();
  expect(count).toBe(1);
});
