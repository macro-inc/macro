import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('simpleSave sends the content as the multipart file field', async () => {
  const requests: Request[] = [];
  globalThis.fetch = (async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    requests.push(request.clone());
    return Response.json({ data: { documentMetadata: { documentId: 'doc' } } });
  }) as typeof fetch;
  const macro = new Macro({
    token: 'test-token',
    hosts: { storage: 'https://storage.test' },
  });

  await macro.documents.byId('doc').simpleSave('<p>new</p>');

  const [request] = requests;
  if (!request || requests.length !== 1)
    throw new Error(`expected one request, got ${requests.length}`);
  expect(request.method).toBe('PUT');
  expect(new URL(request.url).pathname).toBe('/documents/doc/simple_save');
  const file = (await request.formData()).get('file');
  expect(file).toBeInstanceOf(Blob);
  expect(await (file as Blob).text()).toBe('<p>new</p>');
});
