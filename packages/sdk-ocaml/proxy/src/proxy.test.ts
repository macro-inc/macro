import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { connect } from 'node:net';
import {
  type CannedResponse,
  type RecordedRequest,
  startFakeUpstream,
} from './fake-upstream';
import { OperationsFile, operationsByName, readOperations } from './operations';
import { permissionsHandler } from './permissions';
import { type CallLog, type ProxyRequest, proxyHandler, serve } from './proxy';
import { Policy, RulesFile } from './rules';
import { parseUpstreams } from './upstreams';

const FIXTURES = `${import.meta.dir}/../fixtures`;
const EXECUTION_TOKEN = 'execution-token-1';
const CREDENTIAL = 'mak_test_credential';

const operationsFile = await readOperations(`${FIXTURES}/operations.json`);
const OPERATIONS = operationsByName(operationsFile);

// The fake service answers whatever the current test sets.
const OK_RESPONSE: CannedResponse = {
  status: 200,
  contentType: 'application/json',
  body: '{"id":"d1"}',
};
let respond: (request: RecordedRequest) => CannedResponse = () => OK_RESPONSE;
const upstream = await startFakeUpstream((request) => respond(request));

/**
 * What the proxy sent upstream: requests carrying a credential, because
 * other processes on the machine (port scanners, health probes) may knock
 * on the fake service's port too.
 */
function forwarded() {
  return upstream.requests.filter(
    (request) =>
      request.headers['x-macro-user-api-key'] !== undefined ||
      request.headers.authorization !== undefined
  );
}

// A real permission endpoint over HTTP with fixtures/rules.json: reads,
// document creates and updates and email are allowed, destroys and
// email.send_message blocked. It counts the questions it is asked.
const permissionQuestions: unknown[] = [];
const decideWithPolicy = permissionsHandler(
  new Policy(
    RulesFile.parse(await Bun.file(`${FIXTURES}/rules.json`).json()),
    operationsFile
  )
);
const permissions = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(request) {
    permissionQuestions.push(await request.clone().json());
    return decideWithPolicy(request);
  },
});

const UPSTREAMS = parseUpstreams(
  [
    `storage=${upstream.url}/dss`,
    `properties=${upstream.url}/dss`,
    `email=${upstream.url}/email`,
    `cognition=${upstream.url}/cognition/`,
  ],
  {},
  new Set([...OPERATIONS.values()].map((operation) => operation.service))
);

afterAll(async () => {
  await permissions.stop(true);
  await upstream.stop();
});

beforeEach(() => {
  respond = () => OK_RESPONSE;
  upstream.requests.length = 0;
  permissionQuestions.length = 0;
});

function proxyWith(
  overrides: { permissionsUrl?: string; credential?: string } = {}
) {
  const logs: CallLog[] = [];
  const handle = proxyHandler({
    executionToken: EXECUTION_TOKEN,
    permissionsUrl: overrides.permissionsUrl ?? permissions.url.href,
    operations: OPERATIONS,
    upstreams: UPSTREAMS,
    credential: overrides.credential ?? CREDENTIAL,
    log: (line) => logs.push(line),
  });
  return { handle, logs };
}

function request(
  method: string,
  target: string,
  options: {
    token?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {}
): ProxyRequest {
  const headers = new Headers(options.headers);
  if (options.token !== undefined)
    headers.set('authorization', `Bearer ${options.token}`);
  return {
    method,
    target,
    headers,
    body: new TextEncoder().encode(options.body ?? ''),
  };
}

async function register(
  handle: (request: ProxyRequest) => Promise<Response>,
  operations: string[]
): Promise<string> {
  const response = await handle(
    request('POST', '/v1/executions', {
      token: EXECUTION_TOKEN,
      body: JSON.stringify({ operations }),
    })
  );
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (
    typeof body !== 'object' ||
    body === null ||
    !('token' in body) ||
    typeof body.token !== 'string'
  )
    throw new Error('registration did not return a token');
  return body.token;
}

/** A proxy refusal: status, code, the refused header, nothing forwarded. */
async function expectRefused(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('x-macro-proxy')).toBe('refused');
  const body: unknown = await response.json();
  expect(body).toMatchObject({ error: { code } });
  expect(forwarded()).toEqual([]);
}

