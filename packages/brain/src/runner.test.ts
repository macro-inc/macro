import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  Options,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { AgentSdkRunner, type RunEvent } from './runner.ts';

const TURN = {
  id: 'work-task-1',
  tier: 'work' as const,
  prompt: 'fix the March invoice',
  system: 'You are Ada.',
  cwd: '/home/ada/workspace/work/task-1',
  model: 'claude-opus-5-5',
  maxBudgetUsd: 20,
  env: { BRAIN_TURN_ID: 'work-task-1' },
};
const result = (text: string, cost: number) =>
  ({
    type: 'result',
    subtype: 'success',
    result: text,
    total_cost_usd: cost,
    session_id: 'session-1',
    usage: { input_tokens: 12, output_tokens: 4 },
  }) as SDKMessage;
const RUNNER_OPTIONS = {
  claudeExecutable: 'claude',
  anthropicBaseUrl: 'https://gateway.example/anthropic',
  anthropicAuthToken: 'gateway-token',
  claudeConfigDir: '/home/ada/workspace/cache/claude',
  baseEnv: { PATH: '/usr/bin', HOME: '/home/ada' },
};
test('an injected message joins the running session and the input closes after its result', async () => {
  const prompts: string[] = [];
  let options: Options | undefined;
  const injected = Promise.withResolvers<void>();
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    query: (params) => {
      options = params.options;
      return (async function* () {
        for await (const message of params.prompt as AsyncIterable<SDKUserMessage>) {
          prompts.push(message.message.content as string);
          if (prompts.length === 1) {
            yield {
              type: 'assistant',
              message: { content: [{ type: 'text', text: 'on it' }] },
            } as unknown as SDKMessage;
            await injected.promise;
            yield result('first done', 0.5);
          } else {
            yield result('fixed, and used the new rate', 1.75);
          }
        }
      })();
    },
  });
  assert.equal(JSON.stringify(runner).includes('gateway-token'), false);
  const run = runner.start(TURN);
  run.inject('also use the new rate');
  injected.resolve();
  const outcome = await run.done;
  const events: RunEvent[] = await Array.fromAsync(run.events);
  assert.deepEqual(prompts, ['fix the March invoice', 'also use the new rate']);
  assert.deepEqual(outcome, {
    status: 'success',
    result: 'fixed, and used the new rate',
    costUsd: 1.75,
    sessionId: 'session-1',
  });
  assert.deepEqual(events[0], { kind: 'text', text: 'on it' });
  assert.deepEqual(options?.cwd, '/home/ada/workspace/work/task-1');
  assert.deepEqual(options?.maxBudgetUsd, 20);
  assert.deepEqual(options?.env, {
    PATH: '/usr/bin',
    HOME: '/home/ada',
    BRAIN_TURN_ID: 'work-task-1',
    ANTHROPIC_BASE_URL: 'https://gateway.example/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'gateway-token',
    CLAUDE_CONFIG_DIR: '/home/ada/workspace/cache/claude',
  });
});
test('abort stops the run and reports it aborted', async () => {
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    query: (params) =>
      (async function* () {
        const aborted = Promise.withResolvers<void>();
        params.options.abortController?.signal.addEventListener('abort', () =>
          aborted.resolve()
        );
        await aborted.promise;
        throw new Error('Claude Code process aborted by user');
      })(),
  });
  const run = runner.start(TURN);
  run.abort();
  const outcome = await run.done;
  assert.deepEqual(outcome.status, 'aborted');
});
test('composition tools are exposed through a real in-process MCP server', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import(
    '@modelcontextprotocol/sdk/inMemory.js'
  );
  const { tool } = await import('@anthropic-ai/claude-agent-sdk');
  const { z } = await import('zod');
  let server:
    | import('@anthropic-ai/claude-agent-sdk').McpSdkServerConfigWithInstance
    | undefined;
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    query(params) {
      const configured = params.options.mcpServers?.brain;
      if (configured?.type === 'sdk') server = configured;
      return (async function* () {
        yield result('done', 0);
      })();
    },
  });
  const run = runner.start({
    ...TURN,
    tools: [
      tool(
        'echo',
        'Echo a value',
        { value: z.string() },
        async ({ value }) => ({
          content: [{ type: 'text', text: `echo:${value}` }],
        })
      ),
    ],
  });
  if (!server) throw new Error('in-process MCP server was not supplied');
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    await server.instance.connect(serverTransport);
    await client.connect(clientTransport);
    const response = await client.callTool({
      name: 'echo',
      arguments: { value: 'release' },
    });
    assert.deepEqual(response.content, [
      { type: 'text', text: 'echo:release' },
    ]);
    await run.done;
  } finally {
    await client.close();
    await server.instance.close();
  }
});

test('classification turns disable built-ins and ignore workspace MCP configuration', async () => {
  let options: Options | undefined;
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    macroTools: async () => {
      throw new Error('triage must not connect to Macro MCP');
    },
    query: (params) => {
      options = params.options;
      return (async function* () {
        yield result('IGNORE', 0.01);
      })();
    },
  });
  await runner.start({
    ...TURN,
    tier: 'triage',
    tools: [],
    builtinTools: [],
    strictMcpConfig: true,
  }).done;
  assert.deepEqual(options?.tools, []);
  assert.equal(options?.strictMcpConfig, true);
  assert.equal(options?.mcpServers, undefined);
});

