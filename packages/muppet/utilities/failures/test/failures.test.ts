import { describe, expect, test } from 'bun:test';
import type { WakeContext, Woke } from '../../../core/agent.ts';
import { behavior } from '../../../core/behavior.ts';
import { source } from '../../../core/event.ts';
import type { Files, StatePaths } from '../../../core/state.ts';
import { simple } from '../../../runtimes/simple.ts';
import { scripts } from '../../../runtimes/test/scripts.ts';
import { failureLog, recentFailures } from '../index.ts';

const memoryFiles = (): Files & { readonly all: Map<string, string> } => {
  const all = new Map<string, string>();
  return {
    all,
    read: async (path) => all.get(path),
    write: async (path, text) => {
      all.set(path, text);
    },
  };
};

const state: StatePaths = {
  shared: '/state/shared',
  capability: (name) => `/state/capabilities/${name}`,
};

const clock = {
  now: () => Temporal.Instant.from('2026-11-10T09:00:00Z'),
  sleep: async () => {},
};

async function* numbers() {
  yield 1;
  yield 2;
  yield 3;
}

describe('failureLog', () => {
  test('logs failed handlers and wakes to state, readable by recentFailures', async () => {
    const files = memoryFiles();
    const context = { state, files, clock };

    await behavior()
      .decorate({
        ...context,
        agent: {
          wake: async ({ request }: WakeContext): Promise<Woke> =>
            request === 'n 3'
              ? { kind: 'failed', error: 'out of budget' }
              : { kind: 'done', reply: 'ok' },
        },
      })
      .use(failureLog())
      .source({ numbers: source(numbers()) })
      .on(
        (sources) => sources.numbers,
        async (n, { wake }) => {
          if (n === 2) throw new Error('two');
          await wake(`n ${n}`);
        }
      )
      .run(simple({ systemPrompt: '', ...scripts() }));

    expect([...files.all.keys()]).toEqual([
      '/state/capabilities/failures/failures.jsonl',
    ]);
    const logged = await recentFailures(context, { count: 10 });
    expect(
      logged.map(({ error, ...rest }) => ({
        ...rest,
        error: error.split('\n')[0],
      }))
    ).toEqual([
      {
        at: '2026-11-10T09:00:00Z',
        kind: 'handler',
        event: 'numbers',
        error: 'Error: two',
      },
      {
        at: '2026-11-10T09:00:00Z',
        kind: 'wake',
        event: 'numbers',
        request: 'n 3',
        error: 'out of budget',
      },
    ]);
    expect(await recentFailures(context, { count: 1 })).toHaveLength(1);
  });

  test('keeps every failure that happens at once', async () => {
    const files = memoryFiles();
    const context = { state, files, clock };
    await behavior()
      .decorate({
        ...context,
        agent: {
          wake: async (): Promise<Woke> => ({ kind: 'done', reply: 'ok' }),
        },
      })
      .use(failureLog())
      .source({ a: source(numbers()), b: source(numbers()) })
      .on(
        (sources) => sources.a,
        async () => {
          throw new Error('a');
        }
      )
      .on(
        (sources) => sources.b,
        async () => {
          throw new Error('b');
        }
      )
      .run(simple({ systemPrompt: '', ...scripts() }));

    expect(await recentFailures(context, { count: 100 })).toHaveLength(6);
  });
});
