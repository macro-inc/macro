/**
 * The agent's relay to Macro, for its scripts. A script runs in a process of
 * its own that never holds the agent's Macro key: its Macro client points
 * every service at this relay, on loopback, with a capability made fresh for
 * each run of the agent, and the relay makes the call with the real key. It
 * forwards plain HTTP API calls to the services it has an address for, and
 * nothing else: no websocket, no other host, and nothing about a call is
 * logged.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Hosts } from './addresses.ts';

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

export const relayHandler =
  ({
    targets,
    capability,
    apiKey,
    fetch: send,
    equal,
  }: {
    /** Each service's real host. */
    readonly targets: Hosts;
    /** What a script must present as its key. */
    readonly capability: string;
    /** The agent's real Macro key. */
    readonly apiKey: string;
    readonly fetch: (request: Request) => Promise<Response>;
    readonly equal: (given: string, expected: string) => boolean;
  }) =>
  async (request: Request): Promise<Response> => {
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

export type Relay = {
  /** Its loopback origin, e.g. `http://127.0.0.1:41234`. A service is at `${url}/${service}`. */
  readonly url: string;
  /** The capability a script presents as its key. */
  readonly token: string;
  readonly stop: () => void;
};

const capabilityBytes = 32;
const loopback = '127.0.0.1';

/** Starts the relay on a random loopback port, with a fresh capability. */
export const startRelay = ({
  targets,
  apiKey,
}: {
  readonly targets: Hosts;
  readonly apiKey: string;
}): Relay => {
  const token = randomBytes(capabilityBytes).toString('hex');
  const server = Bun.serve({
    hostname: loopback,
    port: 0,
    fetch: relayHandler({
      targets,
      capability: token,
      apiKey,
      fetch: (request) => fetch(request),
      equal: constantTimeEqual,
    }),
  });
  return {
    url: `http://${loopback}:${server.port}`,
    token,
    stop: () => {
      server.stop(true);
    },
  };
};
