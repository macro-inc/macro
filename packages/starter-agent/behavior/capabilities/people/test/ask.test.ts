import { expect, test } from 'bun:test';
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { sdkAsk } from '../ask.ts';

/** A `query` that records its options and answers once, at a cost. */
const answering = () => {
  const calls: Options[] = [];
  return {
    calls,
    query: (params: {
      readonly prompt: string;
      readonly options?: Options;
    }) => {
      calls.push(params.options ?? {});
      return (async function* (): AsyncGenerator<SDKMessage, void> {
        // Only the fields the ask reads; the SDK's result carries many more.
        yield {
          type: 'result',
          subtype: 'success',
          result: 'a fair read',
          total_cost_usd: 0.02,
          session_id: 'session-1',
        } as unknown as SDKMessage;
      })();
    },
  };
};

test('an appraisal runs the computer’s Claude Code, the way a wake does, and its cost counts toward the day', async () => {
  const fake = answering();
  const spawned: (readonly string[])[] = [];
  const spent: object[] = [];
  const ask = sdkAsk({
    query: fake.query,
    defaultModel: 'claude-haiku',
    claude: {
      executable: () => '/run/current-system/sw/bin/claude',
      environment: async () => ({
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:41234/anthropic',
      }),
      sandbox: {
        argv: ['bwrap', '--tmpfs', '/run/credentials/x', '--'],
        spawn: (argv) => {
          spawned.push(argv);
          return {} as never;
        },
      },
      spend: async (entry) => {
        spent.push(entry);
      },
    },
  });

  expect(await ask('Is this person helpful?')).toBe('a fair read');
  const [options] = fake.calls;
  expect(options?.pathToClaudeCodeExecutable).toBe(
    '/run/current-system/sw/bin/claude'
  );
  expect(options?.env).toEqual({
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:41234/anthropic',
  });
  expect(options?.tools).toEqual([]);
  options?.spawnClaudeCodeProcess?.({
    command: '/run/current-system/sw/bin/claude',
    args: ['--print'],
    env: {},
    signal: new AbortController().signal,
  });
  expect(spawned).toEqual([
    [
      'bwrap',
      '--tmpfs',
      '/run/credentials/x',
      '--',
      '/run/current-system/sw/bin/claude',
      '--print',
    ],
  ]);
  expect(spent).toEqual([
    { event: 'people.ask', cost_usd: 0.02, session_id: 'session-1' },
  ]);
});

test('off a computer, Claude Code starts as usual', async () => {
  const fake = answering();
  const ask = sdkAsk({
    query: fake.query,
    defaultModel: 'claude-haiku',
    claude: {
      executable: () => '/usr/bin/claude',
      environment: async () => ({}),
      sandbox: { argv: [], spawn: () => ({}) as never },
      spend: async () => {},
    },
  });
  await ask('?');
  expect(fake.calls[0]?.spawnClaudeCodeProcess).toBeUndefined();
});
