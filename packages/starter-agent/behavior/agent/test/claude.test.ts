import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { agentClaude, capabilityServer } from '../claude.ts';

const wake = {
  request: 'say hello',
  systemPrompt: 'You are an agent.',
  event: { name: 'conversations', payload: {} },
  state: {
    code: {
      catalog: '',
      script: { file: '/w/behavior/index.ts', name: 'Script' },
      describe: async () => '',
      execute: async () => ({
        kind: 'succeeded' as const,
        output: 1,
        logs: '',
      }),
    },
  },
};

/** A `query` that records its options and ends without a result. */
const recording = () => {
  const calls: Options[] = [];
  return {
    calls,
    query: (params: {
      readonly prompt: string;
      readonly options?: Options;
    }) => {
      calls.push(params.options ?? {});
      return (async function* (): AsyncGenerator<SDKMessage, void> {})();
    },
  };
};

const computer = {
  type: 'stdio' as const,
  command: '/bin/computer-use-linux',
  args: ['--display', ':1'],
  env: { DISPLAY: ':1' },
};

const agentOptions: Omit<Parameters<typeof agentClaude>[0], 'query'> = {
  claude: () => '/run/current-system/sw/bin/claude',
  mcpServers: { computer },
  model: 'claude-test',
  profile: () => ({
    budgetUsd: 1,
    timeoutMs: 60_000,
    cwd: '/w',
    directories: [],
  }),
  environment: async () => ({
    PATH: '/bin',
    ANTHROPIC_BASE_URL: 'https://egress/brain/anthropic',
    GH_TOKEN: undefined,
  }),
  after: () => () => undefined,
  guards: [],
  record: async () => undefined,
  wakeId: () => '0190e3b0-0000-7000-8000-00000000000f',
};

const agentWith = (query: ReturnType<typeof recording>['query']) =>
  agentClaude({ ...agentOptions, query });

/** A process that never says anything: the test only looks at how it was spawned. */
const fakeProcess = {
  stdin: new PassThrough(),
  stdout: new PassThrough(),
  killed: false,
  exitCode: null,
  kill: () => true,
  on: () => undefined,
  once: () => undefined,
  off: () => undefined,
};

test('every wake has its capability tools beside the MCP servers it was given, and runs claude from PATH', async () => {
  const fake = recording();
  expect(await agentWith(fake.query).wake(wake)).toEqual({
    kind: 'failed',
    error: 'session ended without a result',
  });
  const [options] = fake.calls;
  expect(Object.keys(options?.mcpServers ?? {}).sort()).toEqual(
    [capabilityServer, 'computer'].sort()
  );
  expect(options?.mcpServers?.computer).toEqual(computer);
  expect(options?.pathToClaudeCodeExecutable).toBe(
    '/run/current-system/sw/bin/claude'
  );
  expect(options?.env).toEqual({
    PATH: '/bin',
    ANTHROPIC_BASE_URL: 'https://egress/brain/anthropic',
  });
  expect(options?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
});

test("its tools are named so they never collide with Macro's own MCP tools", async () => {
  const fake = recording();
  await agentWith(fake.query).wake(wake);
  const server = fake.calls[0]?.mcpServers?.[capabilityServer];
  const names =
    server !== undefined && 'instance' in server
      ? JSON.stringify(
          Object.keys(Reflect.get(server.instance, '_registeredTools') ?? {})
        )
      : '';
  expect(names).toContain('RunCapabilityScript');
  expect(names).toContain('DescribeCapabilities');
  for (const taken of ['ExecuteCode', 'DescribeCodeTools', 'ReadCodeDocs'])
    expect(names).not.toContain(taken);
});

test('on a computer, Claude Code is spawned through the sandbox the agent was started with', async () => {
  const fake = recording();
  const spawned: { command: string; args: readonly string[] }[] = [];
  const agent = agentClaude({
    ...agentOptions,
    query: fake.query,
    sandbox: {
      argv: ['bwrap', '--tmpfs', '/run/credentials/x', '--'],
      spawn: (argv) => {
        spawned.push({ command: argv[0] ?? '', args: argv.slice(1) });
        return fakeProcess;
      },
    },
  });
  await agent.wake(wake);
  const spawn = fake.calls[0]?.spawnClaudeCodeProcess;
  spawn?.({
    command: '/run/current-system/sw/bin/claude',
    args: ['--print'],
    env: {},
    signal: new AbortController().signal,
  });
  expect(spawned).toEqual([
    {
      command: 'bwrap',
      args: [
        '--tmpfs',
        '/run/credentials/x',
        '--',
        '/run/current-system/sw/bin/claude',
        '--print',
      ],
    },
  ]);
});

test('with no sandbox, the SDK spawns Claude Code itself', async () => {
  const fake = recording();
  await agentWith(fake.query).wake(wake);
  expect(fake.calls[0]?.spawnClaudeCodeProcess).toBeUndefined();
});

test('a wake has one id, which its scripts carry, and one span that records how it went', async () => {
  const fake = recording();
  const executed: (string | undefined)[] = [];
  const spans: { name: string; attributes: Record<string, unknown> }[] = [];
  const agent = agentClaude({
    ...agentOptions,
    query: fake.query,
    wakeId: () => '0190e3b0-0000-7000-8000-000000000001',
    trace: async (name, run) => {
      const attributes: Record<string, unknown> = {};
      spans.push({ name, attributes });
      return run({
        set: (key, value) => {
          attributes[key] = value;
        },
        traceparent: () => undefined,
      });
    },
  });
  await agent.wake({
    ...wake,
    state: {
      code: {
        ...wake.state.code,
        execute: async (_source, options) => {
          executed.push(options?.wakeId);
          return { kind: 'succeeded' as const, output: 1, logs: '' };
        },
      },
    },
  });
  const server = fake.calls[0]?.mcpServers?.[capabilityServer];
  const tools =
    server !== undefined && 'instance' in server
      ? Reflect.get(server.instance, '_registeredTools')
      : undefined;
  const run = Reflect.get(tools ?? {}, 'RunCapabilityScript');
  const handler = Reflect.get(run ?? {}, 'handler');
  if (typeof handler === 'function')
    await handler({ source: 'export const main = () => 1' }, {});
  expect(executed).toEqual(['0190e3b0-0000-7000-8000-000000000001']);
  expect(spans).toEqual([
    {
      name: 'agent.wake',
      attributes: {
        'agent.event': 'conversations',
        'agent.wake_id': '0190e3b0-0000-7000-8000-000000000001',
        'agent.outcome': 'failed',
      },
    },
  ]);
});
