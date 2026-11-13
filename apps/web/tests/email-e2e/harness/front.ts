// The one origin a test's browser talks to: the built web app, the stack's
// email and document storage services behind the path prefixes the app uses,
// and an answer for the few other services the app asks at startup.
//
// The services trust the internal headers a gateway adds after it has checked
// a session; the front adds them for the test's signed-in user, which is how
// the browser is signed in without an authentication service.

import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { connect } from 'node:net';
import { extname, join } from 'node:path';
import type { Duplex } from 'node:stream';

export type SignedInUser = {
  email: string;
  macroUserId: string;
  fusionUserId: string;
};

export type FrontOptions = {
  /** The built bundle (`apps/web/dist`). */
  dist: string;
  /** The stack's `email_service`. */
  emailUrl: string;
  /** The stack's `document_storage_service`. */
  documentStorageUrl: string;
  internalApiKey: string;
  user: SignedInUser;
};

/** A request the front answered itself or could not answer. */
export type FrontRequest = { method: string; path: string; status: number };

/** Answers a request the services do not: return `undefined` to pass. */
export type Stub = (request: {
  method: string;
  path: string;
  query: URLSearchParams;
  body: string;
}) => { status?: number; json: unknown } | undefined;

export type Front = {
  origin: string;
  /** Requests no service or stub answered. A test can assert it is empty. */
  unanswered: FrontRequest[];
  /** Adds a stub ahead of the built-in ones. */
  stub(stub: Stub): void;
  close(): Promise<void>;
};

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain',
};

// The cache worker's wasm needs cross-origin isolation.
const ISOLATION = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'credentialless',
  'cross-origin-resource-policy': 'cross-origin',
};

const files = new Map<string, Buffer>();
function file(path: string): Buffer {
  let body = files.get(path);
  if (!body) {
    body = readFileSync(path);
    files.set(path, body);
  }
  return body;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** What the gateway adds to a request it has authenticated. */
function internalHeaders(options: FrontOptions): Record<string, string> {
  return {
    'x-internal-auth-key': options.internalApiKey,
    'x-internal-macro-user-id': options.user.macroUserId,
    'x-internal-fusionauth-user-id': options.user.fusionUserId,
  };
}

/** The service a path prefix belongs to, and the path within it. */
function upstream(
  options: FrontOptions,
  path: string
): { base: string; path: string } | undefined {
  const services: [string, string][] = [
    ['/email', options.emailUrl],
    ['/dss', options.documentStorageUrl],
  ];
  for (const [prefix, base] of services) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return { base, path: path.slice(prefix.length) || '/' };
    }
  }
  return undefined;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'host',
]);

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function builtInStubs(options: FrontOptions): Stub {
  const { user } = options;
  return ({ path }) => {
    if (path === '/auth/user/legacy_user_permissions') {
      return {
        json: {
          userId: user.macroUserId,
          email: user.email,
          name: user.email.split('@')[0],
          permissions: [],
          licenseStatus: 'active',
          tutorialComplete: true,
          group: null,
          hasChromeExt: false,
          hasTrialed: true,
          aiDataConsent: true,
          referralCode: null,
          createdAt: '2026-01-01T00:00:00Z',
        },
      };
    }
    if (path === '/auth/user/me') {
      return {
        json: {
          user_id: user.macroUserId,
          permissions: [],
          organization_id: null,
        },
      };
    }
    if (path === '/auth/jwt/refresh') return { json: {} };
    return undefined;
  };
}

export async function startFront(options: FrontOptions): Promise<Front> {
  const unanswered: FrontRequest[] = [];
  const stubs: Stub[] = [builtInStubs(options)];

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://front');
    const path = url.pathname;
    const method = request.method ?? 'GET';

    if (method === 'GET') {
      const candidates = [
        join(options.dist, path),
        join(options.dist, path.replace(/^\/app\//, '/')),
      ];
      const found = candidates.find(isFile);
      if (found) {
        response.writeHead(200, {
          ...ISOLATION,
          'content-type': MIME[extname(found)] ?? 'application/octet-stream',
        });
        response.end(file(found));
        return;
      }
      if (path === '/' || path === '/app' || path.startsWith('/app/')) {
        response.writeHead(200, { ...ISOLATION, 'content-type': 'text/html' });
        response.end(file(join(options.dist, 'index.html')));
        return;
      }
    }

    const body = await readBody(request);

    for (const stub of stubs) {
      const answer = stub({
        method,
        path,
        query: url.searchParams,
        body: body.toString('utf8'),
      });
      if (answer) {
        response.writeHead(answer.status ?? 200, {
          ...ISOLATION,
          'content-type': 'application/json',
        });
        response.end(JSON.stringify(answer.json));
        return;
      }
    }

    const target = upstream(options, path);
    if (target) {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (HOP_BY_HOP.has(name) || name.startsWith('x-internal-')) continue;
        if (typeof value === 'string') headers[name] = value;
      }
      Object.assign(headers, internalHeaders(options));
      const answer = await fetch(`${target.base}${target.path}${url.search}`, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : body,
        redirect: 'manual',
      });
      const answerHeaders: Record<string, string> = { ...ISOLATION };
      answer.headers.forEach((value, name) => {
        if (!HOP_BY_HOP.has(name)) answerHeaders[name] = value;
      });
      response.writeHead(answer.status, answerHeaders);
      response.end(Buffer.from(await answer.arrayBuffer()));
      return;
    }

    unanswered.push({ method, path, status: 404 });
    response.writeHead(404, {
      ...ISOLATION,
      'content-type': 'application/json',
    });
    response.end('{}');
  };

  const server: Server = createServer(async (request, response) => {
    try {
      await handle(request, response);
    } catch (error: unknown) {
      unanswered.push({
        method: request.method ?? 'GET',
        path: request.url ?? '/',
        status: 502,
      });
      if (!response.headersSent) response.writeHead(502, ISOLATION);
      response.end(String(error));
    }
  });

  // A websocket to a service is piped through with the same headers; the
  // others are answered in the browser (see `stubSockets`).
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head) => {
    const url = new URL(request.url ?? '/', 'http://front');
    const target = upstream(options, url.pathname);
    if (!target) {
      socket.destroy();
      return;
    }
    const base = new URL(target.base);
    const service = connect(Number(base.port), base.hostname, () => {
      const lines = [
        `GET ${target.path}${url.search} HTTP/1.1`,
        `host: ${base.host}`,
      ];
      for (const [name, value] of Object.entries(request.headers)) {
        if (name === 'host' || name.startsWith('x-internal-')) continue;
        if (typeof value === 'string') lines.push(`${name}: ${value}`);
      }
      for (const [name, value] of Object.entries(internalHeaders(options))) {
        lines.push(`${name}: ${value}`);
      }
      service.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) service.write(head);
      service.pipe(socket);
      socket.pipe(service);
    });
    service.on('error', () => socket.destroy());
    socket.on('error', () => service.destroy());
  });

  const sockets = new Set<Duplex>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://localhost:${port}`,
    unanswered,
    stub: (stub) => {
      stubs.unshift(stub);
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
