import { expect, test } from 'bun:test';
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

const agentWith = (query: ReturnType<typeof recording>['query']) =>
  agentClaude({
    query,
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
  });

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
