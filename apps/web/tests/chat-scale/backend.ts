/**
 * Everything the Chat scale tier's page talks to, answered in the test
 * process: the built app's files, the fixture (`fixture.ts`) over Soup GraphQL,
 * its websocket, the section lists and channel previews, a signed-in viewer
 * in a team, and an empty account's answer, in each response type, to the
 * other services the app asks at startup.
 *
 * The page's own requests are routed here (`routePage`); a worker's go to
 * `serve`'s port, which answers the same way. Every request and operation is
 * counted, so a run shows what the app asked for. A service request with no
 * answer here, a GraphQL error and a read the fixture cannot serve are each an
 * error (`errors`), which fails the run. A required GraphQL field the fixture
 * does not serve (the shell's calendars, tags, pending sends) is answered
 * empty and counted in `defaulted`.
 */
import { readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page, WebSocketRoute } from '@playwright/test';
import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
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
import { bundleFile } from '../email-e2e/harness/front';
import {
  type ChatFixture,
  FIXTURE_NOW,
  TEAM_ID,
  TEAM_OWNER_ID,
  VIEWER_ID,
} from './fixture';

const SCHEMA = buildSchema(
  [
    '../../../../static_assets/schema.graphql',
    '../../graphql-client-schema.graphql',
  ]
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
    .join('\n')
);

/** The access hint every document storage answer carries, as the server
 * writes it for a team member without CRM access (`crm-access-cache.ts`). */
const DSS_HEADERS = { 'x-macro-crm-access': `${TEAM_ID}:denied` };

/** An empty account's answers to what the app shell asks at startup, by
 * method and path, in each service's response type. A service request that is
 * not here, in `NOT_FOUND` or in `NO_CONTENT` fails the run: add its answer
 * here. */
/** The viewer's team, which owns the team channels and sections: its owner
 * and the viewer, a member without CRM access. */
const VIEWER_TEAM: TeamWithMembers = {
  team: {
    id: TEAM_ID,
    name: 'Scale Team',
    slug: 'scale-team',
    owner_id: TEAM_OWNER_ID,
    allow_non_admin_invites: true,
    crm_enabled: true,
    enterprise: false,
  },
  members: [
    {
      user_id: TEAM_OWNER_ID,
      team_id: TEAM_ID,
      role: 'owner',
      plan: 'premium',
    },
    { user_id: VIEWER_ID, team_id: TEAM_ID, role: 'member', plan: 'premium' },
  ],
  crm_member_access: { [TEAM_OWNER_ID]: false, [VIEWER_ID]: false },
};