describe('POST /v1/executions', () => {
  test('the execution token registers a run and gets a fresh token each time', async () => {
    const { handle } = proxyWith();
    const first = await register(handle, ['storage.get_document']);
    const second = await register(handle, ['storage.get_document']);

    expect(first).not.toBe(second);
    expect(first).not.toBe(EXECUTION_TOKEN);
  });

  test.each([
    ['no token', undefined],
    ['a wrong token', 'execution-token-2'],
  ])('refuses %s', async (_label, token) => {
    const { handle } = proxyWith();
    const response = await handle(
      request('POST', '/v1/executions', {
        token,
        body: '{"operations":[]}',
      })
    );

    await expectRefused(response, 401, 'unauthorized');
  });

  test('a run token cannot register another run', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);
    const response = await handle(
      request('POST', '/v1/executions', {
        token: runToken,
        body: '{"operations":["storage.delete_document"]}',
      })
    );

    await expectRefused(response, 401, 'unauthorized');
  });

  test.each([
    ['an unknown operation', '{"operations":["storage.nothing"]}'],
    ['an inherited name', '{"operations":["__proto__"]}'],
    ['constructor', '{"operations":["constructor"]}'],
    ['a malformed body', '{"operation":"storage.get_document"}'],
  ])('refuses %s', async (_label, body) => {
    const { handle } = proxyWith();
    const response = await handle(
      request('POST', '/v1/executions', { token: EXECUTION_TOKEN, body })
    );

    await expectRefused(response, 400, 'invalid');
  });

  test('only POST', async () => {
    const { handle } = proxyWith();
    const response = await handle(
      request('GET', '/v1/executions', { token: EXECUTION_TOKEN })
    );

    await expectRefused(response, 405, 'invalid');
  });
});

