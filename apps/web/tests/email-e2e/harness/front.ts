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

/**
 * A request that reached the front, for the coverage evidence: a service
 * answered it, a stub did, or nothing did. `path` is the path within the
 * service for a service's request and the whole path otherwise.
 */
export type RecordedRequest = {
  answeredBy: 'email' | 'dss' | 'stub' | 'nothing';
  /** The test asked, not the app: it carried `FROM_TEST`. */
  fromTest: boolean;
  /** `WS` for a message sent over a service's websocket. */
  method: string;
  path: string;
  /** 500 for a GraphQL answer that carries errors, whatever its status. */
  status: number;
  /** The GraphQL operations in the request's body. */
  operations: string[];
};

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
  /** Every request that was not for one of the bundle's files. */
  requests: RecordedRequest[];
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
): { service: 'email' | 'dss'; base: string; path: string } | undefined {
  const services: ['email' | 'dss', string][] = [
    ['email', options.emailUrl],
    ['dss', options.documentStorageUrl],
  ];
  for (const [service, base] of services) {
    const prefix = `/${service}`;
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return { service, base, path: path.slice(prefix.length) || '/' };
    }
  }
  return undefined;
}

/** Whether a GraphQL answer, single or batched, carries errors. */
export function graphqlFailed(answer: string): boolean {
  if (!answer.includes('"errors"')) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return false;
  }
  return [parsed].flat().some((each) => {
    if (typeof each !== 'object' || each === null) return false;
    const { errors } = each as Record<string, unknown>;
    return Array.isArray(errors) && errors.length > 0;
  });
}

/** The names of the GraphQL operations in a request body or socket message. */
export function graphqlOperations(body: string): string[] {
  if (!body.includes('"query"')) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const names: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object' || value === null) return;
    const { operationName, query, payload } = value as Record<string, unknown>;
    // A socket message carries the operation in its payload.
    if (payload !== undefined) visit(payload);
    if (typeof query !== 'string') return;
    const name =
      typeof operationName === 'string'
        ? operationName
        : /^\s*(?:query|mutation|subscription)\s+(\w+)/.exec(query)?.[1];
    if (name) names.push(name);
  };
  visit(parsed);
  return names;
}

/**
 * Reads the text messages a browser sends over a websocket out of the bytes
 * it writes: unmasks each frame and joins a message's fragments.
 */
export function socketMessages(onMessage: (text: string) => void) {
  let pending: Buffer = Buffer.alloc(0);
  let fragments: Buffer[] = [];
  let text = false;
  return (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    for (;;) {
      if (pending.length < 2) return;
      const opcode = pending[0] & 0x0f;
      const final = (pending[0] & 0x80) !== 0;
      const masked = (pending[1] & 0x80) !== 0;
      let length = pending[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (pending.length < 4) return;
        length = pending.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (pending.length < 10) return;
        length = Number(pending.readBigUInt64BE(2));
        offset = 10;
      }
      const key = masked ? offset : -1;
      if (masked) offset += 4;
      if (pending.length < offset + length) return;
      const payload = Buffer.from(pending.subarray(offset, offset + length));
      if (masked) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= pending[key + (i % 4)];
        }
      }
      pending = pending.subarray(offset + length);
      // Control frames (close, ping, pong) may come between fragments.
      if (opcode >= 0x8) continue;
      if (opcode !== 0) {
        text = opcode === 1;
        fragments = [];
      }
      fragments.push(payload);
      if (!final) continue;
      if (text) onMessage(Buffer.concat(fragments).toString('utf8'));
      fragments = [];
    }
  };
}

/**
 * The header of a request the test makes itself, so that what the test asks
 * is not taken for something the app did.
 */
export const FROM_TEST = 'x-email-e2e-from-test';

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
  const requests: RecordedRequest[] = [];
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
    const fromTest = request.headers[FROM_TEST] !== undefined;

    for (const stub of stubs) {
      const answer = stub({
        method,
        path,
        query: url.searchParams,
        body: body.toString('utf8'),
      });
      if (answer) {
        requests.push({
          answeredBy: 'stub',
          fromTest,
          method,
          path,
          status: answer.status ?? 200,
          operations: graphqlOperations(body.toString('utf8')),
        });
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
        if (name === FROM_TEST) continue;
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
      const answered = Buffer.from(await answer.arrayBuffer());
      const operations = graphqlOperations(body.toString('utf8'));
      const failed =
        operations.length > 0 && graphqlFailed(answered.toString('utf8'));
      requests.push({
        answeredBy: target.service,
        fromTest,
        method,
        path: target.path,
        status: failed ? 500 : answer.status,
        operations,
      });
      response.writeHead(answer.status, answerHeaders);
      response.end(answered);
      return;
    }

    unanswered.push({ method, path, status: 404 });
    requests.push({
      answeredBy: 'nothing',
      fromTest,
      method,
      path,
      status: 404,
      operations: graphqlOperations(body.toString('utf8')),
    });
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
        // Uncompressed, so the operations the browser sends can be read.
        if (name === 'sec-websocket-extensions') continue;
        if (typeof value === 'string') lines.push(`${name}: ${value}`);
      }
      for (const [name, value] of Object.entries(internalHeaders(options))) {
        lines.push(`${name}: ${value}`);
      }
      service.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) service.write(head);
      service.pipe(socket);
      socket.pipe(service);
      const read = socketMessages((message) => {
        const operations = graphqlOperations(message);
        if (operations.length === 0) return;
        requests.push({
          answeredBy: target.service,
          fromTest: false,
          method: 'WS',
          path: target.path,
          status: 101,
          operations,
        });
      });
      if (head.length > 0) read(head);
      socket.on('data', read);
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
    requests,
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
