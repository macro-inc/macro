import { buildSchema, graphql } from 'graphql';
import type { SoupInput } from '../../../src/lib/service-clients/service-storage/graphql/generated/graphql';
import { accounts, EMAIL, identity, mail, USER_ID } from './mail';

const schema = buildSchema(
  await Bun.file(
    new URL('../../../../../static_assets/schema.graphql', import.meta.url)
  ).text()
);

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
export function startFixtureServer(port = 0) {
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
        nextOffset < mail.length ? `metadata-${nextOffset}` : null;
      if (nextCursor) cursors.set(nextCursor, nextOffset);
      pagesServed += 1;
      return { items: mail.slice(offset, nextOffset), nextCursor };
    }
    // This fixture has metadata, no core/shared entities or message bodies.
    if (
      operation === 'SoupBackfill' ||
      operation === 'SoupSharedMailBackfill'
    ) {
      return { items: [], nextCursor: null };
    }
    if (operation === 'Soup') {
      if (
        input.initial?.emailView !== 'INBOX' ||
        !JSON.stringify(input.initial.filters).includes('"importance":true')
      ) {
        throw new Error('Only the initial Signal view may be fetched online');
      }
      return { items: [mail[1], mail[5]], nextCursor: null };
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

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method === 'OPTIONS')
        return new Response(null, { headers: cors });
      const record: RequestRecord = { method: request.method, path };
      requests.push(record);
      try {
        if (path === '/health') return json({ ok: true });
        if (path === '/auth/user/legacy_user_permissions')
          return json(identity);
        if (path === '/auth/user/me')
          return json({ user_id: USER_ID, permissions: [] });
        if (path === '/auth/jwt/macro')
          return json({ macro_api_token: 'fixture-only' });
        if (path === '/email/links')
          return json({
            links: [
              {
                id: accounts[0].id,
                macro_id: USER_ID,
                email_address: EMAIL,
                is_primary: true,
                provider: 'GMAIL',
                is_sync_active: true,
                sync_status: 'ACTIVE',
                needs_reauth: false,
                photo_url: null,
                settings: { signature: null },
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
              },
            ],
          });
        if (path === '/dss/items/soup/graphql' && request.method === 'POST') {
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
                emailLinks: accounts,
                emailLabels: [],
                favorites: [],
                soup: ({ input }: { input: SoupInput }) =>
                  soupPage(input, operation),
              },
            },
          });
          if (result.errors)
            record.error = result.errors
              .map((error) => error.message)
              .join('; ');
          return json(result);
        }
        record.error = `Unimplemented fixture: ${request.method} ${path}`;
        return json({ error: record.error }, 501);
      } catch (error) {
        record.error = String(error);
        return json({ error: record.error }, 500);
      }
    },
  });

  return {
    origin: `http://localhost:${server.port}`,
    requests,
    get metadataPagesServed() {
      return pagesServed;
    },
    /** Closes the listener and every in-flight connection, including native
     * HTTP. The runner's network namespace has no external route to fall back to. */
    async disconnect() {
      await server.stop(true);
    },
  };
}