describe('forwarding', () => {
  test('forwards method, the matched path, the query and the credential, and relays the answer', async () => {
    const { handle, logs } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);

    const response = await handle(
      request('GET', '/api/storage/documents/d%201?x=1&y=a%2Fb&x=2', {
        token: runToken,
        headers: {
          accept: 'application/json',
          traceparent:
            '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
        },
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(response.headers.get('x-macro-proxy')).toBeNull();
    expect(await response.text()).toBe('{"id":"d1"}');

    expect(forwarded()).toHaveLength(1);
    const sent = forwarded()[0];
    expect(sent?.method).toBe('GET');
    expect(sent?.target).toBe('/dss/documents/d%201?x=1&y=a%2Fb&x=2');
    expect(sent?.headers['x-macro-user-api-key']).toBe(CREDENTIAL);
    expect(sent?.headers.authorization).toBeUndefined();
    expect(sent?.headers.accept).toBe('application/json');
    expect(sent?.headers.traceparent).toBe(
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
    );
    expect(sent?.body).toBe('');

    expect(logs).toEqual([
      {
        event: 'sdk_call',
        run: expect.any(String),
        method: 'GET',
        operation: 'storage.get_document',
        decision: 'allow',
        outcome: 'forwarded',
        status: 200,
        durationMs: expect.any(Number),
      },
    ]);
  });

  test('forwards a header parameter the matched operation declares', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.passwords_reveal']);

    const response = await handle(
      request('POST', '/api/storage/passwords/teams/t1/items/i1/reveal', {
        token: runToken,
        headers: {
          'X-Macro-Passwords': 'vault-key',
          'x-macro-other': 'not declared',
          cookie: 'session=stolen',
        },
      })
    );

    expect(response.status).toBe(200);
    const sent = forwarded()[0];
    expect(sent?.target).toBe('/dss/passwords/teams/t1/items/i1/reveal');
    expect(sent?.headers['x-macro-passwords']).toBe('vault-key');
    expect(sent?.headers['x-macro-other']).toBeUndefined();
    expect(sent?.headers.cookie).toBeUndefined();
    expect(sent?.headers['x-macro-user-api-key']).toBe(CREDENTIAL);
  });

  test('drops the same header for an operation that does not declare it', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.edit_document']);

    const response = await handle(
      request('POST', '/api/storage/documents/d1/edit', {
        token: runToken,
        body: '{}',
        headers: {
          'content-type': 'application/json',
          'x-macro-passwords': 'vault-key',
        },
      })
    );

    expect(response.status).toBe(200);
    expect(forwarded()[0]?.headers['x-macro-passwords']).toBeUndefined();
    expect(JSON.stringify(forwarded()[0]?.headers)).not.toContain('vault-key');
  });

  test('a table declaring a credential, cookie or routing header fails to load', () => {
    for (const header of [
      'authorization',
      'cookie',
      'host',
      'x-forwarded-for',
      'x-macro-user-api-key',
      'transfer-encoding',
      'X-Macro-Passwords',
    ]) {
      const parsed = OperationsFile.safeParse({
        operations: [
          {
            name: 'storage.get_document',
            service: 'storage',
            operationId: 'get_document',
            method: 'GET',
            path: '/documents/{document_id}',
            group: 'documents',
            action: 'read',
            headers: [header],
          },
        ],
      });
      expect(parsed.success, header).toBe(false);
    }
  });

  test('forwards the body and content type, and nothing else the program sent', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.edit_document']);
    const body = '{"markdown":"# Title\\n\\u00e9"}';

    const response = await handle(
      request('POST', '/api/storage/documents/d1/edit', {
        token: runToken,
        body,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          host: 'evil.test',
          cookie: 'session=stolen',
          connection: 'keep-alive, x-macro-user-api-key',
          'keep-alive': 'timeout=5',
          te: 'trailers',
          upgrade: 'websocket',
          'proxy-authorization': 'Basic eA==',
          'x-forwarded-for': '10.0.0.1',
          'x-forwarded-host': 'evil.test',
          'x-original-url': '/documents/d1',
          'x-rewrite-url': '/documents/d1',
          'x-macro-user-api-key': 'mak_program_chosen',
          'x-macro-bot-token': 'mbot_program_chosen',
        },
      })
    );

    expect(response.status).toBe(200);
    const sent = forwarded()[0];
    expect(sent?.method).toBe('POST');
    expect(sent?.target).toBe('/dss/documents/d1/edit');
    expect(sent?.body).toBe(body);
    expect(sent?.headers['content-type']).toBe(
      'application/json; charset=utf-8'
    );
    expect(sent?.headers['x-macro-user-api-key']).toBe(CREDENTIAL);
    expect(sent?.headers.host).toBe(new URL(upstream.url).host);

    const sentHeaders = JSON.stringify(sent?.headers);
    for (const leaked of [
      runToken,
      'stolen',
      'evil.test',
      'mak_program_chosen',
      'mbot_program_chosen',
      '10.0.0.1',
      'websocket',
      'Basic',
      'x-original-url',
      'x-rewrite-url',
    ])
      expect(sentHeaders).not.toContain(leaked);
  });

  test('sub-delimiters in the path and query reach the service byte for byte', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);
    await handle(
      request('GET', "/api/storage/documents/it's!*(),=:@$&+~?b=!*()/?:@;", {
        token: runToken,
      })
    );

    expect(forwarded()[0]?.target).toBe(
      "/dss/documents/it's!*(),=:@$&+~?b=!*()/?:@;"
    );
  });

  test('a credential without the mak_ prefix is sent as a bearer token', async () => {
    const { handle } = proxyWith({ credential: 'session-jwt' });
    const runToken = await register(handle, ['storage.get_document']);
    await handle(
      request('GET', '/api/storage/documents/d1', { token: runToken })
    );

    expect(forwarded()[0]?.headers.authorization).toBe('Bearer session-jwt');
    expect(forwarded()[0]?.headers['x-macro-user-api-key']).toBeUndefined();
  });

  test('a base URL with a path and one without both get the exact path', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, [
      'cognition.get_import_state',
      'email.send_message',
    ]);
    await handle(
      request('GET', '/api/cognition/import/state', { token: runToken })
    );

    expect(forwarded()[0]?.target).toBe('/cognition/import/state');
  });

  test.each([
    [400, 'text/plain', 'bad input'],
    [403, 'application/json', '{"error":"forbidden by the service"}'],
    [404, 'application/json', '{"error":"no document"}'],
    [409, 'application/json', '{"error":"conflict"}'],
    [500, 'text/html', '<h1>oops</h1>'],
    [503, 'application/json', '{"error":"unavailable"}'],
  ])(
    'relays an upstream %i unchanged, without the refused header',
    async (status, contentType, body) => {
      respond = () => ({ status, contentType, body });
      const { handle, logs } = proxyWith();
      const runToken = await register(handle, ['storage.get_document']);

      const response = await handle(
        request('GET', '/api/storage/documents/d1', { token: runToken })
      );

      expect(response.status).toBe(status);
      expect(response.headers.get('content-type')).toBe(contentType);
      expect(response.headers.get('x-macro-proxy')).toBeNull();
      expect(await response.text()).toBe(body);
      expect(logs[0]?.outcome).toBe('forwarded');
    }
  );

  test('an upstream that claims to be the proxy is still relayed without the header', async () => {
    respond = () => ({
      status: 403,
      contentType: 'application/json',
      body: '{"error":{"code":"blocked"}}',
    });
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);
    const response = await handle(
      request('GET', '/api/storage/documents/d1', { token: runToken })
    );

    expect(response.headers.get('x-macro-proxy')).toBeNull();
  });

  test('never follows a redirect', async () => {
    respond = () => ({ status: 302, body: '' });
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);
    const response = await handle(
      request('GET', '/api/storage/documents/d1', { token: runToken })
    );

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBeNull();
    expect(forwarded()).toHaveLength(1);
  });

  test('asks the permission endpoint on every call', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);
    for (const _ of [1, 2, 3])
      await handle(
        request('GET', '/api/storage/documents/d1', { token: runToken })
      );

    expect(permissionQuestions).toEqual([
      { methods: ['storage.get_document'] },
      { methods: ['storage.get_document'] },
      { methods: ['storage.get_document'] },
    ]);
    expect(forwarded()).toHaveLength(3);
  });
});