test('respond receives the full SDK tools through the brain without exposing its key to the turn', async () => {
  const { createServer } = await import('node:http');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { InMemoryTransport } = await import(
    '@modelcontextprotocol/sdk/inMemory.js'
  );
  const { MacroCodeMode } = await import('./code-mode.ts');
  let advertiseCode = true;
  let expectedPath = '/mcp/mcp';
  const seen: { method: string; key: string | undefined; params: unknown }[] =
    [];
  const endpoint = createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    assert.equal(request.url, expectedPath);
    const body = JSON.parse(
      Buffer.concat(await Array.fromAsync(request)).toString()
    );
    seen.push({
      method: body.method,
      key: request.headers['x-macro-user-api-key']?.toString(),
      params: body.params,
    });
    response.setHeader('content-type', 'application/json');
    if (!('id' in body)) {
      response.writeHead(202).end();
      return;
    }
    const result =
      body.method === 'initialize'
        ? {
            protocolVersion: '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: 'macro-fixture', version: '1' },
          }
        : body.method === 'tools/list'
          ? {
              tools: advertiseCode
                ? [
                    {
                      name: 'ExecuteCode',
                      description: 'Run the server SDK',
                      inputSchema: {
                        type: 'object',
                        properties: { source: { type: 'string' } },
                        required: ['source'],
                      },
                    },
                    {
                      name: 'DescribeCodeTools',
                      description: 'Discover server SDK tools',
                      inputSchema: {
                        type: 'object',
                        properties: { task: { type: 'string' } },
                      },
                    },
                    {
                      name: 'ReadCodeDocs',
                      description: 'Read server SDK docs',
                      inputSchema: {
                        type: 'object',
                        properties: {
                          symbols: { type: 'array', items: { type: 'string' } },
                        },
                        required: ['symbols'],
                      },
                    },
                  ]
                : [],
            }
          : { content: [{ type: 'text', text: 'created-channel-42' }] };
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  await new Promise<void>((resolve) =>
    endpoint.listen(0, '127.0.0.1', resolve)
  );
  const address = endpoint.address();
  assert.ok(address && typeof address !== 'string');
  const parsedConfig = {
    hosts: { mcp: `http://127.0.0.1:${address.port}/mcp` },
    macroApiKey: 'fixture-agent-key',
  };
  const bridge = new MacroCodeMode(parsedConfig);
  let calls = 0;
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    baseEnv: {
      ...RUNNER_OPTIONS.baseEnv,
      MACRO_API_KEY: 'fixture-agent-key',
      OVERRIDE_MCP_SERVICE_URL: parsedConfig.hosts.mcp,
    },
    macroTools: (signal) => bridge.connect(signal),
    query(params) {
      return (async function* () {
        assert.equal(params.options.env?.MACRO_API_KEY, undefined);
        assert.equal(params.options.env?.OVERRIDE_MCP_SERVICE_URL, undefined);
        assert.equal(
          JSON.stringify(params.options.env).includes('fixture-agent-key'),
          false
        );
        const server = params.options.mcpServers?.brain;
        assert.ok(server?.type === 'sdk');
        const [clientTransport, serverTransport] =
          InMemoryTransport.createLinkedPair();
        const client = new Client({ name: 'turn', version: '1' });
        try {
          await server.instance.connect(serverTransport);
          await client.connect(clientTransport);
          const listed = await client.listTools();
          assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
            'DescribeCodeTools',
            'ExecuteCode',
            'ReadCodeDocs',
          ]);
          assert.equal(
            listed.tools.find((tool) => tool.name === 'ExecuteCode')
              ?.description,
            'Run the server SDK'
          );
          const answer = await client.callTool({
            name: 'ExecuteCode',
            arguments: {
              source:
                'export async function main({macro}) { return {data: await macro.channels.create({name: "launch"})}; }',
            },
          });
          assert.deepEqual(answer.content, [
            { type: 'text', text: 'created-channel-42' },
          ]);
          calls++;
        } finally {
          await client.close();
          await server.instance.close();
        }
        yield result('done', 0);
      })();
    },
  });
  try {
    assert.equal(
      (await runner.start({ ...TURN, tier: 'respond' }).done).status,
      'success'
    );
    assert.equal(calls, 1);
    assert.equal(
      (await runner.start({ ...TURN, tier: 'heartbeat' }).done).status,
      'success'
    );
    assert.equal(
      (await runner.start({ ...TURN, tier: 'work' }).done).status,
      'success'
    );
    assert.equal(calls, 3);
    advertiseCode = false;
    const unavailable = await runner.start({ ...TURN, tier: 'respond' }).done;
    assert.equal(unavailable.status, 'error');
    assert.match(unavailable.result, /Macro code mode unavailable/);
    assert.equal(unavailable.result.includes('fixture-agent-key'), false);
    assert.equal(calls, 3);
    advertiseCode = true;
    expectedPath = '/mcp';
    const localBridge = new MacroCodeMode({
      hosts: { mcp: `http://127.0.0.1:${address.port}` },
      macroApiKey: 'fixture-agent-key',
    });
    const local = await localBridge.connect(new AbortController().signal);
    try {
      assert.deepEqual(
        local.tools.map((tool) => tool.name),
        ['ExecuteCode', 'DescribeCodeTools', 'ReadCodeDocs']
      );
    } finally {
      await local.close();
    }

    assert.ok(seen.every((request) => request.key === 'fixture-agent-key'));
    assert.deepEqual(
      seen
        .filter((request) => request.method === 'tools/call')
        .slice(0, 1)
        .map((request) => request.params),
      [
        {
          name: 'ExecuteCode',
          arguments: {
            source:
              'export async function main({macro}) { return {data: await macro.channels.create({name: "launch"})}; }',
          },
        },
      ]
    );
  } finally {
    endpoint.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      endpoint.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
