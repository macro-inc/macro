import { afterEach, describe, expect, test, vi } from 'vitest';
import { createHandler } from './app';
import { parseConfig } from './config';

const BINDINGS = {
  ENVIRONMENT: 'test',
  MACRO_ENV: 'dev',
  RESOURCE_URL: 'https://mcp-chatgpt.test/mcp',
  AUTHORIZATION_SERVER_URL: 'https://auth.test',
  TOOL_GROUPING: 'entity',
  MACRO_HOSTS: JSON.stringify({
    storage: 'https://storage.test',
    auth: 'https://auth-service.test',
  }),
  PERSON_TOKEN_KEY: btoa('k'.repeat(32)),
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

  test('the OpenAI apps challenge serves the configured token', async () => {
    const handle = createHandler(
      parseConfig({ ...BINDINGS, OPENAI_APPS_CHALLENGE: 'challenge-token' })
    );

    const response = await handle(
      new Request('https://mcp-chatgpt.test/.well-known/openai-apps-challenge')
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('challenge-token');
  });

  test('the OpenAI apps challenge is a 404 without a token', async () => {
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(
      new Request('https://mcp-chatgpt.test/.well-known/openai-apps-challenge')
    );

    expect(response.status).toBe(404);
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
      title: 'documents: delete, overwrite and other irreversible changes',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
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

  describe('person tokens', () => {
    type Seen = { url: string; body: unknown };

    /** A Macro that answers as `viewer` and records each request. */
    function stubMacro(viewer: string, respond: (url: string) => unknown) {
      const seen: Seen[] = [];
      vi.stubGlobal(
        'fetch',
        async (input: Request | string, init?: RequestInit) => {
          const request = new Request(input, init);
          const text = await request.text();
          seen.push({ url: request.url, body: text ? JSON.parse(text) : null });
          if (request.url.endsWith('/user/me'))
            return Response.json({ user_id: viewer });
          if (request.url.endsWith('/user/get_names_with_email'))
            return Response.json({
              names: [
                {
                  id: 'macro|someone@example.com',
                  first_name: 'Some',
                  last_name: 'One',
                },
              ],
            });
          return Response.json(respond(request.url));
        }
      );
      return seen;
    }

    async function call(
      handle: (request: Request) => Promise<Response>,
      name: string,
      args: object,
      bearer = 'user-token'
    ) {
      const response = await handle(
        rpc('tools/call', { name, arguments: args }, bearer)
      );
      return (await response.json()).result;
    }

    const PERMISSION = { op: 'Document.permission', document: 'doc-1' };

    test('results carry tokens, never user ids or emails', async () => {
      stubMacro('macro|viewer@example.com', () => ({
        permission: 'view',
        owner_id: 'macro|someone@example.com',
        shared_with: ['macro|other@example.com', 'someone@example.com'],
        'macro|someone@example.com': 'a key',
        text: 'Ping <m-user-mention>{"userId":"macro|someone@example.com","email":"someone@example.com"}</m-user-mention> or mail someone@example.com.',
      }));
      const handle = createHandler(parseConfig(BINDINGS));

      const result = await call(handle, 'documents_read', PERMISSION);
      const out = result.structuredContent.result;

      expect(JSON.stringify(result)).not.toMatch(/@|macro\|/);
      expect(out.owner_id).toMatch(/^person_u_[\w-]+$/);
      // One person, one token body, in every place and form.
      const body = out.owner_id.slice('person_u_'.length);
      expect(out.shared_with[1]).toBe(`person_e_${body}`);
      expect(out.text).toContain(
        `<m-user-mention>{"userId":"person_u_${body}","email":"person_e_${body}"}</m-user-mention>`
      );
      expect(out[`person_u_${body}`]).toBe('a key');
    });

    test('a token passed back reaches Macro as the id it replaced', async () => {
      const seen = stubMacro('macro|viewer@example.com', () => ({
        owner_id: 'macro|someone@example.com',
      }));
      const handle = createHandler(parseConfig(BINDINGS));
      const { owner_id } = (await call(handle, 'documents_read', PERMISSION))
        .structuredContent.result;

      seen.length = 0;
      await call(handle, 'tasks_write', {
        op: 'tasks.create',
        opts: {
          name: `Follow up with ${owner_id}`,
          assignees: [owner_id],
        },
      });

      const sent = JSON.stringify(seen);
      expect(sent).toContain('"macro|someone@example.com"');
      expect(sent).toContain('Follow up with macro|someone@example.com');
      expect(sent).not.toContain('person_');
    });

    test("a token doesn't open for another user", async () => {
      stubMacro('macro|viewer@example.com', () => ({
        owner_id: 'macro|someone@example.com',
      }));
      const handle = createHandler(parseConfig(BINDINGS));
      const { owner_id } = (await call(handle, 'documents_read', PERMISSION))
        .structuredContent.result;

      stubMacro('macro|stranger@example.com', () => ({}));
      const looked = await call(
        handle,
        'people_read',
        { tokens: [owner_id] },
        'stranger-token'
      );
      const passed = await call(
        handle,
        'documents_read',
        { ...PERMISSION, document: owner_id },
        'stranger-token'
      );

      expect(JSON.stringify(looked)).not.toContain('someone');
      expect(looked.structuredContent.people[0].error).toBeTruthy();
      expect(passed.isError).toBe(true);
      expect(passed.structuredContent.error.code).toBe('invalid');
    });

    test('a forged token is refused before Macro is called', async () => {
      const seen = stubMacro('macro|viewer@example.com', () => ({}));
      const handle = createHandler(parseConfig(BINDINGS));

      const result = await call(handle, 'documents_read', {
        ...PERMISSION,
        document: `person_u_${'A'.repeat(60)}`,
      });

      expect(result.structuredContent.error.code).toBe('invalid');
      expect(seen.some((request) => request.url.includes('/entity/'))).toBe(
        false
      );
    });

    test('people_read exchanges tokens for name and email', async () => {
      stubMacro('macro|viewer@example.com', () => ({
        owner_id: 'macro|someone@example.com',
        cc: 'outside@example.org',
      }));
      const handle = createHandler(parseConfig(BINDINGS));
      const { owner_id, cc } = (
        await call(handle, 'documents_read', PERMISSION)
      ).structuredContent.result;

      const result = await call(handle, 'people_read', {
        tokens: [owner_id, cc],
      });

      expect(result.structuredContent.people).toEqual([
        { token: owner_id, name: 'Some One', email: 'someone@example.com' },
        { token: cc, email: 'outside@example.org' },
      ]);
    });

    test('people_read is listed last, read-only', async () => {
      const handle = createHandler(parseConfig(BINDINGS));

      const body = await (
        await handle(rpc('tools/list', {}, 'user-token'))
      ).json();
      const people = body.result.tools.find(
        (tool: { name: string }) => tool.name === 'people_read'
      );

      expect(body.result.tools.at(-1).name).toBe('people_read');
      expect(people.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
      });
    });

    test('a deployed env without PERSON_TOKEN_KEY fails loudly', () => {
      const { PERSON_TOKEN_KEY: _, ...withoutKey } = BINDINGS;
      expect(() => parseConfig(withoutKey)).toThrow('PERSON_TOKEN_KEY');
      expect(() =>
        parseConfig({ ...withoutKey, PERSON_TOKEN_KEY: 'short' })
      ).toThrow('PERSON_TOKEN_KEY');
      expect(() =>
        parseConfig({ ...withoutKey, MACRO_ENV: 'local' })
      ).not.toThrow();
    });

    test('a token in event arguments reaches Macro as the id it replaced', async () => {
      const seen = stubMacro('macro|viewer@example.com', (url) =>
        url === 'https://auth.test/mcp'
          ? {
              jsonrpc: '2.0',
              id: 1,
              result: {
                id: 'sub-1',
                refreshBefore: '2027-01-01T00:00:00Z',
                cursor: null,
                truncated: false,
              },
            }
          : { owner_id: 'macro|someone@example.com' }
      );
      const handle = createHandler(parseConfig(BINDINGS));
      const { owner_id } = (await call(handle, 'documents_read', PERMISSION))
        .structuredContent.result;

      seen.length = 0;
      const response = await handle(
        rpc(
          'events/subscribe',
          {
            name: 'message.posted',
            arguments: { actor: owner_id },
            delivery: {
              mode: 'webhook',
              url: 'https://chatgpt.test/hook',
              secret: 'whsec_secret',
            },
            cursor: null,
          },
          'user-token'
        )
      );

      expect((await response.json()).result.id).toBe('sub-1');
      const sent = seen.find(({ url }) => url === 'https://auth.test/mcp');
      expect(sent?.body).toMatchObject({
        method: 'events/subscribe',
        params: { arguments: { actor: 'macro|someone@example.com' } },
      });
    });
  });
});

describe('MCP Events', () => {
  type Forwarded = { headers: Headers; body: unknown };

  /** The public MCP server, answering every forwarded request with `answer`. */
  function stubPublicMcp(answer: () => Response) {
    const forwarded: Forwarded[] = [];
    vi.stubGlobal(
      'fetch',
      async (input: Request | string, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.url).toBe('https://auth.test/mcp');
        forwarded.push({
          headers: request.headers,
          body: await request.json(),
        });
        return answer();
      }
    );
    return forwarded;
  }

  const LISTED = {
    events: [
      {
        name: 'message.mentioned',
        description: 'Someone mentioned a person or group in a message.',
        delivery: ['webhook'],
        inputSchema: { type: 'object' },
        payloadSchema: { type: 'object' },
      },
    ],
  };

  test('initialize advertises the events capability at the top level', async () => {
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(
      rpc(
        'initialize',
        {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'openai-mcp', version: '1.0.0' },
        },
        'user-token'
      )
    );

    expect((await response.json()).result.capabilities).toMatchObject({
      tools: {},
      events: {},
    });
  });

  test('events/list is answered by the public MCP server as the bearer, in the ChatGPT profile', async () => {
    const forwarded = stubPublicMcp(() =>
      Response.json({ jsonrpc: '2.0', id: 1, result: LISTED })
    );
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(rpc('events/list', {}, 'user-token'));

    expect((await response.json()).result).toEqual(LISTED);
    expect(forwarded).toHaveLength(1);
    const { headers, body } = forwarded[0] ?? {};
    expect(headers?.get('authorization')).toBe('Bearer user-token');
    expect(headers?.get('x-macro-events-profile')).toBe('chatgpt');
    expect(headers?.get('mcp-protocol-version')).toBe('2026-07-28');
    expect(body).toMatchObject({ method: 'events/list', params: {} });
  });

  test('a refusal keeps its code, message and data', async () => {
    stubPublicMcp(() =>
      Response.json({
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32015,
          message: 'The callback did not echo the challenge',
          data: { reason: 'challenge_failed' },
        },
      })
    );
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(
      rpc(
        'events/subscribe',
        {
          name: 'message.posted',
          arguments: {},
          delivery: {
            mode: 'webhook',
            url: 'https://chatgpt.test/hook',
            secret: 'whsec_secret',
          },
          cursor: null,
        },
        'user-token'
      )
    );

    expect((await response.json()).error).toEqual({
      code: -32015,
      message: 'The callback did not echo the challenge',
      data: { reason: 'challenge_failed' },
    });
  });

  test('unsubscribe relays the empty result', async () => {
    stubPublicMcp(() => Response.json({ jsonrpc: '2.0', id: 1, result: {} }));
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(
      rpc(
        'events/unsubscribe',
        {
          name: 'message.posted',
          arguments: {},
          delivery: { url: 'https://chatgpt.test/hook' },
        },
        'user-token'
      )
    );

    expect((await response.json()).result).toEqual({});
  });

  test('an answer that is not JSON-RPC is an internal error', async () => {
    stubPublicMcp(() => new Response('bad gateway', { status: 502 }));
    const handle = createHandler(parseConfig(BINDINGS));

    const response = await handle(rpc('events/list', {}, 'user-token'));

    expect((await response.json()).error.code).toBe(-32603);
  });
});
