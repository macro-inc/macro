import { describe, expect, test } from 'bun:test';
import { createClient as createCognitionClient } from '../generated/cognition/client';
import { Sdk as CognitionSdk } from '../generated/cognition/sdk.gen';
import type { PatchChatData } from '../generated/cognition/types.gen';
import { createClient as createStorageClient } from '../generated/storage/client';
import { Sdk as StorageSdk } from '../generated/storage/sdk.gen';
import type { EditDocumentData } from '../generated/storage/types.gen';

const entityId = '0198a4cc-e138-7670-a308-a6b766602700';
const baseUrl = 'https://api.example.test';

const cases: Array<{
  name: string;
  body: EditDocumentData['body'] & PatchChatData['body'];
  serializedBody: string;
}> = [
  {
    name: 'omitted share permission',
    body: {},
    serializedBody: '{}',
  },
  {
    name: 'omitted team level',
    body: { sharePermission: { linkShareAccessLevel: 'view' } },
    serializedBody: '{"sharePermission":{"linkShareAccessLevel":"view"}}',
  },
  {
    name: 'undefined team level',
    body: { sharePermission: { teamShareAccessLevel: undefined } },
    serializedBody: '{"sharePermission":{}}',
  },
  {
    name: 'explicit NULL',
    body: { sharePermission: { teamShareAccessLevel: null } },
    serializedBody: '{"sharePermission":{"teamShareAccessLevel":null}}',
  },
  {
    name: 'View',
    body: { sharePermission: { teamShareAccessLevel: 'view' } },
    serializedBody: '{"sharePermission":{"teamShareAccessLevel":"view"}}',
  },
  {
    name: 'Comment',
    body: { sharePermission: { teamShareAccessLevel: 'comment' } },
    serializedBody: '{"sharePermission":{"teamShareAccessLevel":"comment"}}',
  },
  {
    name: 'Edit',
    body: { sharePermission: { teamShareAccessLevel: 'edit' } },
    serializedBody: '{"sharePermission":{"teamShareAccessLevel":"edit"}}',
  },
];

describe('generated SDK team-share request serialization', () => {
  test.each(cases)('$name', async ({ body, serializedBody }) => {
    const requests: Request[] = [];
    const transport = (async (input, init): Promise<Response> => {
      requests.push(
        input instanceof Request ? input : new Request(input, init),
      );
      return Response.json({});
    }) as typeof fetch;
    const storage = new StorageSdk({
      client: createStorageClient({
        baseUrl,
        fetch: transport,
        throwOnError: true,
      }),
    });
    const cognition = new CognitionSdk({
      client: createCognitionClient({
        baseUrl,
        fetch: transport,
        throwOnError: true,
      }),
    });

    await storage.editDocument({ path: { document_id: entityId }, body });
    await storage.editProjectV2({ path: { id: entityId }, body });
    await storage.editThreadV2({ path: { thread_id: entityId }, body });
    await storage.editCallRecord({ path: { call_id: entityId }, body });
    await cognition.patchChat({ path: { chat_id: entityId }, body });

    expect(requests.map((request) => request.url)).toEqual([
      `${baseUrl}/documents/${entityId}`,
      `${baseUrl}/v2/projects/${entityId}`,
      `${baseUrl}/threads/${entityId}`,
      `${baseUrl}/call/record/${entityId}`,
      `${baseUrl}/chat/${entityId}`,
    ]);
    for (const request of requests) {
      expect(request.method).toBe('PATCH');
      expect(request.headers.get('content-type')).toBe('application/json');
      expect(await request.text()).toBe(serializedBody);
    }
  });
});
