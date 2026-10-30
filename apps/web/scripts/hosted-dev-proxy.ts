import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import {
  Agent as HttpAgent,
  type IncomingHttpHeaders,
  type IncomingMessage,
  request as httpRequest,
  type ServerResponse,
} from 'node:http';
import type { Http2ServerRequest } from 'node:http2';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import type { LookupFunction, Socket } from 'node:net';
import type { Plugin } from 'vite';
import {
  DEVELOPMENT_PROXY_PREFIX,
  DEVELOPMENT_PROXY_TARGETS,
} from '../src/lib/core/constant/developmentProxy';

type ProxyRequest = IncomingMessage | Http2ServerRequest;

/** Connection-level and HTTP/2 pseudo headers never cross the proxy. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'http2-settings',
  'host',
]);

const DNS_TTL_MS = 60_000;

/**
 * Resolves each upstream host once a minute. Every proxied request otherwise
 * does its own lookup, and bursts of them fail with EAI_AGAIN on dev boxes.
 */
function cachedLookup(): LookupFunction {
  const cache = new Map<string, { at: number; addresses: LookupAddress[] }>();
  return (hostname, options, callback) => {
    const respond = (addresses: LookupAddress[]) => {
      if (options.all) return callback(null, addresses);
      const [first] = addresses;
      if (!first) return callback(new Error(`No address for ${hostname}`), '');
      callback(null, first.address, first.family);
    };
    const cached = cache.get(hostname);
    if (cached && Date.now() - cached.at < DNS_TTL_MS) {
      respond(cached.addresses);
      return;
    }
    dnsLookup(hostname, { all: true }, (error, addresses) => {
      if (error) {
        // A stale answer beats failing the request on a transient DNS error.
        if (cached) respond(cached.addresses);
        else callback(error, '');
        return;
      }
      cache.set(hostname, { at: Date.now(), addresses });
      respond(addresses);
    });
  };
}

function hostOf(req: ProxyRequest) {
  return req.headers.host ?? req.headers[':authority'];
}

function forwardedHeaders(headers: IncomingHttpHeaders, host: string) {
  const forwarded: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.startsWith(':') || HOP_BY_HOP.has(name) || name === 'origin')
      continue;
    forwarded[name] = value;
  }
  // isCrossOrigin already vetted the browser's origin. Hosted services
  // allowlist origins (sync-service 403s any https:// dev host), so forward
  // like a server-side client.
  forwarded.host = host;
  return forwarded;
}

/** Hosted auth cookies have Domain=macro.com; scope them to the dev host. */
function withoutCookieDomain(cookies: string[] | undefined) {
  return cookies?.map((cookie) => cookie.replace(/;\s*Domain=[^;]*/i, ''));
}