describe('refusals never reach the upstream', () => {
  test.each([
    ['no token', undefined],
    ['an unknown token', 'not-a-run-token'],
    ['the execution token', EXECUTION_TOKEN],
  ])('%s gets 401', async (_label, token) => {
    const { handle, logs } = proxyWith();
    await register(handle, ['storage.get_document']);
    const response = await handle(
      request('GET', '/api/storage/documents/d1', { token })
    );

    await expectRefused(response, 401, 'unauthorized');
    expect(permissionQuestions).toEqual([]);
    expect(logs[0]).toMatchObject({ run: null, outcome: 'unauthorized' });
  });

  test('a token without the Bearer scheme gets 401', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);
    const response = await handle(
      request('GET', '/api/storage/documents/d1', {
        headers: { authorization: `Basic ${runToken}` },
      })
    );

    await expectRefused(response, 401, 'unauthorized');
  });

  test.each([
    ['GET', '/api/storage/documents/search/recent/x'],
    ['PUT', '/api/storage/documents/d1'],
    ['DELETE', '/api/storage/documents/search'],
    ['GET', '/api/__proto__/documents/d1'],
    ['GET', '/api/storage/__proto__'],
    ['GET', '/api/properties/properties/report'],
  ])(
    '%s %s is unknown_operation, before the run set or the endpoint',
    async (method, target) => {
      const { handle, logs } = proxyWith();
      const runToken = await register(handle, [...OPERATIONS.keys()]);
      const response = await handle(
        request(method, target, { token: runToken })
      );

      await expectRefused(response, 404, 'unknown_operation');
      expect(permissionQuestions).toEqual([]);
      expect(logs[0]).toMatchObject({ operation: null, decision: null });
    }
  );

  test('an operation outside the run is not_analyzed, and the endpoint is not asked', async () => {
    const { handle, logs } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);
    // storage.edit_document is allowed by the rules, but not in this run.
    const response = await handle(
      request('POST', '/api/storage/documents/d1/edit', {
        token: runToken,
        body: '{}',
      })
    );

    await expectRefused(response, 403, 'not_analyzed');
    expect(permissionQuestions).toEqual([]);
    expect(logs[0]).toMatchObject({
      operation: 'storage.edit_document',
      decision: null,
      outcome: 'not_analyzed',
    });
  });

  test('a run for search_documents cannot reach get_document by spelling search differently', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.search_documents']);

    for (const target of [
      '/api/storage/documents/%73earch',
      '/api/storage/documents/search/',
      '/api/storage/documents/search;x',
    ]) {
      const response = await handle(
        request('GET', target, { token: runToken })
      );
      expect(response.status).toBe(400);
      expect(response.headers.get('x-macro-proxy')).toBe('refused');
    }
    // And the run for get_document can't reach search_documents with a
    // differently cased literal.
    const other = await register(handle, ['storage.get_document']);
    const response = await handle(
      request('GET', '/api/storage/documents/Search', { token: other })
    );
    expect(response.status).toBe(200);
    expect(forwarded().map((request) => request.target)).toEqual([
      '/dss/documents/Search',
    ]);
  });

  test('a blocked operation is 403 blocked', async () => {
    const { handle, logs } = proxyWith();
    const runToken = await register(handle, ['email.send_message']);
    const response = await handle(
      request('POST', '/api/email/email/messages/m1/send', {
        token: runToken,
        body: '{}',
      })
    );

    await expectRefused(response, 403, 'blocked');
    expect(logs[0]).toMatchObject({
      operation: 'email.send_message',
      decision: 'block',
      outcome: 'blocked',
    });
  });

  test('a destroy blocked by @destroy is 403 blocked', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.delete_document']);
    const response = await handle(
      request('DELETE', '/api/storage/documents/d1', { token: runToken })
    );

    await expectRefused(response, 403, 'blocked');
  });

  test.each([
    ['an error status', () => new Response('nope', { status: 500 })],
    ['a non-JSON reply', () => new Response('not json')],
    ['no decisions', () => Response.json({})],
    ['no answer for the operation', () => Response.json({ decisions: {} })],
    [
      'an answer that is neither allow nor block',
      () => Response.json({ decisions: { 'storage.get_document': 'yes' } }),
    ],
    [
      'an allow hidden behind __proto__',
      () =>
        new Response(
          '{"decisions":{"__proto__":{"storage.get_document":"allow"}}}'
        ),
    ],
    [
      'a redirect',
      () =>
        new Response(null, {
          status: 307,
          headers: { location: permissions.url.href },
        }),
    ],
  ])(
    'a permission endpoint with %s fails closed with 502',
    async (_label, reply) => {
      const broken = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch: reply,
      });
      try {
        const { handle, logs } = proxyWith({ permissionsUrl: broken.url.href });
        const runToken = await register(handle, ['storage.get_document']);
        const response = await handle(
          request('GET', '/api/storage/documents/d1', { token: runToken })
        );

        await expectRefused(response, 502, 'permission_unavailable');
        expect(logs[0]?.decision).toBe('unavailable');
      } finally {
        await broken.stop(true);
      }
    }
  );

  test('an unreachable permission endpoint fails closed with 502', async () => {
    const { handle } = proxyWith({ permissionsUrl: 'http://127.0.0.1:1' });
    const runToken = await register(handle, ['storage.get_document']);
    const response = await handle(
      request('GET', '/api/storage/documents/d1', { token: runToken })
    );

    await expectRefused(response, 502, 'permission_unavailable');
  });

  test.each(['x-http-method-override', 'x-http-method', 'x-method-override'])(
    'a %s header is refused',
    async (header) => {
      const { handle } = proxyWith();
      const runToken = await register(handle, ['storage.get_document']);
      const response = await handle(
        request('GET', '/api/storage/documents/d1', {
          token: runToken,
          headers: { [header]: 'DELETE' },
        })
      );

      await expectRefused(response, 400, 'invalid');
      expect(permissionQuestions).toEqual([]);
    }
  );

  test('a GET with a body is refused', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);
    const response = await handle(
      request('GET', '/api/storage/documents/d1', {
        token: runToken,
        body: '{"x":1}',
      })
    );

    await expectRefused(response, 400, 'invalid');
  });

  test.each([
    '/api/storage/documents/d1/../search',
    '/api/storage/documents/a%2Fb',
    '/api/storage/documents/d1/',
    '/api/storage//documents/d1',
  ])('the target %s is refused as invalid_target', async (target) => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['storage.get_document']);
    const response = await handle(request('GET', target, { token: runToken }));

    await expectRefused(response, 400, 'invalid_target');
  });

  test.each([
    'http://evil.test/api/storage/documents/d1',
    '//evil.test/api/storage/documents/d1',
    '*',
  ])(
    'the absolute-form or other target %s is 404 not_found',
    async (target) => {
      const { handle } = proxyWith();
      const runToken = await register(handle, ['storage.get_document']);
      const response = await handle(
        request('GET', target, { token: runToken })
      );

      await expectRefused(response, 404, 'not_found');
    }
  );

  test('a service without an upstream is 502 after the checks', async () => {
    const { handle } = proxyWith();
    const runToken = await register(handle, ['static-files.get_file']);
    const response = await handle(
      request('GET', '/api/static-files/api/file/f1', { token: runToken })
    );

    await expectRefused(response, 502, 'upstream_unavailable');
  });

  test('other routes are 404 not_found', async () => {
    const { handle } = proxyWith();
    for (const target of ['/v1/call', '/api', '/', '/v1/executions/']) {
      const response = await handle(
        request('POST', target, { token: EXECUTION_TOKEN, body: '{}' })
      );
      await expectRefused(response, 404, 'not_found');
    }
  });
});

