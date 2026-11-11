import { Client } from '@opensearch-project/opensearch';
import { serve, type Server } from 'bun';
import { describe, expect, test } from 'bun:test';
import {
  addImportedAuthor,
  IMPORTED_AUTHOR_MAPPING,
} from './add_imported_author';

type MappingServerOptions = {
  exists?: boolean;
  acknowledged?: boolean;
  reject?: boolean;
};
type MappingRequest = { method: string; path: string; body: unknown };

function mappingServer(options: MappingServerOptions = {}): {
  client: Client;
  server: Server<undefined>;
  requests: MappingRequest[];
} {
  const requests: MappingRequest[] = [];
  const server = serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const body = request.method === 'HEAD' ? null : await request.json();
      requests.push({ method: request.method, path, body });
      if (request.method === 'HEAD') {
        return new Response(null, {
          status: options.exists === false ? 404 : 200,
        });
      }
      if (options.reject) {
        return Response.json({ error: 'conflicting mapping' }, { status: 400 });
      }
      return Response.json({ acknowledged: options.acknowledged ?? true });
    },
  });
  const client = new Client({ node: server.url.toString() });
  return { client, server, requests };
}

describe('addImportedAuthor', () => {
  test('explicitly removes copy_to from existing author mappings', () => {
    expect(IMPORTED_AUTHOR_MAPPING.copy_to).toEqual([]);
  });

  test('adds only author mapping to the live alias and can be rerun', async () => {
    const { client, server, requests } = mappingServer();
    try {
      await addImportedAuthor(client, false);
      await addImportedAuthor(client, false);
      expect(requests.filter((request) => request.method !== 'HEAD')).toEqual([
        {
          method: 'POST',
          path: '/channels/_mapping',
          body: { properties: { imported_author: IMPORTED_AUTHOR_MAPPING } },
        },
        {
          method: 'POST',
          path: '/channels/_mapping',
          body: { properties: { imported_author: IMPORTED_AUTHOR_MAPPING } },
        },
      ]);
    } finally {
      await client.close();
      server.stop();
    }
  });

  test('dry run never writes', async () => {
    const { client, server, requests } = mappingServer();
    try {
      await addImportedAuthor(client, true, 'channels_v2');
      expect(requests).toEqual([
        { method: 'HEAD', path: '/channels_v2', body: null },
      ]);
    } finally {
      await client.close();
      server.stop();
    }
  });

  const failureCases: MappingServerOptions[] = [
    { exists: false },
    { acknowledged: false },
    { reject: true },
  ];
  for (const options of failureCases) {
    test(`fails clearly: ${JSON.stringify(options)}`, async () => {
      const { client, server, requests } = mappingServer(options);
      try {
        await expect(addImportedAuthor(client, false)).rejects.toThrow();
        if (options.exists === false) {
          expect(requests).toHaveLength(1);
        }
      } finally {
        await client.close();
        server.stop();
      }
    });
  }
});