const REST_ANSWERS: Record<string, unknown> = {
  'GET /auth/team': VIEWER_TEAM,
  // Cookie sessions refresh with this; the app reads only the status.
  'POST /auth/jwt/refresh': {
    access_token: 'fixture',
    refresh_token: 'fixture',
  },
  'GET /cognition/import/state': { runs: [], entities: [] },
  'GET /dss/calendar-events': {
    hasMore: false,
    items: [],
    syncStatus: 'ready',
  },
  'POST /dss/databases/starter': {
    created: false,
    databaseId: null,
    tableId: null,
    viewId: null,
  },
  'POST /email/email/links/health-check': {},
  'GET /scheduled-action/scheduled-actions/draft-jobs': [],
  'GET /dss/crm/member-access': { team_id: TEAM_ID, allowed: false },
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

/** A viewer with no GitHub link gets this as not found. */
const NOT_FOUND = new Set(['GET /auth/link/github/status']);

/** Writes their services answer with 204 and no body. */
const NO_CONTENT = new Set(['POST /scheduled-action/suggestions/seen']);

/** How long `quiet` waits for a pause before it fails the step. */
const QUIET_LIMIT_MS = 120_000;

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
  /** Service requests with no answer here, GraphQL errors, frames that could
   * not execute, and reads the fixture cannot serve. */
  errors(): string[];
  /** The first requests, in order, for a run that went wrong. */
  log(): string[];
  /** Resolves once a channel backfill pass returns its last page after this
   * call; rejects when one of its pages could not be served. */
  channelPassFinished(): Promise<void>;
  /** Resolves once nothing is in flight and nothing moved (a request, an
   * answer, a socket message, a push) for `ms`, counted from this call at
   * the earliest, with when the last thing moved (epoch ms). Rejects after
   * `QUIET_LIMIT_MS` without such a pause. */
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
  const unanswered = new Set<string>();
  const log: string[] = [];
  const documents = new Map<string, DocumentNode>();
  const open = new Map<string, OpenSubscription>();
  const passWaiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  let inFlight = 0;
  let lastActivity = Date.now();
  const touch = () => {
    lastActivity = Date.now();
  };
  /** Counts `work` as in flight until it has answered. */
  const track = async <T>(work: () => Promise<T>): Promise<T> => {
    inFlight += 1;
    touch();
    try {
      return await work();
    } finally {
      inFlight -= 1;
      touch();
    }
  };

  /** `POST /dss/channels/preview`: each fixture channel, by id. */
  const channelPreviews = (body: string) => {
    const { channel_ids } = JSON.parse(body) as { channel_ids: string[] };
    return fixture.channelPreviews(channel_ids);
  };

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
    const faultsBefore = fixture.reads().unsupported.length;
    const result = await execute({
      schema: SCHEMA,
      document: parsed(request.query, name),
      operationName: request.operationName,
      variableValues: request.variables,
      rootValue: fixture.rootValue(),
      fieldResolver,
    });
    recordErrors(name, result);
    // A page the fixture could not serve ends with no cursor too; it is an
    // error, not the end of a pass.
    const served =
      (result.errors ?? []).length === 0 &&
      fixture.reads().unsupported.length === faultsBefore;
    if (name === 'SoupChannelDirectoryBackfill' && !served)
      for (const waiter of passWaiters.splice(0))
        waiter.reject(
          new Error(
            `a channel page failed: ${fixture.reads().unsupported.at(-1) ?? errors.at(-1)}`
          )
        );
    if (name === 'SoupChannelDirectoryBackfill' && nextCursor(result) === null)
      for (const waiter of passWaiters.splice(0)) waiter.resolve();
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
    if (method === 'POST' && path === '/dss/items/soup/graphql')
      return await graphql(body);
    if (method === 'POST' && path === '/dss/channels/preview')
      return json({ previews: channelPreviews(body) }, DSS_HEADERS);
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
    if (NO_CONTENT.has(key)) return { status: 204, headers, body: '' };
    if (SERVICE_PREFIX.test(path)) {
      if (!unanswered.has(key)) {
        unanswered.add(key);
        errors.push(`no answer for ${key} (REST_ANSWERS)`);
      }
      return { status: 501, headers, body: '' };
    }
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
      touch();
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
    await track(async () => {
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
    });
  };

  return {
    async routePage(page) {
      await page.routeWebSocket(
        () => true,
        (socket) => {
          const path = new URL(socket.url()).pathname;
          add(counts.sockets, path);
          touch();
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
        await track(async () => {
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
      touch();
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
        touch();
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
    errors: () => [
      ...errors,
      ...fixture.reads().unsupported.map((read) => `fixture: ${read}`),
    ],
    log: () => [...log],
    channelPassFinished: () =>
      new Promise<void>((resolve, reject) => {
        passWaiters.push({ resolve, reject });
      }),
    quiet(ms) {
      const calledAt = Date.now();
      return new Promise<number>((resolve, reject) => {
        const wait = () => {
          const now = Date.now();
          if (now - calledAt > QUIET_LIMIT_MS) {
            reject(
              new Error(
                `no ${ms} ms pause within ${QUIET_LIMIT_MS} ms (${inFlight} in flight)`
              )
            );
            return;
          }
          const left = Math.max(lastActivity, calledAt) + ms - now;
          if (inFlight === 0 && left <= 0) {
            resolve(lastActivity);
            return;
          }
          setTimeout(wait, Math.max(left, 50));
        };
        wait();
      });
    },
  };
}