describe('an upstream that does not answer', () => {
  test('is 502 upstream_unavailable', async () => {
    const dead = await startFakeUpstream(() => OK_RESPONSE);
    await dead.stop();
    const handle = proxyHandler({
      executionToken: EXECUTION_TOKEN,
      permissionsUrl: permissions.url.href,
      operations: OPERATIONS,
      upstreams: parseUpstreams(
        [`storage=${dead.url}`],
        {},
        new Set(['storage'])
      ),
      credential: CREDENTIAL,
      log: () => {},
    });
    const runToken = await register(handle, ['storage.get_document']);
    const response = await handle(
      request('GET', '/api/storage/documents/d1', { token: runToken })
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('x-macro-proxy')).toBe('refused');
  });
});

const socketProxy = proxyWith();
const listening = await serve(socketProxy.handle, {
  port: 0,
  hostname: '127.0.0.1',
  maxBodyBytes: 1024,
});

describe('over a real socket', () => {
  const { handle } = socketProxy;
  const port = Number(new URL(listening.url).port);

  afterAll(() => {
    listening.server.closeAllConnections();
    listening.server.close();
  });

  /**
   * Send raw HTTP/1.1 bytes and read one response: status line, headers and
   * a Content-Length body. Status 0 means the server closed the connection
   * without answering.
   */
  function raw(text: string) {
    return new Promise<{ status: number; head: string; body: string }>(
      (resolve) => {
        const socket = connect(port, '127.0.0.1', () => socket.write(text));
        let data = '';

        function parse() {
          const split = data.indexOf('\r\n\r\n');
          if (split < 0) return undefined;
          const head = data.slice(0, split).toLowerCase();
          const body = data.slice(split + 4);
          const length = Number(/content-length: (\d+)/.exec(head)?.[1] ?? 0);
          if (Buffer.byteLength(body) < length) return undefined;
          return { status: Number(head.split(' ')[1]), head, body };
        }

        socket.on('data', (chunk) => {
          data += chunk.toString();
          const response = parse();
          if (response) {
            socket.destroy();
            resolve(response);
          }
        });
        socket.on('error', () => {});
        socket.on('close', () =>
          resolve(parse() ?? { status: 0, head: '', body: '' })
        );
      }
    );
  }

  const get = (target: string, headers: string) =>
    raw(`GET ${target} HTTP/1.1\r\n${headers}Connection: close\r\n\r\n`);

  test('a plain request is forwarded', async () => {
    const runToken = await register(handle, ['storage.get_document']);
    const response = await get(
      '/api/storage/documents/d1',
      `Host: proxy\r\nAuthorization: Bearer ${runToken}\r\n`
    );

    expect(response.status).toBe(200);
    expect(response.body).toBe('{"id":"d1"}');
    expect(forwarded().map((request) => request.target)).toEqual([
      '/dss/documents/d1',
    ]);
  });

  test.each([
    ['/api/storage/documents/../documents/search', 400],
    ['/api/storage/documents/%2e%2e/documents/search', 400],
    ['/api/storage/documents/d1\\..\\search', 400],
    ['/api/storage/./documents/d1', 400],
    ['http://evil.test/api/storage/documents/d1', 404],
    ['http://proxy/api/storage/documents/d1', 404],
  ])(
    'the raw target %s is refused before Bun or a URL parser can resolve it',
    async (target, status) => {
      const runToken = await register(handle, [...OPERATIONS.keys()]);
      const response = await get(
        target,
        `Host: proxy\r\nAuthorization: Bearer ${runToken}\r\n`
      );

      expect(response.status).toBe(status);
      expect(response.head).toContain('x-macro-proxy: refused');
      expect(forwarded()).toEqual([]);
    }
  );

  test('the Host header never picks the upstream', async () => {
    const runToken = await register(handle, ['storage.get_document']);
    const response = await get(
      '/api/storage/documents/d1',
      `Host: evil.test\r\nAuthorization: Bearer ${runToken}\r\n`
    );

    expect(response.status).toBe(200);
    expect(forwarded()[0]?.headers.host).toBe(new URL(upstream.url).host);
  });

  test('two authorization headers match no run', async () => {
    const runToken = await register(handle, ['storage.get_document']);
    const response = await get(
      '/api/storage/documents/d1',
      `Host: proxy\r\nAuthorization: Bearer ${runToken}\r\nAuthorization: Bearer ${runToken}\r\n`
    );

    expect(response.status).toBe(401);
    expect(forwarded()).toEqual([]);
  });

  test.each(['get', 'Get', 'GETS'])(
    'the method %s is never forwarded',
    async (method) => {
      const runToken = await register(handle, ['storage.get_document']);
      const response = await raw(
        `${method} /api/storage/documents/d1 HTTP/1.1\r\nHost: proxy\r\nAuthorization: Bearer ${runToken}\r\nConnection: close\r\n\r\n`
      );

      // Bun's parser drops the connection (status 0) or answers 400.
      expect([0, 400]).toContain(response.status);
      expect(forwarded()).toEqual([]);
    }
  );

  test('a body over the limit is 413', async () => {
    const runToken = await register(handle, ['storage.edit_document']);
    const body = 'x'.repeat(2048);
    const response = await raw(
      `POST /api/storage/documents/d1/edit HTTP/1.1\r\nHost: proxy\r\nAuthorization: Bearer ${runToken}\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`
    );

    expect(response.status).toBe(413);
    expect(response.head).toContain('x-macro-proxy: refused');
    expect(forwarded()).toEqual([]);
  });
});
