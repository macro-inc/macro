import { afterEach, describe, expect, test, vi } from 'vitest';
import { createHandler } from './app';
import { parseConfig } from './config';

const BINDINGS = {
  ENVIRONMENT: 'test',
  MACRO_ENV: 'dev',
  RESOURCE_URL: 'https://mcp-chatgpt.test/mcp',
  AUTHORIZATION_SERVER_URL: 'https://auth.test',
  TOOL_GROUPING: 'entity',
  MACRO_HOSTS: JSON.stringify({ storage: 'https://storage.test' }),
};

function rpc(method: string, params: object, token?: string) {
  return new Request('https://mcp-chatgpt.test/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createHandler', () => {
  test('protected-resource metadata names this resource and the broker', async () => {
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(
      new Request(
        'https://mcp-chatgpt.test/.well-known/oauth-protected-resource/mcp'
      )
    );

    expect(await response.json()).toEqual({
      resource: 'https://mcp-chatgpt.test/mcp',
      authorization_servers: ['https://auth.test'],
      bearer_methods_supported: ['header'],
      resource_name: 'Macro',
    });
  });

  test('a request without a bearer token is sent to the metadata', async () => {
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(rpc('tools/list', {}));

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://mcp-chatgpt.test/.well-known/oauth-protected-resource/mcp"'
    );
  });

  test('tools/list lists the entity tools with every hint set', async () => {
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(rpc('tools/list', {}, 'user-token'));
    const body = await response.json();
    const documentsDelete = body.result.tools.find(
      (tool: { name: string }) => tool.name === 'documents_delete'
    );

    expect(documentsDelete.annotations).toEqual({
      title: 'documents: delete, overwrite and send',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(documentsDelete.inputSchema.required).toEqual(['op']);
  });

  test('the method grouping lists one tool per operation', async () => {
    const handle = createHandler(
      parseConfig({ ...BINDINGS, TOOL_GROUPING: 'method' })
    );

    const response = await handle(rpc('tools/list', {}, 'user-token'));
    const body = await response.json();
    const names = body.result.tools.map((tool: { name: string }) => tool.name);

    expect(names).toContain('document-permission');
    expect(names).not.toContain('documents_read');
  });

  test('tools/call runs the operation as the bearer token', async () => {
    const requests: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      async (input: Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        requests.push({
          url: request.url,
          authorization: request.headers.get('authorization'),
        });
        return Response.json({ permission: 'view' });
      }
    );
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(
      rpc(
        'tools/call',
        {
          name: 'documents_read',
          arguments: { op: 'Document.permission', document: 'doc-1' },
        },
        'user-token'
      )
    );
    const body = await response.json();

    expect(requests).toEqual([
      {
        url: 'https://storage.test/entity/document/doc-1/permissions',
        authorization: 'Bearer user-token',
      },
    ]);
    expect(body.result.structuredContent).toEqual({
      result: { permission: 'view' },
      url: 'https://dev.macro.com/app/md/doc-1',
    });
  });

  test('an entity tool with one operation still takes it as op', async () => {
    vi.stubGlobal('fetch', async () => Response.json([]));
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(
      rpc(
        'tools/call',
        { name: 'pins_read', arguments: { op: 'pins.list' } },
        'user-token'
      )
    );
    const body = await response.json();

    expect(body.result.isError).toBeUndefined();
  });

  test('an op the tool does not offer is an invalid tool result', async () => {
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(
      rpc(
        'tools/call',
        { name: 'documents_read', arguments: { op: 'Document.delete' } },
        'user-token'
      )
    );
    const body = await response.json();

    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent.error.code).toBe('invalid');
  });
});
