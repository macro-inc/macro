import { describe, expect, test } from 'bun:test';
import { execute, type Load } from '../code.ts';

const context = { greeting: 'hello' };

/** Loads `module` for every script, as a `Load` that found no type errors would. */
const loading =
  (module: unknown): Load =>
  async () => ({ kind: 'loaded', module });

describe('execute', () => {
  test('runs main with the live context, returning its output and logs', async () => {
    const run = execute(
      context,
      loading({
        main: ({
          context: given,
          log,
        }: {
          context: typeof context;
          log: (...values: unknown[]) => void;
        }) => {
          log('working', { on: 1 });
          return { said: `${given.greeting}, muppet`, same: given };
        },
      })
    );
    expect(await run('source')).toEqual({
      kind: 'succeeded',
      output: { said: 'hello, muppet', same: context },
      logs: 'working {"on":1}',
    });
  });

  test("doesn't run a script that doesn't type-check, and reports its errors", async () => {
    const run = execute(context, async () => ({
      kind: 'rejected',
      errors: 'script.ts(1,1): error TS2322: no',
    }));
    expect(await run('source')).toEqual({
      kind: 'failed',
      error:
        "the script doesn't type-check, so it wasn't run:\nscript.ts(1,1): error TS2322: no",
      logs: '',
    });
  });

  test('reports an error thrown by the script, with what it logged first', async () => {
    const run = execute(
      context,
      loading({
        main: ({ log }: { log: (text: string) => void }) => {
          log('before');
          throw new Error('broken');
        },
      })
    );
    const executed = await run('source');
    expect(executed).toMatchObject({ kind: 'failed', logs: 'before' });
    expect(executed.kind === 'failed' && executed.error).toContain('broken');
  });

  test('reports a load that throws', async () => {
    const run = execute(context, async () => {
      throw new Error("can't load");
    });
    expect((await run('source')).kind).toBe('failed');
  });

  test('reports a script without main', async () => {
    expect(await execute(context, loading({ x: 1 }))('source')).toMatchObject({
      kind: 'failed',
      error: 'the script must export `async function main({ context, log })`',
    });
  });
});
