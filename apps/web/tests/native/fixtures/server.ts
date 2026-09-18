import { buildSchema, graphql } from 'graphql';
import type { SoupInput } from '../../../src/lib/service-clients/service-storage/graphql/generated/graphql';
import { bootstrapResponses } from './bootstrap';
import capsules from './filter-capsules.json';
import {
  filterCorpus,
  LINKS,
  matrixAccounts,
  matrixTagSets,
  PEOPLE,
} from './filter-corpus';
import { accounts, fixtureId, mail, USER_ID } from './mail';

const schema = buildSchema(
  await Bun.file(
    new URL('../../../../../static_assets/schema.graphql', import.meta.url)
  ).text()
);

function excludesMail(input: SoupInput) {
  return (
    input.initial?.filters?.emailFilter?.tree?.literal?.threadId ===
    fixtureId(0)
  );
}

export type RequestRecord = {
  method: string;
  path: string;
  operation?: string;
  variables?: Record<string, unknown>;
  error?: string;
};

/** HTTP fixtures at the production API paths: real platformFetch, urql,
 * checkpointed backfill, normalization and native storage remain in the app.
 * No forwarding to a hosted backend, cache seeding, or filter-result injection. */
export function startFixtureServer(port = 0, filterMatrix = false) {
  const corpus = filterMatrix ? filterCorpus(capsules) : undefined;
  const metadataMail = corpus
    ? corpus
        .filter(
          (row) => row.kind === 'email' && LINKS.includes(row.linkId ?? '')
        )
        .map((row) => row.api)
    : mail;
  const sharedMail =
    corpus
      ?.filter((row) => row.kind === 'email' && row.shared)
      .map((row) => row.api) ?? [];
  const core =
    corpus?.filter((row) => row.kind !== 'email').map((row) => row.api) ?? [];
  const signalMail = corpus
    ? corpus
        .filter(
          (row) =>
            row.kind === 'email' &&
            row.signal &&
            row.inbox &&
            LINKS.includes(row.linkId ?? '')
        )
        .map((row) => row.api)
    : [mail[1], mail[5]];
  const requests: RequestRecord[] = [];
  const pageSize = 2;
  const cursors = new Map<string, number>();
  let pagesServed = 0;

  function soupPage(input: SoupInput, operation: string) {
    if (operation === 'SoupMailBackfill') {
      let offset = 0;
      if (input.continuation) {
        const saved = cursors.get(input.continuation.cursor);
        if (saved === undefined) throw new Error('Unknown metadata cursor');
        offset = saved;
      } else if (input.initial?.emailView !== 'ALL') {
        throw new Error('Metadata backfill must request ALL');
      }
      const nextOffset = offset + pageSize;
      const nextCursor =
        nextOffset < metadataMail.length ? `metadata-${nextOffset}` : null;
      if (nextCursor) cursors.set(nextCursor, nextOffset);
      pagesServed += 1;
      return { items: metadataMail.slice(offset, nextOffset), nextCursor };
    }
    if (operation === 'SoupSharedMailBackfill')
      return { items: sharedMail, nextCursor: null };
    if (operation === 'SoupBackfill') {
      const coreLane =
        input.initial?.filters?.emailFilter?.tree?.literal?.threadId ===
          fixtureId(0) &&
        input.initial.filters.documentFilter?.literal?.id !== fixtureId(0);
      return { items: coreLane ? core : [], nextCursor: null };
    }
    if (operation === 'SoupNotifications')
      return { items: [], nextCursor: null };
    if (operation === 'Soup') {
      // The app sidebar also queries channel Soup, explicitly excluding mail.
      if (excludesMail(input)) {
        return { items: [], nextCursor: null };
      }
      const signalTree = input.initial?.filters?.emailFilter?.tree;
      if (
        input.initial?.emailView !== 'INBOX' ||
        signalTree?.and?.left?.literal?.importance !== true ||
        signalTree?.and?.right?.literal?.shared !== 'EXCLUDE'
      ) {
        throw new Error('Only the initial Signal view may be fetched online');
      }
      return { items: signalMail, nextCursor: null };
    }
    throw new Error(`Unimplemented Soup operation: ${operation}`);
  }

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: cors });

  async function graphqlResponse(request: Request, record: RequestRecord) {
    try {
      const body = (await request.json()) as {
        query: string;
        operationName?: string;
        variables?: Record<string, unknown>;
      };
      const operation =
        body.operationName ?? /\bquery\s+(\w+)/.exec(body.query)?.[1] ?? '';
      record.operation = operation;
      record.variables = body.variables;
      const result = await graphql({
        schema,
        source: body.query,
        variableValues: body.variables,
        operationName: body.operationName,
        rootValue: {
          user: {
            id: USER_ID,
            emailLinks: filterMatrix ? matrixAccounts : accounts,
            emailLabels: [],
            favorites: [],
            soup: ({ input }: { input: SoupInput }) =>
              soupPage(input, operation),
          },
        },
      });
      if (result.errors)
        record.error = result.errors.map((error) => error.message).join('; ');
      return json(result);
    } catch (error) {
      record.error = String(error);
      return json({ error: record.error }, 500);
    }
  }

  const sockets = new Set<Bun.ServerWebSocket<{ path: string }>>();
  const server = Bun.serve<{ path: string }>({
    hostname: '127.0.0.1',
    port,
    fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (request.method === 'OPTIONS')
        return new Response(null, { headers: cors });
      const record: RequestRecord = { method: request.method, path };
      requests.push(record);
      try {
        if (path === '/health') return json({ ok: true });
        if (
          [
            '/websocket',
            '/connection-gateway',
            '/dss/items/soup/graphql/ws',
          ].includes(path) &&
          request.headers.get('upgrade')?.toLowerCase() === 'websocket'
        ) {
          if (server.upgrade(request, { data: { path } })) return;
          throw new Error('WebSocket upgrade failed');
        }
        if (
          filterMatrix &&
          request.method === 'GET' &&
          path === '/dss/properties/tags'
        )
          return json(matrixTagSets);
        if (
          filterMatrix &&
          request.method === 'GET' &&
          path === '/contacts/contacts'
        )
          return json({ contacts: PEOPLE });
        const bootstrap = bootstrapResponses.get(`${request.method} ${path}`);
        if (bootstrap) return json(bootstrap.body, bootstrap.status);
        if (path === '/dss/items/soup/graphql' && request.method === 'POST') {
          return graphqlResponse(request, record);
        }
        record.error = `Unimplemented fixture: ${request.method} ${path}`;
        return json({ error: record.error }, 501);
      } catch (error) {
        record.error = String(error);
        return json({ error: record.error }, 500);
      }
    },
    websocket: {
      open(socket) {
        sockets.add(socket);
      },
      close(socket) {
        sockets.delete(socket);
      },
      message(socket, message) {
        if (socket.data.path !== '/dss/items/soup/graphql/ws') return;
        const payload: { type?: string } = JSON.parse(String(message));
        if (payload.type === 'connection_init')
          socket.send(JSON.stringify({ type: 'connection_ack' }));
        if (payload.type === 'ping')
          socket.send(JSON.stringify({ type: 'pong' }));
        // No fixture entity changes; subscriptions stay connected until offline.
      },
    },
  });

  let shutdown: Promise<void> | undefined;
  return {
    origin: `http://localhost:${server.port}`,
    requests,
    get socketCount() {
      return sockets.size;
    },
    expectedMetadataPages: Math.ceil(metadataMail.length / pageSize),
    initialSignalIds: signalMail.map((row) => String(row.id)),
    get metadataPagesServed() {
      return pagesServed;
    },
    /** Closes the listener and every in-flight connection, including native
     * HTTP. The runner's network namespace has no external route to fall back to. */
    async disconnect() {
      if (shutdown) return await shutdown;
      // Start stopping before terminating upgrades: Bun's stop promise can
      // otherwise miss their close notifications and never settle.
      shutdown = server.stop(true);
      for (const socket of sockets) socket.terminate();
      sockets.clear();
      await shutdown;
    },
  };
}
