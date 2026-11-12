/**
 * The agent's relay to Macro, for its scripts. A script runs in a process of
 * its own that never holds the agent's Macro key: its Macro client points
 * every service at this relay, on loopback, with a capability made fresh for
 * each run of the agent, and the relay makes the call with the real key. It
 * forwards plain HTTP API calls to the services it has an address for, and
 * one kind of websocket: a call's speech (`socketRoutes`). Nothing else, no
 * other host, and nothing about a call or a frame is logged.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Hosts } from './addresses.ts';
import { anthropicRoute } from './children.ts';

/** The header a user API key travels in, both from the script and on to Macro. */
export const keyHeader = 'x-macro-user-api-key';

/** Headers that say who is calling: the script's are dropped, and only the agent's key goes on. */
const dropped = new Set([
  keyHeader,
  'authorization',
  'cookie',
  'host',
  'connection',
  'upgrade',
  'keep-alive',
  'proxy-authorization',
  'transfer-encoding',
  'content-length',
]);
const botHeaders = 'x-macro-bot-';

/** Compares two secrets in time that doesn't depend on where they differ. */
export const constantTimeEqual = (given: string, expected: string): boolean =>
  timingSafeEqual(
    createHash('sha256').update(given).digest(),
    createHash('sha256').update(expected).digest()
  );

const refuse = (status: number, text: string): Response =>
  new Response(`${text}\n`, { status });

const isUpgrade = (request: Request): boolean =>
  request.headers.has('upgrade') ||
  (request.headers.get('connection') ?? '').toLowerCase().includes('upgrade');

/** The real URL for a relayed path, or undefined if it names no service or leaves its own. */
const target = (
  targets: Hosts,
  url: URL
): { readonly service: string; readonly url: string } | undefined => {
  const [, first = '', ...rest] = url.pathname.split('/');
  const host = Object.entries(targets).find(([name]) => name === first);
  if (host === undefined) return undefined;
  const [service, base] = host;
  const path = rest.join('/');
  // An encoded or dotted segment could climb out of the service's own path.
  if (
    rest.some(
      (segment) => /^(\.|%2e)+$/i.test(segment) || /%2f|%5c/i.test(segment)
    )
  )
    return undefined;
  if (base === undefined) return undefined;
  return {
    service,
    url: `${base.replace(/\/+$/, '')}/${path}${url.search}`,
  };
};

const bearer = (request: Request): string =>
  /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? '';

/** A Claude Code request on to the Anthropic gateway, with the gateway's real token. */
const forwardAnthropic = async ({
  request,
  url,
  capability,
  anthropic,
  send,
  equal,
}: {
  readonly request: Request;
  readonly url: URL;
  readonly capability: string;
  readonly anthropic:
    | { readonly url: string; readonly token: string }
    | undefined;
  readonly send: (request: Request) => Promise<Response>;
  readonly equal: (given: string, expected: string) => boolean;
}): Promise<Response> => {
  if (!equal(bearer(request), capability))
    return refuse(401, 'the relay needs its capability');
  if (anthropic === undefined)
    return refuse(
      404,
      'the relay has no Anthropic gateway (not Macro-credits mode)'
    );
  const rest = url.pathname.split('/').slice(2);
  if (
    rest.some(
      (segment) => /^(\.|%2e)+$/i.test(segment) || /%2f|%5c/i.test(segment)
    )
  )
    return refuse(404, 'the relay has no address for that path');
  const headers = new Headers();
  for (const [name, value] of request.headers)
    if (!dropped.has(name) && name !== 'x-api-key') headers.set(name, value);
  headers.set('authorization', `Bearer ${anthropic.token}`);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  try {
    return await send(
      new Request(
        `${anthropic.url.replace(/\/+$/, '')}/${rest.join('/')}${url.search}`,
        {
          method: request.method,
          headers,
          body: hasBody ? await request.arrayBuffer() : undefined,
          redirect: 'manual',
        }
      )
    );
  } catch {
    return refuse(502, "the relay couldn't reach the Anthropic gateway");
  }
};

export const relayHandler =
  ({
    targets,
    capability,
    apiKey,
    fetch: send,
    equal,
    anthropic,
  }: {
    /** Each service's real host. */
    readonly targets: Hosts;
    /** What a script must present as its key. */
    readonly capability: string;
    /** The agent's real Macro key. */
    readonly apiKey: string;
    readonly fetch: (request: Request) => Promise<Response>;
    readonly equal: (given: string, expected: string) => boolean;
    /** The Anthropic gateway and its token, in Macro-credits mode. */
    readonly anthropic?: { readonly url: string; readonly token: string };
  }) =>
  async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    // Claude Code presents its ANTHROPIC_AUTH_TOKEN, the capability, as a bearer token.
    if (url.pathname.split('/')[1] === anthropicRoute)
      return forwardAnthropic({
        request,
        url,
        capability,
        anthropic,
        send,
        equal,
      });
    if (!equal(request.headers.get(keyHeader) ?? '', capability))
      return refuse(401, 'the relay needs its capability');
    if (isUpgrade(request))
      return refuse(403, 'the relay forwards HTTP API calls only');
    const found = target(targets, new URL(request.url));
    if (found === undefined)
      return refuse(404, 'the relay has no address for that path');
    const headers = new Headers();
    for (const [name, value] of request.headers)
      if (!dropped.has(name) && !name.startsWith(botHeaders))
        headers.set(name, value);
    headers.set(keyHeader, apiKey);
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    try {
      return await send(
        new Request(found.url, {
          method: request.method,
          headers,
          body: hasBody ? await request.arrayBuffer() : undefined,
          redirect: 'manual',
        })
      );
    } catch {
      return refuse(502, `the relay couldn't reach ${found.service}`);
    }
  };

