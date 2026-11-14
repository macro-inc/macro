/**
 * The SDK HTTP proxy (contract D3). Whoever starts a program registers the
 * operations it may call with `POST /v1/executions` (execution token) and gets a run
 * token; the program only ever has that run token. A program's
 * `<METHOD> /api/<service><path>?<query>` is matched to one OpenAPI
 * operation, refused unless that operation is in its run's set and the
 * permission endpoint allows it, then forwarded to the service with the Macro
 * credential, which only the proxy holds.
 *
 *   MACRO_SDK_EXECUTION_TOKEN=<execution token> MACRO_API_KEY=<credential> \
 *   bun run src/proxy.ts --operations ../spec/operations.json \
 *     --permissions-url http://127.0.0.1:8788 \
 *     --upstream storage=http://localhost:8086 --port 8787
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { type ErrorCode, errorResponse, required } from './http';
import { type Operation, operationsByName, readOperations } from './operations';
import { parseTarget, Router } from './router';
import {
  credentialHeader,
  parseUpstreams,
  readUpstreamsFile,
  type Upstream,
} from './upstreams';

/** One line per `/api` request: never a path, query, body or credential. */
export type CallLog = {
  event: 'sdk_call';
  run: string | null;
  method: string;
  operation: string | null;
  decision: 'allow' | 'block' | 'unavailable' | null;
  /** `forwarded`, or the code of the proxy's own refusal. */
  outcome: 'forwarded' | ErrorCode;
  status: number;
  durationMs: number;
};

/**
 * A request as received, with its raw request target: Bun's `Request.url`
 * has already resolved dot segments and backslashes, which would hide them
 * from the checks.
 */
export type ProxyRequest = {
  method: string;
  target: string;
  headers: Headers;
  body: Uint8Array<ArrayBuffer>;
};

export type ProxyOptions = {
  executionToken: string;
  permissionsUrl: string;
  operations: ReadonlyMap<string, Operation>;
  upstreams: ReadonlyMap<string, Upstream>;
  /** The Macro credential added to every forwarded request. */
  credential: string;
  upstreamTimeoutMs?: number;
  log?: (line: CallLog) => void;
};

const ExecutionRequest = z.object({ operations: z.array(z.string()) });

const DecideResponse = z.object({
  decisions: z.record(z.string(), z.unknown()),
});

/** Headers some frameworks read as the real method; never let one through. */
const METHOD_OVERRIDE_HEADERS = [
  'x-http-method-override',
  'x-http-method',
  'x-method-override',
];

/**
 * The request headers forwarded for every operation besides the credential:
 * the body's type, the accepted type, and W3C trace context so the service's
 * spans join the caller's trace. An operation's declared header parameters
 * are forwarded for that operation only.
 */
const FORWARDED_HEADERS = [
  'content-type',
  'accept',
  'traceparent',
  'tracestate',
];

/** Statuses whose response must not have a body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

const digest = (value: string) => createHash('sha256').update(value).digest();

function bearer(headers: Headers): string | null {
  const header = headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Compares digests so neither length nor content leaks through timing. */
function tokenMatches(token: string | null, expected: string): boolean {
  if (token === null) return false;
  return timingSafeEqual(digest(token), digest(expected));
}

function parseJson(body: Uint8Array): unknown {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    return parsed;
  } catch {
    return undefined;
  }
}

/** A registered run: its analyzed operations, keyed by the run token's digest. */
type Run = { id: string; operations: ReadonlySet<string> };

/**
 * Ask the permission endpoint about one operation. Anything but an explicit
 * allow or block (unreachable, an error status, a malformed reply) is
 * `unavailable`, and the request fails closed.
 */
