import { afterEach, expect, test } from 'bun:test';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const STORAGE = 'https://storage.example.test';

const macro = () =>
  new Macro({ token: 'test-user-token', hosts: { storage: STORAGE } });

function recordRequests(respond: (request: Request) => Response): Request[] {
  const requests: Request[] = [];
  globalThis.fetch = (async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request);
    return respond(request);
  }) as typeof fetch;
  return requests;
}

test('upload sends the bytes to the storage host and returns the new document', async () => {
  const requests = recordRequests(() =>
    Response.json({ documentId: 'uploaded', sizeBytes: 3 }),
  );
  const client = macro();

  const document = await client.documents.upload({
    name: 'chart.png',
    content: new Uint8Array([137, 80, 78]),
    project: client.projects.byId('project-1'),
  });

  expect(document.id).toBe('uploaded');
  expect(requests).toHaveLength(1);
  const [request] = requests;
  const url = new URL(request.url);
  expect(request.method).toBe('POST');
  expect(url.origin + url.pathname).toBe(`${STORAGE}/documents/upload`);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    fileName: 'chart.png',
    projectId: 'project-1',
  });
  expect(request.headers.get('content-type')).toBe('application/octet-stream');
  expect(request.headers.get('authorization')).toBe('Bearer test-user-token');
  expect(new Uint8Array(await request.arrayBuffer())).toEqual(
    new Uint8Array([137, 80, 78]),
  );
});

test('upload stores string content as UTF-8 text', async () => {
  const requests = recordRequests(() =>
    Response.json({ documentId: 'csv', sizeBytes: 9 }),
  );

  await macro().documents.upload({ name: 'data.csv', content: 'a,b\n1,é\n' });

  expect(new URL(requests[0].url).searchParams.has('projectId')).toBe(false);
  expect(await requests[0].text()).toBe('a,b\n1,é\n');
});

test('bytes downloads the stored file without forwarding the user token', async () => {
  const requests = recordRequests((request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/documents/report')
      return Response.json({
        data: { documentMetadata: { documentId: 'report', fileType: 'pdf' } },
      });
    if (pathname === '/documents/report/export')
      return Response.json({
        presigned_url: 'https://files.example.test/object?signature=test',
      });
    return new Response(new Uint8Array([37, 80, 68, 70]));
  });

  const bytes = await macro().documents.byId('report').bytes();

  expect(bytes).toEqual(new Uint8Array([37, 80, 68, 70]));
  expect(requests.map((request) => new URL(request.url).host)).toEqual([
    'storage.example.test',
    'storage.example.test',
    'files.example.test',
  ]);
  expect(requests[2].headers.get('authorization')).toBeNull();
});

test('bytes refuses a native document instead of serving its stale export', async () => {
  const requests = recordRequests(() =>
    Response.json({
      data: { documentMetadata: { documentId: 'notes', fileType: 'md' } },
    }),
  );

  await expect(macro().documents.byId('notes').bytes()).rejects.toThrow(
    'a native md document has no stored file; read it with content()',
  );
  expect(requests).toHaveLength(1);
});

test('channel messages attach documents as file chips', async () => {
  const requests = recordRequests(() => Response.json({ id: 'message' }));
  const client = macro();

  await client.channels.byId('channel').send('Q3 numbers attached.', {
    documents: [client.documents.byId('csv')],
  });

  expect(new URL(requests[0].url).pathname).toBe('/messages/channel/channel');
  expect((await requests[0].json()).attachments).toEqual([
    { entity_type: 'document', entity_id: 'csv' },
  ]);
});