/**
 * The only websockets the relay carries: a call's speech, which the agent
 * harness's egress proxies to LiveKit Inference with the agent's key. On the
 * relay a socket is `/speech/stt` or `/speech/tts`; each takes one model,
 * which the relay sets itself.
 */
export const socketRoutes = [
  {
    path: 'speech/stt',
    upstream: 'brain/inference/stt',
    model: 'deepgram/nova-3',
  },
  {
    path: 'speech/tts',
    upstream: 'brain/inference/tts',
    model: 'deepgram/aura-2',
  },
] as const;

/** Where a relayed socket goes, and the headers it is opened with. */
export type SocketTarget = {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
};

/** Trace context is the one thing of the caller's that goes on with a socket. */
const traceHeaders = ['traceparent', 'tracestate'];

const asSocket = (url: string): string =>
  url.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');

/**
 * Whether a websocket upgrade may be relayed, and where: the capability
 * first, as for HTTP; then a GET to exactly one of `socketRoutes`, which
 * goes to the egress. Upstream it carries the agent's key
 * as a bearer token, which is how the speech gateway authenticates, and the
 * caller's trace context; nothing else of the caller's, and none of its query.
 */
export const socketTarget =
  ({
    egress,
    capability,
    apiKey,
    equal,
  }: {
    /** The agent harness's egress listener. */
    readonly egress: string;
    readonly capability: string;
    readonly apiKey: string;
    readonly equal: (given: string, expected: string) => boolean;
  }) =>
  (request: Request): SocketTarget | Response => {
    if (!equal(request.headers.get(keyHeader) ?? '', capability))
      return refuse(401, 'the relay needs its capability');
    if (request.method !== 'GET')
      return refuse(405, 'a relayed socket opens with GET');
    const { pathname } = new URL(request.url);
    const route = socketRoutes.find(({ path }) => pathname === `/${path}`);
    if (route === undefined)
      return refuse(403, "the relay carries only a call's speech sockets");
    const headers: Record<string, string> = {
      authorization: `Bearer ${apiKey}`,
    };
    for (const name of traceHeaders) {
      const value = request.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    const url = new URL(`${egress.replace(/\/+$/, '')}/${route.upstream}`);
    url.searchParams.set('model', route.model);
    return { url: asSocket(url.href), headers };
  };

/** What the relay keeps per relayed socket: where it goes, and its upstream once open. */
type Socket = SocketTarget & {
  upstream?: WebSocket;
  /** What the caller sent before upstream opened. */
  readonly early: (string | Buffer)[];
};

export type Relay = {
  /** Its loopback origin, e.g. `http://127.0.0.1:41234`. A service is at `${url}/${service}`. */
  readonly url: string;
  /** The capability a script presents as its key. */
  readonly token: string;
  readonly stop: () => void;
};

/**
 * How the child hears that upstream refused or broke the socket: never as a
 * normal close, which a call would take as the end of speech.
 */
const upstreamFailed = 1011;
const upstreamFailedReason = 'speech upstream failed';

/** Codes an endpoint may send itself; anything else (1006: no close frame) means upstream failed. */
const sendable = (code: number): boolean =>
  code === 1000 || (code >= 3000 && code <= 4999);

const capabilityBytes = 32;
const loopback = '127.0.0.1';

/** Starts the relay on a random loopback port, with a fresh capability. */
export const startRelay = ({
  targets,
  egress,
  apiKey,
  anthropic,
}: {
  readonly targets: Hosts;
  /** The agent harness's egress listener, where a call's speech goes. */
  readonly egress: string;
  readonly apiKey: string;
  readonly anthropic?: { readonly url: string; readonly token: string };
}): Relay => {
  const token = randomBytes(capabilityBytes).toString('hex');
  const http = relayHandler({
    targets,
    capability: token,
    apiKey,
    anthropic,
    fetch: (request) => fetch(request),
    equal: constantTimeEqual,
  });
  const socket = socketTarget({
    egress,
    capability: token,
    apiKey,
    equal: constantTimeEqual,
  });
  const server = Bun.serve<Socket>({
    hostname: loopback,
    port: 0,
    fetch: (request, server) => {
      if (!isUpgrade(request)) return http(request);
      const target = socket(request);
      if (target instanceof Response) return target;
      return server.upgrade(request, { data: { ...target, early: [] } })
        ? undefined
        : refuse(400, 'not a websocket upgrade');
    },
    websocket: {
      open: (client) => {
        const upstream = new WebSocket(client.data.url, {
          headers: client.data.headers,
        });
        upstream.binaryType = 'arraybuffer';
        client.data.upstream = upstream;
        upstream.addEventListener('open', () => {
          for (const message of client.data.early.splice(0))
            upstream.send(message);
        });
        upstream.addEventListener('message', ({ data }) => {
          if (typeof data === 'string' || data instanceof ArrayBuffer)
            client.send(data);
        });
        upstream.addEventListener('close', ({ code, reason }) =>
          sendable(code)
            ? client.close(code, reason)
            : client.close(upstreamFailed, upstreamFailedReason)
        );
        upstream.addEventListener('error', () =>
          client.close(upstreamFailed, upstreamFailedReason)
        );
      },
      message: (client, message) => {
        const upstream = client.data.upstream;
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
        else client.data.early.push(message);
      },
      close: (client) => {
        client.data.upstream?.close();
      },
    },
  });
  return {
    url: `http://${loopback}:${server.port}`,
    token,
    stop: () => {
      server.stop(true);
    },
  };
};
