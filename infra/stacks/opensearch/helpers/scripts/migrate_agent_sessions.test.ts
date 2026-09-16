import { afterEach, expect, test } from 'bun:test';
import { serve } from 'bun';
import { Client } from '@opensearch-project/opensearch';
import { AGENT_SESSIONS_ALIAS, AGENT_SESSIONS_INDEX } from '../constants';
import { INDEX_SPECS } from './create_indices';
import { migrateAgentSessions } from './migrate_agent_sessions';

const alias = AGENT_SESSIONS_ALIAS;
const index = AGENT_SESSIONS_INDEX;
const spec = INDEX_SPECS.find((entry) => entry.aliasName === alias)!;
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

// Exercise the real client against a local HTTP fixture. Every unrecognized
// request fails, including any attempt to reindex, backfill, or delete alone.
function cluster(
  options: {
    source?: 'physical' | 'missing' | 'ready' | 'unexpected';
    destination?: Record<string, unknown>;
    readStatus?: number;
    createFails?: boolean;
    healthFails?: boolean;
    swapAcknowledged?: boolean;
  } = {}
) {
  let source = options.source ?? 'physical';
  let mapping = options.destination;
  const writes: { method: string; path: string; body: unknown }[] = [];
  const unexpected: string[] = [];
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const method = request.method;
      if (options.readStatus && (method === 'GET' || method === 'HEAD')) {
        return new Response(null, { status: options.readStatus });
      }
      if (method === 'HEAD') {
        const exists =
          path === `/_alias/${alias}`
            ? source === 'ready' || source === 'unexpected'
            : path === `/${alias}`
              ? source !== 'missing'
              : path === `/${index}`
                ? mapping !== undefined
                : false;
        return new Response(null, { status: exists ? 200 : 404 });
      }
      if (method === 'GET' && path === `/_alias/${alias}`) {
        return Response.json({
          [source === 'unexpected' ? 'agent_sessions_v99' : index]: {
            aliases: { [alias]: {} },
          },
        });
      }
      if (method === 'GET' && path === `/${index}/_mapping`) {
        return Response.json({ [index]: { mappings: mapping } });
      }
      if (method === 'GET' && path === `/_cluster/health/${index}`) {
        return Response.json({
          status: options.healthFails ? 'red' : 'yellow',
          timed_out: options.healthFails ?? false,
        });
      }
      const body = await request.json();
      writes.push({ method, path, body });
      if (method === 'PUT' && path === `/${index}`) {
        if (options.createFails) {
          return Response.json({ error: 'creation failed' }, { status: 400 });
        }
        mapping = (body as { mappings: Record<string, unknown> }).mappings;
        return Response.json({ acknowledged: true });
      }
      if (method === 'POST' && path === '/_aliases') {
        source = 'ready';
        return Response.json({
          acknowledged: options.swapAcknowledged ?? true,
        });
      }
      unexpected.push(`${method} ${path}`);
      return Response.json({ error: 'Unexpected request' }, { status: 400 });
    },
  });
  const client = new Client({ node: server.url.toString(), maxRetries: 0 });
  cleanups.push(async () => {
    await client.close();
    await server.stop(true);
    expect(unexpected).toEqual([]);
  });
  return { client, writes };
}

test('dry-run prints a plan without changing the cluster', async () => {
  const { client, writes } = cluster();
  await migrateAgentSessions(client);
  expect(writes).toEqual([]);
});

test('replaces the bare index atomically, without copying any data', async () => {
  const { client, writes } = cluster();
  await migrateAgentSessions(client, false);
  expect(writes).toEqual([
    { method: 'PUT', path: `/${index}`, body: spec.body },
    {
      method: 'POST',
      path: '/_aliases',
      body: {
        actions: [
          { remove_index: { index: alias } },
          { add: { index, alias, is_write_index: true } },
        ],
      },
    },
  ]);
  // A second invocation preserves the now-live index and all new sessions.
  writes.length = 0;
  await migrateAgentSessions(client, false);
  expect(writes).toEqual([]);
});

test('fresh cluster creates the schema and alias without deleting anything', async () => {
  const { client, writes } = cluster({ source: 'missing' });
  await migrateAgentSessions(client, false);
  expect(writes[1].body).toEqual({
    actions: [{ add: { index, alias, is_write_index: true } }],
  });
});

test('resumes after destination creation without recreating it', async () => {
  const { client, writes } = cluster({
    destination: spec.body.mappings as Record<string, unknown>,
  });
  await migrateAgentSessions(client, false);
  expect(writes.map((write) => write.path)).toEqual(['/_aliases']);
});

test.each([
  'text',
  'missing',
  'wrong relation',
  'wrong alias',
  'wrong date',
])('refuses an existing destination with %s mapping', async (defect) => {
  const mapping = structuredClone(spec.body.mappings) as {
    properties: Record<string, unknown>;
  };
  if (defect === 'missing') delete mapping.properties.content;
  if (defect === 'text') {
    mapping.properties.agent_session_relation = { type: 'text' };
  }
  if (defect === 'wrong relation') {
    mapping.properties.agent_session_relation = {
      type: 'join',
      relations: { agent_session: 'other' },
    };
  }
  if (defect === 'wrong alias') {
    mapping.properties.entity_id = { type: 'alias', path: 'owner_id' };
  }
  if (defect === 'wrong date') {
    mapping.properties.created_at_millis = {
      type: 'date',
      format: 'epoch_second',
    };
  }
  const { client, writes } = cluster({ destination: mapping });
  await expect(migrateAgentSessions(client, false)).rejects.toThrow('mapping');
  expect(writes).toEqual([]);
});

test('accepts normalized default-true field parameters', async () => {
  const mapping = structuredClone(spec.body.mappings) as {
    properties: Record<string, Record<string, unknown>>;
  };
  delete mapping.properties.owner_id.index;
  delete mapping.properties.owner_id.doc_values;
  const { client, writes } = cluster({ source: 'ready', destination: mapping });
  await migrateAgentSessions(client, false);
  expect(writes).toEqual([]);
});

test('does not move an alias from an unexpected destination', async () => {
  const { client, writes } = cluster({ source: 'unexpected' });
  await expect(migrateAgentSessions(client, false)).rejects.toThrow(
    'unexpected'
  );
  expect(writes).toEqual([]);
});

test('propagates read failures rather than treating them as missing indices', async () => {
  const { client, writes } = cluster({ readStatus: 403 });
  await expect(migrateAgentSessions(client, false)).rejects.toThrow();
  expect(writes).toEqual([]);
});

test.each([
  'createFails',
  'healthFails',
] as const)('%s leaves the old index intact', async (failure) => {
  const { client, writes } = cluster({ [failure]: true });
  await expect(migrateAgentSessions(client, false)).rejects.toThrow();
  expect(writes.map((write) => write.path)).toEqual([`/${index}`]);
});

test('reports an unacknowledged cutover as a failure', async () => {
  const { client } = cluster({ swapAcknowledged: false });
  await expect(migrateAgentSessions(client, false)).rejects.toThrow(
    'acknowledged'
  );
});
