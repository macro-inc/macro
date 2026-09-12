import { describe, expect, test } from 'bun:test';
import { createClient } from '../generated/storage/client';
import { Sdk } from '../generated/storage/sdk.gen';
import type { EditDocumentData } from '../generated/storage/types.gen';

const documentId = '0198a4cc-e138-7670-a308-a6b766602700';
const baseUrl = 'https://api.example.test';

function recordingSdk() {
  const requests: Request[] = [];
  const transport = (async (input, init): Promise<Response> => {
    requests.push(input instanceof Request ? input : new Request(input, init));
    return Response.json({});
  }) as typeof fetch;
  const sdk = new Sdk({
    client: createClient({ baseUrl, fetch: transport, throwOnError: true }),
  });
  return { sdk, requests };
}

const editCases: Array<{
  name: string;
  body: EditDocumentData['body'];
  serializedBody: string;
}> = [
  {
    name: 'omitted share permission',
    body: {},
    serializedBody: '{}',
  },
  {
    name: 'omitted team level keeps the link fields alone',
    body: { sharePermission: { linkShareAccessLevel: 'view' } },
    serializedBody: '{"sharePermission":{"linkShareAccessLevel":"view"}}',
  },
  {
    name: 'undefined team level is omitted, not cleared',
    body: { sharePermission: { teamShareAccessLevel: undefined } },
    serializedBody: '{"sharePermission":{}}',
  },
  {
    name: 'explicit null clears team sharing',
    body: { sharePermission: { teamShareAccessLevel: null } },
    serializedBody: '{"sharePermission":{"teamShareAccessLevel":null}}',
  },
  {
    name: 'view',
    body: { sharePermission: { teamShareAccessLevel: 'view' } },
    serializedBody: '{"sharePermission":{"teamShareAccessLevel":"view"}}',
  },
  {
    name: 'comment',
    body: { sharePermission: { teamShareAccessLevel: 'comment' } },
    serializedBody: '{"sharePermission":{"teamShareAccessLevel":"comment"}}',
  },
  {
    name: 'edit',
    body: { sharePermission: { teamShareAccessLevel: 'edit' } },
    serializedBody: '{"sharePermission":{"teamShareAccessLevel":"edit"}}',
  },
];

describe('document edit team-share serialization', () => {
  test.each(editCases)('$name', async ({ body, serializedBody }) => {
    const { sdk, requests } = recordingSdk();

    await sdk.editDocument({ path: { document_id: documentId }, body });

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request.url).toBe(`${baseUrl}/documents/${documentId}`);
    expect(request.method).toBe('PATCH');
    expect(request.headers.get('content-type')).toBe('application/json');
    expect(await request.text()).toBe(serializedBody);
  });
});

describe('legacy document team-share toggle', () => {
  test.each([true, false])('shareWithTeam=%p', async (shareWithTeam) => {
    const { sdk, requests } = recordingSdk();

    await sdk.setDocumentTeamShare({
      path: { document_id: documentId },
      body: { shareWithTeam },
    });
    await sdk.getDocumentTeamShare({ path: { document_id: documentId } });

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['PUT', `${baseUrl}/documents/${documentId}/team_share`],
      ['GET', `${baseUrl}/documents/${documentId}/team_share`],
    ]);
    expect(await requests[0].text()).toBe(JSON.stringify({ shareWithTeam }));
  });
});
