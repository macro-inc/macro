import { describe, expect, test } from 'bun:test';
import { execute, inSubprocess, type Load, resultLine } from '../code.ts';

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

describe('inSubprocess', () => {
  const succeeded = {
    kind: 'succeeded',
    output: { answer: 42 },
    logs: 'working',
  } as const;

  test('hands the runner the wake the script belongs to', async () => {
    const wakes: (string | undefined)[] = [];
    const run = inSubprocess({
      timeoutMs: 1000,
      run: async (_source, { wakeId }) => {
        wakes.push(wakeId);
        return {
          kind: 'exited',
          code: 0,
          stdout: resultLine(succeeded),
          stderr: '',
        };
      },
    });
    await run('export const main = () => 42', {
      wakeId: '0190e3b0-0000-7000-8000-000000000000',
    });
    await run('export const main = () => 42');
    expect(wakes).toEqual(['0190e3b0-0000-7000-8000-000000000000', undefined]);
  });

  test('sends the source on stdin and reads back the result the child printed', async () => {
    const sent: { source: string; timeoutMs: number }[] = [];
    const run = inSubprocess({
      timeoutMs: 1000,
      run: async (source, { timeoutMs }) => {
        sent.push({ source, timeoutMs });
        return {
          kind: 'exited',
          code: 0,
          stdout: `a stray console.log\n${resultLine(succeeded)}`,
          stderr: '',
        };
      },
    });
    expect(await run('export const main = () => 42')).toEqual({
      ...succeeded,
      logs: 'working\na stray console.log',
    });
    expect(sent).toEqual([
      { source: 'export const main = () => 42', timeoutMs: 1000 },
    ]);
  });

  test('passes on a failure the child reports', async () => {
    const failed = { kind: 'failed', error: 'broken', logs: '' } as const;
    const run = inSubprocess({
      timeoutMs: 1000,
      run: async () => ({
        kind: 'exited',
        code: 1,
        stdout: resultLine(failed),
        stderr: '',
      }),
    });
    expect(await run('source')).toEqual(failed);
  });

  test('fails a script that ran out of time', async () => {
    const run = inSubprocess({
      timeoutMs: 250,
      run: async () => ({ kind: 'timedOut', stdout: 'started', stderr: '' }),
    });
    expect(await run('source')).toEqual({
      kind: 'failed',
      error: 'the script was stopped after 250ms',
      logs: 'started',
    });
  });

  test('fails with what the child said when it printed no result', async () => {
    const run = inSubprocess({
      timeoutMs: 1000,
      run: async () => ({
        kind: 'exited',
        code: 78,
        stdout: '',
        stderr: 'AGENT_WORKSPACE is not set\n',
      }),
    });
    expect(await run('source')).toEqual({
      kind: 'failed',
      error:
        'the script process exited 78 without a result: AGENT_WORKSPACE is not set',
      logs: '',
    });
  });
});
