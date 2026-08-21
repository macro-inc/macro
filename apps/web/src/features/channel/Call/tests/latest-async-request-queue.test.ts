import { describe, expect, it, vi } from 'vitest';
import { createLatestAsyncRequestQueue } from '../latest-async-request-queue';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

function createDeferred(): Deferred {
  let resolve: () => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function nextMicrotask(): Promise<void> {
  await Promise.resolve();
}

describe('createLatestAsyncRequestQueue', () => {
  it('executes requests strictly one at a time', async () => {
    const executions = [createDeferred(), createDeferred()];
    let activeExecutions = 0;
    let maximumActiveExecutions = 0;
    const executor = vi.fn(async () => {
      const execution = executions[executor.mock.calls.length - 1];
      activeExecutions += 1;
      maximumActiveExecutions = Math.max(
        maximumActiveExecutions,
        activeExecutions
      );
      await execution.promise;
      activeExecutions -= 1;
    });
    const enqueue = createLatestAsyncRequestQueue(executor);

    const first = enqueue('first');
    const second = enqueue('second');

    expect(executor).toHaveBeenCalledTimes(1);
    executions[0].resolve();
    await first;
    expect(executor).toHaveBeenCalledTimes(2);
    expect(maximumActiveExecutions).toBe(1);

    executions[1].resolve();
    await second;
    expect(maximumActiveExecutions).toBe(1);
  });

  it('retains only the latest request received during an execution', async () => {
    const firstExecution = createDeferred();
    const executor = vi.fn(async (request: string) => {
      if (request === 'first') await firstExecution.promise;
    });
    const enqueue = createLatestAsyncRequestQueue(executor);

    const first = enqueue('first');
    const replaced = enqueue('replaced');
    const latest = enqueue('latest');

    expect(executor).toHaveBeenCalledTimes(1);
    firstExecution.resolve();
    await Promise.all([first, replaced, latest]);

    expect(executor.mock.calls).toEqual([['first'], ['latest']]);
  });

  it('suppresses duplicate active and pending requests', async () => {
    const firstExecution = createDeferred();
    const secondExecution = createDeferred();
    const executor = vi.fn(async (request: string) => {
      if (request === 'first') await firstExecution.promise;
      if (request === 'second') await secondExecution.promise;
    });
    const enqueue = createLatestAsyncRequestQueue(executor);

    const first = enqueue('first');
    const duplicateActive = enqueue('first');
    const second = enqueue('second');
    const duplicatePending = enqueue('second');

    firstExecution.resolve();
    await Promise.all([first, duplicateActive]);
    expect(executor.mock.calls).toEqual([['first'], ['second']]);

    secondExecution.resolve();
    await Promise.all([second, duplicatePending]);
    expect(executor.mock.calls).toEqual([['first'], ['second']]);
  });

  it('settles callers whose requests are replaced by the latest request', async () => {
    const firstExecution = createDeferred();
    const latestExecution = createDeferred();
    const executor = vi.fn(async (request: number) => {
      if (request === 1) await firstExecution.promise;
      if (request === 3) await latestExecution.promise;
    });
    const enqueue = createLatestAsyncRequestQueue(executor);
    let replacedSettled = false;

    const first = enqueue(1);
    const replaced = enqueue(2).finally(() => {
      replacedSettled = true;
    });
    const latest = enqueue(3);

    firstExecution.resolve();
    await first;
    expect(replacedSettled).toBe(false);

    latestExecution.resolve();
    await Promise.all([replaced, latest]);
    expect(replacedSettled).toBe(true);
  });

  it('continues with pending and later requests after executor rejection', async () => {
    const failedExecution = createDeferred();
    const executor = vi.fn(async (request: string) => {
      if (request === 'fails') await failedExecution.promise;
    });
    const enqueue = createLatestAsyncRequestQueue(executor);
    const failure = new Error('device switch failed');

    const failed = enqueue('fails');
    const pending = enqueue('pending');
    failedExecution.reject(failure);

    await expect(failed).rejects.toBe(failure);
    await expect(pending).resolves.toBeUndefined();
    await expect(enqueue('later')).resolves.toBeUndefined();
    expect(executor.mock.calls).toEqual([['fails'], ['pending'], ['later']]);
  });

  it('allows consumers to discard stale requests without blocking the queue', async () => {
    let currentCall = 'new-call';
    const applied: string[] = [];
    const enqueue = createLatestAsyncRequestQueue(async (call: string) => {
      if (call !== currentCall) return;
      applied.push(call);
    });

    await enqueue('old-call');
    await enqueue(currentCall);
    currentCall = 'newer-call';
    await enqueue(currentCall);
    await nextMicrotask();

    expect(applied).toEqual(['new-call', 'newer-call']);
  });
});
