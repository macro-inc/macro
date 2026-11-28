/**
 * Everything the Chat scale tier's page talks to, answered in the test
 * process: the built app's files, the fixture (`fixture.ts`) over Soup GraphQL,
 * its websocket and the section lists, a signed-in viewer with no team, and
 * an empty answer from every other service the app asks at startup.
 *
 * The page's own requests are routed here (`routePage`); a worker's go to
 * `serve`'s port, which answers the same way. Every request and operation is
 * counted, so a run shows what the app asked for, and every frame the fixture
 * could not answer is an error. A required GraphQL field the fixture does not
 * serve (the shell's calendars, tags, pending sends) is answered empty and
 * counted in `defaulted`.
 */
import { readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page, WebSocketRoute } from '@playwright/test';
import {
  buildSchema,
  type DocumentNode,
  defaultFieldResolver,
  type ExecutionResult,
  execute,
  type GraphQLFieldResolver,
  type GraphQLOutputType,
  getOperationAST,
  isAbstractType,
  isEnumType,
  isListType,
  isNonNullType,
  isScalarType,
  parse,
  validate,
} from 'graphql';
import { match } from 'ts-pattern';
import {
  type ChatFixture,
  FIXTURE_NOW,
  VIEWER_ID,
} from './fixture';
import { bundleFile } from '../email-e2e/harness/front';

const SCHEMA = buildSchema(
  [
    '../../../../static_assets/schema.graphql',
    '../../graphql-client-schema.graphql',
  ]
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
    .join('\n')
);

/** The access hint every document storage answer carries: a viewer with no
 * team has no CRM access to prove (`crm-access-cache.ts`). */
const DSS_HEADERS = { 'x-macro-crm-access': 'none' };

/** An empty account's answers to what the app shell asks at startup, by
 * method and path, in each service's response type. A path missing here is
 * answered `{}`; add it when that answer breaks the page. */
const REST_ANSWERS: Record<string, unknown> = {
  'GET /dss/crm/member-access': { team_id: null, allowed: false },
  'GET /auth/user/me': {
    user_id: VIEWER_ID,
    permissions: [],
    organization_id: null,
  },
  'GET /auth/system-status': { status: 'operational' },
  'GET /auth/user/name': {
    id: VIEWER_ID,
    first_name: 'Scale',
    last_name: 'Viewer',
  },
  'GET /auth/user/language': {},
  'POST /auth/user/profile_pictures': { pictures: [] },
  'GET /cognition/connectors': [],
  'GET /cognition/connectors/catalog': { apps: [], nextCursor: null },
  'GET /cognition/onboarding/prompts': { dismissed: [] },
  'GET /scheduled-action/scheduled-actions': [],
  'GET /scheduled-action/scheduled-actions/catalog': [],
  'GET /scheduled-action/scheduled-actions/suggestions': {
    status: 'none',
    suggestions: [],
  },
  'GET /notification/unsubscribe': [],
  'GET /notification/notification_settings/channels': { channels: [] },
  'GET /notification/notification_settings/sections': { sections: [] },
  'GET /email/email/links': { links: [] },
  'GET /calendar/calendars': { calendars: [] },
  'GET /dss/forms/accessible': [],
  'GET /dss/databases': [],
  'GET /dss/bots': [],
  'GET /dss/call/active': { calls: [] },
  'GET /dss/call/meetings/active': { meetings: [] },
};

/** A viewer with no team or GitHub link gets these as not found. */
const NOT_FOUND = new Set(['GET /auth/team', 'GET /auth/link/github/status']);

/** Non-null scalars a missing field answers with. */
const EMPTY_SCALARS: Record<string, unknown> = {
  Int: 0,
  Float: 0,
  Boolean: false,
  DateTime: new Date(FIXTURE_NOW).toISOString(),
  JSON: {},
};

/** The services the bundle reaches at its own origin (`servers.ts`). */
const SERVICE_PREFIX =
  /^\/(auth|dss|websocket|cognition|connection-gateway|notification|static-file|unfurl|agent-harness|preview|contacts|email|calendar|image-proxy|scheduled-action|agent-git)\//;

const LOG_LIMIT = 400;

const SOUP_SOCKET = /\/dss\/items\/soup\/graphql\/ws$/;

const VIEWER = {
  userId: VIEWER_ID,
  email: 'viewer@example.test',
  name: 'Scale Viewer',
  permissions: [],
  licenseStatus: 'active',
  tutorialComplete: true,
  isAgent: false,
  group: null,
  hasChromeExt: false,
  hasTrialed: true,
  aiDataConsent: true,
  referralCode: null,
  createdAt: '2024-01-01T00:00:00.000Z',
};

type Answer = {
  status: number;
  headers: Record<string, string>;
  body: Buffer | string;
};

type GraphqlRequest = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

type OpenSubscription = {
  id: string;
  name: string;
  document: DocumentNode;
  variables: Record<string, unknown> | undefined;
  socket: WebSocketRoute;
};

