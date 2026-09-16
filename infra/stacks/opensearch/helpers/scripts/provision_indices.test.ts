import { afterEach, expect, test } from 'bun:test';
import { serve, spawn } from 'bun';
import { INDEX_SPECS } from './create_indices';

const spec = INDEX_SPECS.find(
  ({ aliasName }) => aliasName === 'agent_sessions'
)!;
const alias = spec.aliasName;
const index = spec.indexName;
const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

// Run the same CLI chain as deployment against an HTTP fixture. In particular,
// verify exit codes: a logged error must not allow the next deployment step.
function cluster(
  options: {
    source?: 'missing' | 'physical' | 'ready' | 'unexpected';
    mapping?: Record<string, unknown>;
    readStatus?: number;
    aliasReadStatus?: number;
    writeIndex?: boolean;
    acknowledged?: boolean;
    createFails?: boolean;
  } = {}
) {
  let source = options.source ?? 'missing';
  let mapping = options.mapping;
  const writes: string[] = [];
  const server = serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const method = request.method;
      if (options.readStatus && (method === 'HEAD' || method === 'GET')) {
        return new Response(null, { status: options.readStatus });
      }
      if (method === 'HEAD') {
        const exists =
          path === `/${index}`
            ? mapping !== undefined
            : path === `/${alias}`
              ? source !== 'missing'
              : path === `/_alias/${alias}`
                ? source === 'ready' || source === 'unexpected'
                : path === `/${index}/_alias/${alias}`
                  ? source === 'ready'
                  : false;
        return new Response(null, { status: exists ? 200 : 404 });
      }
      if (method === 'GET' && path === `/_alias/${alias}`) {
        if (options.aliasReadStatus)
          return new Response(null, { status: options.aliasReadStatus });
        if (source === 'missing' || source === 'physical') {
          return Response.json({ error: 'alias missing' }, { status: 404 });
        }
        return Response.json({
          [source === 'unexpected' ? 'agent_sessions_v99' : index]: {
            aliases: { [alias]: { is_write_index: options.writeIndex } },
          },
        });
      }
      if (method === 'GET' && path === `/${index}/_mapping`) {
        return mapping
          ? Response.json({ [index]: { mappings: mapping } })
          : Response.json({ error: 'index missing' }, { status: 404 });
      }
      writes.push(`${method} ${path}`);
      if (method === 'PUT' && path === `/${index}`) {
        if (options.createFails)
          return Response.json({ error: 'creation failed' }, { status: 400 });
        const body = await request.json();
        mapping = body.mappings;
        if (body.aliases?.[alias]) source = 'ready';
        return Response.json({ acknowledged: options.acknowledged ?? true });
      }
      if (method === 'POST' && path === `/${index}/_mapping`) {
        const body = await request.json();
        mapping = {
          ...mapping,
          properties: {
            ...(mapping?.properties as object),
            ...body.properties,
          },
        };
        return Response.json({ acknowledged: options.acknowledged ?? true });
      }
      if (method === 'PUT' && path === `/${index}/_alias/${alias}`) {
        source = 'ready';
        return Response.json({ acknowledged: options.acknowledged ?? true });
      }
      return Response.json(
        { error: `Unexpected ${method} ${path}` },
        { status: 400 }
      );
    },
  });
  cleanups.push(() => server.stop(true));

  async function run(script: string, extraEnv: Record<string, string> = {}) {
    const child = spawn([process.execPath, `${import.meta.dir}/${script}.ts`], {
      env: {
        ...process.env,
        ENVIRONMENT: 'dev',
        OPENSEARCH_URL: server.url.toString(),
        OPENSEARCH_USERNAME: 'fixture',
        OPENSEARCH_PASSWORD: 'fixture-secret',
        INDEX: alias,
        DRY_RUN: 'false',
        ...extraEnv,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(stderr).not.toContain('fixture-secret');
    return { code, output: stdout + stderr };
  }
  async function provision() {
    for (const script of [
      'create_indices',
      'verify_mappings',
      'verify_aliases',
    ]) {
      const result = await run(script);
      if (result.code !== 0) return { ...result, script };
    }
    return { code: 0, script: 'complete', output: '' };
  }
  return { run, provision, writes };
}

function canonicalMapping() {
  return structuredClone(spec.body.mappings) as {
    dynamic: string | boolean;
    properties: Record<string, Record<string, unknown>>;
  };
}

test('deployment provisions a fresh alias and is idempotent', async () => {
  const { provision, writes } = cluster();
  expect(await provision()).toMatchObject({ code: 0 });
  expect(writes).toEqual([`PUT /${index}`]);
  writes.length = 0;
  expect(await provision()).toMatchObject({ code: 0 });
  expect(writes).toEqual([]);
});

test('dry-run does not provision anything', async () => {
  const { run, writes } = cluster();
  expect((await run('create_indices', { DRY_RUN: 'true' })).code).toBe(0);
  expect(writes).toEqual([]);
});

test('adds a missing field to an existing index before passing the gate', async () => {
  const mapping = canonicalMapping();
  delete mapping.properties.content;
  const { provision, writes } = cluster({ source: 'ready', mapping });
  expect(await provision()).toMatchObject({ code: 0 });
  expect(writes).toEqual([`POST /${index}/_mapping`]);
});

test.each([
  'physical',
  'unexpected',
] as const)('blocks %s alias state without swapping or deleting', async (source) => {
  const { provision, writes } = cluster({ source });
  const result = await provision();
  expect(result.code).not.toBe(0);
  expect(result.script).toBe('verify_aliases');
  expect(writes).toEqual([`PUT /${index}`]);
});

test('rejects conflicting types before applying additive changes', async () => {
  const mapping = canonicalMapping();
  mapping.properties.agent_session_relation = { type: 'text' };
  delete mapping.properties.content;
  const { provision, writes } = cluster({ source: 'ready', mapping });
  const result = await provision();
  expect(result.code).not.toBe(0);
  expect(result.script).toBe('create_indices');
  expect(writes).toEqual([]);
});

test.each([
  'relation',
  'alias path',
  'date format',
  'dynamic',
])('rejects incompatible %s parameters', async (defect) => {
  const mapping = canonicalMapping();
  if (defect === 'relation')
    mapping.properties.agent_session_relation.relations = {
      agent_session: 'wrong',
    };
  if (defect === 'alias path') mapping.properties.entity_id.path = 'owner_id';
  if (defect === 'date format')
    mapping.properties.created_at_millis.format = 'epoch_second';
  if (defect === 'dynamic') mapping.dynamic = true;
  const { provision, writes } = cluster({ source: 'ready', mapping });
  const result = await provision();
  expect(result.code).not.toBe(0);
  expect(result.script).toBe('verify_mappings');
  expect(writes).toEqual([]);
});

test('accepts normalized default parameters and boolean dynamic', async () => {
  const mapping = canonicalMapping();
  delete mapping.properties.owner_id.index;
  delete mapping.properties.owner_id.doc_values;
  mapping.dynamic = false;
  expect((await cluster({ source: 'ready', mapping }).provision()).code).toBe(
    0
  );
});

test('rejects a non-writable alias', async () => {
  const result = await cluster({
    source: 'ready',
    mapping: canonicalMapping(),
    writeIndex: false,
  }).provision();
  expect(result.code).not.toBe(0);
  expect(result.script).toBe('verify_aliases');
});

test('never attaches an existing incompatible index to a missing alias', async () => {
  const mapping = canonicalMapping();
  mapping.properties.agent_session_relation.relations = {
    agent_session: 'wrong',
  };
  const { provision, writes } = cluster({ mapping });
  expect((await provision()).code).not.toBe(0);
  expect(writes).toEqual([]);
});

test('attaches a compatible existing destination to a missing alias', async () => {
  const { provision, writes } = cluster({ mapping: canonicalMapping() });
  expect(await provision()).toMatchObject({ code: 0 });
  expect(writes).toEqual([`PUT /${index}/_alias/${alias}`]);
});

test.each([
  { readStatus: 403 },
  { aliasReadStatus: 403 },
])('read failures never masquerade as a missing index', async (options) => {
  const { provision, writes } = cluster(options);
  expect((await provision()).code).not.toBe(0);
  expect(writes).toEqual([]);
});

test.each([
  { createFails: true },
  { acknowledged: false },
])('creation failures fail deployment', async (options) => {
  const result = await cluster(options).provision();
  expect(result.code).not.toBe(0);
  expect(result.script).toBe('create_indices');
});

test.each([
  'create_indices',
  'verify_mappings',
  'verify_aliases',
])('%s rejects unknown INDEX', async (script) => {
  const { run, writes } = cluster();
  expect((await run(script, { INDEX: 'typo' })).code).not.toBe(0);
  expect(writes).toEqual([]);
});