async function decide(
  permissionsUrl: string,
  operation: string,
  traceparent: string | null
) {
  try {
    const response = await fetch(
      `${permissionsUrl.replace(/\/$/, '')}/v1/decide`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(traceparent === null ? {} : { traceparent }),
        },
        body: JSON.stringify({ methods: [operation] }),
        redirect: 'manual',
      }
    );
    if (!response.ok) return 'unavailable';

    const body: unknown = await response.json();
    if (!DecideResponse.safeParse(body).success) return 'unavailable';

    // Read the reply as parsed JSON, and only its own keys: an inherited name
    // (__proto__, constructor, toString) must not pass for an answer.
    const { decisions } = body as { decisions: Record<string, unknown> };
    if (!Object.hasOwn(decisions, operation)) return 'unavailable';
    const decision = decisions[operation];
    return decision === 'allow' || decision === 'block'
      ? decision
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function proxyHandler(options: ProxyOptions) {
  const log = options.log ?? ((line) => console.log(JSON.stringify(line)));
  const runs = new Map<string, Run>();
  const router = new Router(options.operations.values(), (service) =>
    options.upstreams.get(service)
  );
  const credential = credentialHeader(options.credential);
  const timeoutMs = options.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS;

  /** POST /v1/executions: register a run's operations, with the execution token. */
  function register(request: ProxyRequest): Response {
    if (!tokenMatches(bearer(request.headers), options.executionToken))
      return errorResponse(
        401,
        'unauthorized',
        'missing or wrong execution token'
      );

    const parsed = ExecutionRequest.safeParse(parseJson(request.body));
    if (!parsed.success)
      return errorResponse(
        400,
        'invalid',
        'body must be {"operations": [string]}'
      );

    // A name the table doesn't have means the registering side and the proxy
    // read different tables; refuse rather than register something unmatchable.
    const unknown = parsed.data.operations.filter(
      (name) => !options.operations.has(name)
    );
    if (unknown.length > 0)
      return errorResponse(
        400,
        'invalid',
        `unknown operations: ${unknown.join(', ')}`
      );

    const token = randomBytes(32).toString('base64url');
    const id = randomBytes(6).toString('hex');
    runs.set(digest(token).toString('hex'), {
      id,
      operations: new Set(parsed.data.operations),
    });
    return Response.json({ token });
  }

  /** Send an allowed request to its service and relay the answer as is. */
  async function forward(
    request: ProxyRequest,
    upstream: Upstream,
    path: string,
    query: string,
    operation: Operation
  ): Promise<Response> {
    const headers = new Headers();
    // The operation's declared header parameters (the table refuses
    // credential, cookie, routing and hop-by-hop names), then the credential,
    // which nothing the program sends can replace.
    for (const name of [...FORWARDED_HEADERS, ...operation.headers]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    headers.set(...credential);

    const response = await fetch(`${upstream.base}${path}${query}`, {
      method: request.method,
      headers,
      body: request.body.length > 0 ? request.body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = await response.arrayBuffer();
    const relayed = new Headers();
    const contentType = response.headers.get('content-type');
    if (contentType !== null) relayed.set('content-type', contentType);
    return new Response(NULL_BODY_STATUSES.has(response.status) ? null : body, {
      status: response.status,
      headers: relayed,
    });
  }

  async function call(request: ProxyRequest): Promise<Response> {
    const started = performance.now();
    let run: Run | undefined;
    let operation: Operation | undefined;
    let decision: CallLog['decision'] = null;

    function finish(outcome: CallLog['outcome'], response: Response) {
      log({
        event: 'sdk_call',
        run: run?.id ?? null,
        method: request.method,
        operation: operation?.name ?? null,
        decision,
        outcome,
        status: response.status,
        durationMs: Math.round(performance.now() - started),
      });
      return response;
    }

    function fail(status: number, code: ErrorCode, message: string) {
      return finish(code, errorResponse(status, code, message));
    }

    // Only a run token reaches /api. The execution token is only for
    // registering runs; a program that has it still cannot skip registration.
    const token = bearer(request.headers);
    run = token === null ? undefined : runs.get(digest(token).toString('hex'));
    if (!run) return fail(401, 'unauthorized', 'missing or unknown run token');

    const overrides = METHOD_OVERRIDE_HEADERS.filter((name) =>
      request.headers.has(name)
    );
    if (overrides.length > 0)
      return fail(
        400,
        'invalid',
        `method override headers are not allowed: ${overrides.join(', ')}`
      );
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      request.body.length > 0
    )
      return fail(400, 'invalid', `${request.method} must not have a body`);

    const parsed = parseTarget(request.target);
    if (!parsed.ok)
      return fail(400, 'invalid_target', `refused target: ${parsed.reason}`);
    const { target } = parsed;

    operation = router.match(target, request.method);
    if (!operation)
      return fail(
        404,
        'unknown_operation',
        `no operation matches ${request.method} in service ${target.service}`
      );

    if (!run.operations.has(operation.name))
      return fail(
        403,
        'not_analyzed',
        `${operation.name} is not among the operations analyzed for this run`
      );

    decision = await decide(
      options.permissionsUrl,
      operation.name,
      request.headers.get('traceparent')
    );
    if (decision === 'unavailable')
      return fail(502, 'permission_unavailable', 'the permission check failed');
    if (decision === 'block')
      return fail(
        403,
        'blocked',
        `${operation.name} is blocked by the permission policy`
      );

    const upstream = options.upstreams.get(operation.service);
    if (!upstream)
      return fail(
        502,
        'upstream_unavailable',
        `no upstream is configured for ${operation.service}`
      );

    try {
      return finish(
        'forwarded',
        await forward(request, upstream, target.path, target.query, operation)
      );
    } catch {
      return fail(
        502,
        'upstream_unavailable',
        `${operation.service} did not answer`
      );
    }
  }

  return async function handle(request: ProxyRequest): Promise<Response> {
    if (request.target === '/v1/executions') {
      if (request.method !== 'POST')
        return errorResponse(405, 'invalid', 'use POST');
      return register(request);
    }
    if (request.target.startsWith('/api/')) return call(request);
    return errorResponse(404, 'not_found', 'no such route');
  };
}

export type ServeOptions = {
  port: number;
  hostname: string;
  maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;

async function readBody(
  message: IncomingMessage,
  limit: number
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;

  // Keep reading past the limit, dropping the bytes: leaving the loop early
  // destroys the socket before the 413 can be sent.
  for await (const chunk of message) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size <= limit) chunks.push(buffer);
  }
  return size > limit ? undefined : Buffer.concat(chunks);
}

/**
 * Serve a handler over node:http, which hands over the raw request target
 * (`Bun.serve` would normalize it first). Repeated headers are joined, so two
 * `authorization` headers match no token.
 */
export async function serve(
  handle: (request: ProxyRequest) => Promise<Response>,
  options: ServeOptions
): Promise<{ server: Server; url: string }> {
  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  const server = createServer(async (message, reply) => {
    const body = await readBody(message, limit);
    const headers = new Headers();
    for (let index = 0; index + 1 < message.rawHeaders.length; index += 2)
      headers.append(
        message.rawHeaders[index] ?? '',
        message.rawHeaders[index + 1] ?? ''
      );

    const response =
      body === undefined
        ? errorResponse(413, 'payload_too_large', 'request body too large')
        : await handle({
            method: message.method ?? '',
            target: message.url ?? '',
            headers,
            body,
          });

    reply.statusCode = response.status;
    for (const [name, value] of response.headers) reply.setHeader(name, value);
    reply.end(Buffer.from(await response.arrayBuffer()));
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port, options.hostname, resolve)
  );
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://${options.hostname}:${port}` };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      operations: { type: 'string' },
      upstream: { type: 'string', multiple: true, default: [] },
      upstreams: { type: 'string' },
      'permissions-url': { type: 'string' },
      token: { type: 'string' },
      'upstream-timeout-ms': { type: 'string' },
      port: { type: 'string', default: '8787' },
      hostname: { type: 'string', default: '127.0.0.1' },
    },
  });

  const operations = operationsByName(
    await readOperations(required(values.operations, 'operations'))
  );
  const services = new Set(
    [...operations.values()].map((operation) => operation.service)
  );
  const upstreams = parseUpstreams(
    values.upstream,
    values.upstreams ? await readUpstreamsFile(values.upstreams) : {},
    services
  );

  const credential = Bun.env.MACRO_API_KEY;
  if (!credential) throw new Error('set MACRO_API_KEY');

  const { url } = await serve(
    proxyHandler({
      executionToken: required(
        values.token,
        'token',
        'MACRO_SDK_EXECUTION_TOKEN'
      ),
      permissionsUrl: required(
        values['permissions-url'],
        'permissions-url',
        'MACRO_SDK_PERMISSIONS_URL'
      ),
      operations,
      upstreams,
      credential,
      upstreamTimeoutMs: values['upstream-timeout-ms']
        ? Number(values['upstream-timeout-ms'])
        : undefined,
    }),
    { port: Number(values.port), hostname: values.hostname }
  );
  console.log(
    JSON.stringify({
      event: 'proxy.listening',
      url,
      upstreams: [...upstreams.keys()],
    })
  );
}