/** What the app asked for, by key; `since` gives one step's share. */
export type BackendCounts = {
  /** HTTP requests, by method and path. */
  requests: Record<string, number>;
  /** GraphQL operations over HTTP, by name. */
  operations: Record<string, number>;
  /** Subscriptions opened over the Soup websocket, by name. */
  subscriptions: Record<string, number>;
  /** Websockets opened, by path. */
  sockets: Record<string, number>;
  /** Required GraphQL fields the fixture does not serve, answered empty. */
  defaulted: Record<string, number>;
};

export type Backend = {
  /** The page's requests, routed to the backend; other origins are refused. */
  routePage(page: Page): Promise<void>;
  /** The same answers on a port, for requests a worker makes. */
  serve(): Promise<{ origin: string; close: () => Promise<void> }>;
  /** Sends one frame to every open subscription of an operation; how many. */
  push(operation: string, frame: unknown): Promise<number>;
  counts(): BackendCounts;
  since(mark: BackendCounts): BackendCounts;
  /** Answers the fixture could not give, and frames it could not execute. */
  errors(): string[];
  /** The first requests, in order, for a run that went wrong. */
  log(): string[];
  /** Resolves once a channel backfill pass returns its last page after this
   * call. */
  channelPassFinished(): Promise<void>;
  /** Resolves once no request has arrived for `ms`, with when the last one
   * did (epoch ms). */
  quiet(ms: number): Promise<number>;
};

function json(value: unknown, headers: Record<string, string> = {}): Answer {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(value),
  };
}

function add(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function subtract(
  now: Record<string, number>,
  mark: Record<string, number>
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(now)
      .map(([key, count]) => [key, count - (mark[key] ?? 0)] as const)
      .filter(([, count]) => count > 0)
  );
}

/** What a required field the fixture lacks answers: an empty list, an
 * object of empty fields, or a scalar's zero; null where the schema allows. */
function emptyValue(type: GraphQLOutputType): unknown {
  if (!isNonNullType(type)) return null;
  const inner = type.ofType;
  if (isListType(inner)) return [];
  if (isEnumType(inner)) return inner.getValues()[0]?.value;
  if (isScalarType(inner)) return EMPTY_SCALARS[inner.name] ?? '';
  if (isAbstractType(inner))
    return { __typename: SCHEMA.getPossibleTypes(inner)[0]?.name };
  return {};
}

function nextCursor(result: ExecutionResult): unknown {
  const data = result.data as
    | { user?: { soup?: { nextCursor?: unknown } } }
    | null
    | undefined;
  return data?.user?.soup?.nextCursor;
}

