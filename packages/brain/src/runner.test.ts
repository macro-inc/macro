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

test('an SDK that absorbs a follow-up cannot leave input open forever', async () => {
  let promptIterator: AsyncIterator<SDKUserMessage>;
  const ready = Promise.withResolvers<void>();
  const inspect = Promise.withResolvers<void>();
  let eager = false;
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    query: ({ prompt }) =>
      (async function* () {
        promptIterator = prompt[Symbol.asyncIterator]();
        await promptIterator.next();
        ready.resolve();
        await inspect.promise;
        const next = promptIterator.next();
        let received = false;
        void next.then((item) => {
          received = !item.done;
        });
        await Promise.resolve();
        eager = received;
        yield result('first done', 1);
        const followup = await next;
        if (!followup.done) yield result('follow-up done', 2);
        await promptIterator.next();
      })(),
  });
  const run = runner.start(TURN);
  await ready.promise;
  run.inject('follow-up while working');
  inspect.resolve();
  await run.done;
  assert.equal(
    eager,
    false,
    'input must not deliver a follow-up before the result'
  );
});

test('inactivity timeout closes a stuck SDK even when it ignores abort', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  let closed = 0;
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    query: ({ options }) => {
      options.abortController?.signal.addEventListener('abort', () => {
        aborted = true;
      });
      return {
        close: () => {
          closed++;
        },
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
      };
    },
  });
  const run = runner.start({
    ...TURN,
    timeout: { wallClockMs: 1000, inactivityMs: 100 },
  });
  t.mock.timers.tick(50);
  run.inject('follow-up must not prolong inactivity');
  t.mock.timers.tick(50);
  const outcome = await run.done;
  assert.equal(outcome.status, 'aborted');
  assert.equal(
    outcome.result,
    'Work stopped after no SDK activity for 100 ms.'
  );
  assert.equal(outcome.costIncomplete, true);
  assert.equal(aborted, true);
  assert.equal(closed, 1);
  assert.deepEqual(await Array.fromAsync(run.events), []);
  assert.throws(() => run.inject('too late'), /finished/);
});

test('wall-clock timeout bounds a run that keeps producing SDK activity', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const messages = new (await import('./channel.ts')).AsyncQueue<SDKMessage>();
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    query: () => messages,
  });
  const run = runner.start({
    ...TURN,
    timeout: { wallClockMs: 1000, inactivityMs: 600 },
  });
  t.mock.timers.tick(500);
  messages.push({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'working' }] },
  } as unknown as SDKMessage);
  // Consume the event as a synchronization point after resetting inactivity.
  await run.events[Symbol.asyncIterator]().next();
  t.mock.timers.tick(500);
  const outcome = await run.done;
  assert.equal(outcome.status, 'aborted');
  assert.match(outcome.result, /wall-clock limit/);
});

test('manual abort settles even when SDK iteration and close do not cooperate', async () => {
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    query: () => ({
      close() {
        throw new Error('close failed');
      },
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    }),
  });
  const run = runner.start(TURN);
  run.abort();
  assert.equal((await run.done).status, 'aborted');
});

test('timeout bounds reject values that Node would silently clamp', () => {
  const runner = new AgentSdkRunner({
    ...RUNNER_OPTIONS,
    query: () => {
      throw new Error('must not start');
    },
  });
  for (const wallClockMs of [0, -1, 1.5, 2147483648]) {
    assert.throws(
      () =>
        runner.start({ ...TURN, timeout: { wallClockMs, inactivityMs: 100 } }),
      /turn timeouts/
    );
  }
});