/** Keep dev credentials on this hostname while forwarding to fixed hosted APIs. */
export function hostedDevProxy(
  env: Record<string, string | undefined> = process.env,
  targets: Record<string, string> = DEVELOPMENT_PROXY_TARGETS
): Plugin {
  let protocol = 'https';
  const isCrossOrigin = (req: ProxyRequest) =>
    req.headers['sec-fetch-site'] === 'cross-site' ||
    (req.headers.origin !== undefined &&
      req.headers.origin !== `${protocol}://${hostOf(req)}`);

  const lookup = cachedLookup();
  const agents = {
    'http:': new HttpAgent({ keepAlive: true, lookup }),
    'https:': new HttpsAgent({ keepAlive: true, lookup }),
  };

  /** The upstream URL for a proxied path, or undefined when it is not one. */
  const resolve = (url: string | undefined) => {
    if (!url?.startsWith(`${DEVELOPMENT_PROXY_PREFIX}/`)) return;
    for (const [name, target] of Object.entries(targets)) {
      const prefix = `${DEVELOPMENT_PROXY_PREFIX}/${name}`;
      if (!url.startsWith(prefix)) continue;
      const rest = url.slice(prefix.length);
      if (rest !== '' && !/^[/?]/.test(rest)) continue;
      return new URL(rest.startsWith('/') ? rest : `/${rest}`, target);
    }
  };

  const send = (upstream: URL, headers: IncomingHttpHeaders, method = 'GET') =>
    (upstream.protocol === 'https:' ? httpsRequest : httpRequest)(upstream, {
      method,
      headers,
      agent: agents[upstream.protocol as 'http:' | 'https:'],
    });

  const proxyHttp = (
    upstream: URL,
    req: ProxyRequest,
    // Connect hands middleware a ServerResponse (Node's HTTP/2 compat API matches it).
    res: ServerResponse,
    logError: (message: string) => void
  ) => {
    const outgoing = send(
      upstream,
      forwardedHeaders(req.headers, upstream.host),
      req.method
    );
    outgoing.on('response', (incoming) => {
      const headers: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        headers[name] =
          name === 'set-cookie'
            ? (withoutCookieDomain(value as string[]) ?? [])
            : value;
      }
      res.writeHead(incoming.statusCode ?? 502, headers);
      incoming.pipe(res as NodeJS.WritableStream);
    });
    outgoing.on('error', (error) => {
      logError(`hosted dev proxy: ${req.url}: ${error.message}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`Proxy error: ${error.message}`);
    });
    req.pipe(outgoing);
  };

  const proxyUpgrade = (upstream: URL, req: IncomingMessage, socket: Socket) => {
    const outgoing = send(upstream, {
      ...forwardedHeaders(req.headers, upstream.host),
      connection: 'Upgrade',
      upgrade: req.headers.upgrade,
    });
    outgoing.on('upgrade', (incoming, upstreamSocket, head) => {
      const lines = [`HTTP/1.1 101 ${incoming.statusMessage ?? 'Switching Protocols'}`];
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
        lines.push(`${incoming.rawHeaders[i]}: ${incoming.rawHeaders[i + 1]}`);
      }
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) socket.write(head);
      upstreamSocket.pipe(socket).pipe(upstreamSocket);
      upstreamSocket.on('error', () => socket.destroy());
      socket.on('error', () => upstreamSocket.destroy());
    });
    outgoing.on('response', (incoming) => {
      socket.end(`HTTP/1.1 ${incoming.statusCode} ${incoming.statusMessage}\r\n\r\n`);
    });
    outgoing.on('error', () => socket.destroy());
    outgoing.end();
  };

  return {
    name: 'macro-hosted-dev-proxy',
    apply: (_config, { command, mode, isPreview }) =>
      command === 'serve' &&
      (env.MODE ?? mode) === 'development' &&
      !isPreview &&
      !env.MACRO_LOCAL_BACKEND_PROXY &&
      !env.TAURI_ENV_PLATFORM &&
      !env.TAURI_DEV_HOST &&
      env.MACRO_DEV_PROXY !== 'false',
    config() {
      // A middleware rather than `server.proxy`: Vite falls back to HTTP/1.1
      // whenever `server.proxy` is set, and remote browsers then fetch
      // thousands of dev modules over six connections.
      return { define: { 'import.meta.env.VITE_DEV_PROXY': true } };
    },
    configureServer(server) {
      protocol = server.config.server.https ? 'https' : 'http';
      const logError = (message: string) => server.config.logger.error(message);
      server.middlewares.use((req, res, next) => {
        const upstream = resolve(req.url);
        if (!upstream) return next();
        if (isCrossOrigin(req)) {
          res.statusCode = 403;
          res.end('Cross-origin development proxy requests are not allowed');
          return;
        }
        proxyHttp(upstream, req, res, logError);
      });
      server.httpServer?.on('upgrade', (req: IncomingMessage, socket: Socket) => {
        const upstream = resolve(req.url);
        if (!upstream) return;
        if (isCrossOrigin(req)) {
          socket.destroy();
          return;
        }
        proxyUpgrade(upstream, req, socket);
      });
      server.httpServer?.once('close', () => {
        agents['http:'].destroy();
        agents['https:'].destroy();
      });
    },
  };
}