export function createBackend(dist: string, fixture: ChatFixture): Backend {
  const counts: BackendCounts = {
    requests: {},
    operations: {},
    subscriptions: {},
    sockets: {},
    defaulted: {},
  };
  const errors: string[] = [];
  const log: string[] = [];
  const documents = new Map<string, DocumentNode>();
  const open = new Map<string, OpenSubscription>();
  const passWaiters: Array<() => void> = [];
  let lastRequest = Date.now();

  const parsed = (query: string, name: string): DocumentNode => {
    const cached = documents.get(query);
    if (cached) return cached;
    const document = parse(query);
    for (const error of validate(SCHEMA, document))
      errors.push(`${name}: invalid document: ${error.message}`);
    documents.set(query, document);
    return document;
  };

  const fieldResolver: GraphQLFieldResolver<unknown, unknown> = (
    source,
    args,
    context,
    info
  ) => {
    if (
      typeof source === 'object' &&
      source !== null &&
      info.fieldName in source
    )
      return defaultFieldResolver(source, args, context, info);
    if (isNonNullType(info.returnType))
      add(counts.defaulted, `${info.parentType.name}.${info.fieldName}`);
    return emptyValue(info.returnType);
  };

  const recordErrors = (name: string, result: ExecutionResult) => {
    for (const error of result.errors ?? [])
      errors.push(`${name}: ${error.message} at ${error.path?.join('.')}`);
  };

  const graphql = async (body: string): Promise<Answer> => {
    const request = JSON.parse(body) as GraphqlRequest;
    const name = request.operationName ?? 'anonymous';
    add(counts.operations, name);
    const result = await execute({
      schema: SCHEMA,
      document: parsed(request.query, name),
      operationName: request.operationName,
      variableValues: request.variables,
      rootValue: fixture.rootValue(),
      fieldResolver,
    });
    recordErrors(name, result);
    if (name === 'SoupChannelDirectoryBackfill' && nextCursor(result) === null)
      for (const notify of passWaiters.splice(0)) notify();
    return json(result, DSS_HEADERS);
  };

  const answer = async (
    method: string,
    url: URL,
    body: string
  ): Promise<Answer | undefined> => {
    const path = url.pathname;
    add(counts.requests, `${method} ${path}`);
    if (log.length < LOG_LIMIT) log.push(`${method} ${path}${url.search}`);
    lastRequest = Date.now();
    if (method === 'POST' && path === '/dss/items/soup/graphql')
      return await graphql(body);
    if (method === 'GET' && /^\/dss\/channel-(labels|sections)$/.test(path))
      return json(
        fixture.labels(url.searchParams.get('scope') ?? undefined),
        DSS_HEADERS
      );
    const headers = path.startsWith('/dss/') ? DSS_HEADERS : {};
    const key = `${method} ${path}`;
    if (path === '/auth/user/legacy_user_permissions') return json(VIEWER);
    if (key in REST_ANSWERS) return json(REST_ANSWERS[key], headers);
    if (NOT_FOUND.has(key)) return { status: 404, headers, body: '' };
    if (SERVICE_PREFIX.test(path)) return json({}, headers);
    const file = method === 'GET' ? bundleFile(dist, path) : undefined;
    if (file) return { status: 200, headers: file.headers, body: file.body };
    return undefined;
  };

  const subscribe = (
    socket: WebSocketRoute,
    id: string,
    payload: GraphqlRequest
  ) => {
    const document = parsed(payload.query, 'subscription');
    const name =
      payload.operationName ??
      getOperationAST(document)?.name?.value ??
      'anonymous';
    add(counts.subscriptions, name);
    open.set(id, {
      id,
      name,
      document,
      variables: payload.variables,
      socket,
    });
  };

  // graphql-transport-ws, as the app's `graphql-ws` client speaks it.
  const soupSocket = (socket: WebSocketRoute) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as {
        type: string;
        id?: string;
        payload?: GraphqlRequest;
      };
      match(message.type)
        .with('connection_init', () =>
          socket.send(JSON.stringify({ type: 'connection_ack' }))
        )
        .with('ping', () => socket.send(JSON.stringify({ type: 'pong' })))
        .with('subscribe', () => {
          if (message.id && message.payload)
            subscribe(socket, message.id, message.payload);
        })
        .with('complete', () => {
          if (message.id) open.delete(message.id);
        })
        .otherwise(() => undefined);
    });
    socket.onClose(() => {
      for (const [id, each] of open)
        if (each.socket === socket) open.delete(id);
    });
  };

  const respond = async (
    request: IncomingMessage,
    response: ServerResponse
  ) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const url = new URL(request.url ?? '/', 'http://backend');
    const found = await answer(
      request.method ?? 'GET',
      url,
      Buffer.concat(chunks).toString('utf8')
    );
    if (!found) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(found.status, found.headers).end(found.body);
  };

  return {
    async routePage(page) {
      await page.routeWebSocket(
        () => true,
        (socket) => {
          const path = new URL(socket.url()).pathname;
          add(counts.sockets, path);
          // Every other socket (the connection gateway's) stays open and
          // silent: closing it would only start the app's reconnects.
          if (SOUP_SOCKET.test(path)) soupSocket(socket);
        }
      );
      await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.hostname !== '127.0.0.1') {
          await route.abort();
          return;
        }
        const found = await answer(
          request.method(),
          url,
          request.postData() ?? ''
        );
        try {
          await route.fulfill(
            found
              ? {
                  status: found.status,
                  headers: found.headers,
                  body: found.body,
                }
              : { status: 404 }
          );
        } catch {
          // The page closed meanwhile.
        }
      });
    },
    async serve() {
      const server = createServer(async (request, response) => {
        try {
          await respond(request, response);
        } catch (error) {
          errors.push(`server: ${String(error)}`);
          response.destroy();
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(
          Number(process.env.CHAT_SCALE_PORT ?? 0),
          '127.0.0.1',
          resolve
        )
      );
      const { port } = server.address() as AddressInfo;
      return {
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      };
    },
    async push(operation, frame) {
      const targets = [...open.values()].filter(
        (each) => each.name === operation
      );
      for (const target of targets) {
        const result = await execute({
          schema: SCHEMA,
          document: target.document,
          variableValues: target.variables,
          rootValue: frame,
          fieldResolver,
        });
        recordErrors(operation, result);
        target.socket.send(
          JSON.stringify({ id: target.id, type: 'next', payload: result })
        );
      }
      return targets.length;
    },
    counts: () => structuredClone(counts),
    since: (mark) => ({
      requests: subtract(counts.requests, mark.requests),
      operations: subtract(counts.operations, mark.operations),
      subscriptions: subtract(counts.subscriptions, mark.subscriptions),
      sockets: subtract(counts.sockets, mark.sockets),
      defaulted: subtract(counts.defaulted, mark.defaulted),
    }),
    errors: () => [...errors],
    log: () => [...log],
    channelPassFinished: () =>
      new Promise<void>((resolve) => {
        passWaiters.push(resolve);
      }),
    quiet(ms) {
      return new Promise<number>((resolve) => {
        const wait = () => {
          const left = lastRequest + ms - Date.now();
          if (left <= 0) {
            resolve(lastRequest);
            return;
          }
          setTimeout(wait, left);
        };
        wait();
      });
    },
  };
}
