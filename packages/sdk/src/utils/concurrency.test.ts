import { expect, test } from 'bun:test';
import { callLimit, limitCalls } from './concurrency';

function deferred() {
  let resolve: () => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** An SDK whose calls start, log, and finish only when the test says. */
function heldSdk(calls: number) {
  const log: string[] = [];
  const gates = Array.from({ length: calls }, deferred);
  const started = Array.from({ length: calls }, deferred);
  const sdk = {
    async call(index: number) {
      log.push(`start ${index}`);
      started[index]?.resolve();
      await gates[index]?.promise;
      log.push(`finish ${index}`);
      return index;
    },
  };
  return { sdk, log, gates, started };
}

test('a third call waits for one of the first two to finish', async () => {
  const { sdk, log, gates, started } = heldSdk(3);
  const limited = limitCalls(sdk, callLimit(2));

  const calls = [limited.call(0), limited.call(1), limited.call(2)];
  await Promise.all([started[0]?.promise, started[1]?.promise]);
  gates[0]?.resolve();
  await started[2]?.promise;
  gates[1]?.resolve();
  gates[2]?.resolve();

  expect(await Promise.all(calls)).toEqual([0, 1, 2]);
  expect(log.slice(0, 4)).toEqual([
    'start 0',
    'start 1',
    'finish 0',
    'start 2',
  ]);
});

test('waiting calls start in the order they were made', async () => {
  const { sdk, log, gates, started } = heldSdk(3);
  const limited = limitCalls(sdk, callLimit(1));

  const calls = [limited.call(0), limited.call(1), limited.call(2)];
  await started[0]?.promise;
  gates[0]?.resolve();
  await started[1]?.promise;
  gates[1]?.resolve();
  await started[2]?.promise;
  gates[2]?.resolve();

  await Promise.all(calls);
  expect(log).toEqual([
    'start 0',
    'finish 0',
    'start 1',
    'finish 1',
    'start 2',
    'finish 2',
  ]);
});

test('a call that fails frees its slot', async () => {
  const { sdk, gates, started } = heldSdk(2);
  const limited = limitCalls(sdk, callLimit(1));

  const failing = limited.call(0).then(
    () => 'resolved',
    (error: Error) => error.message,
  );
  const next = limited.call(1);
  await started[0]?.promise;
  gates[0]?.reject(new Error('search failed'));
  await started[1]?.promise;
  gates[1]?.resolve();

  expect(await failing).toBe('search failed');
  expect(await next).toBe(1);
});

test('a call that throws before returning a promise frees its slot', async () => {
  const limited = limitCalls(
    {
      throws(): Promise<number> {
        throw new Error('bad arguments');
      },
      async answers() {
        return 1;
      },
    },
    callLimit(1),
  );

  await expect(limited.throws()).rejects.toThrow('bad arguments');
  expect(await limited.answers()).toBe(1);
});

test('rejects a limit that is not a positive integer', () => {
  for (const limit of [0, -1, 1.5, Number.NaN]) {
    expect(() => callLimit(limit)).toThrow(RangeError);
  }
});
