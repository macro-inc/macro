/**
 * Adversarial worker behavior for the preparation executor. These currently
 * hold; they pin down the failure modes the README promises.
 */
import { prepareEmailBody } from '@macro-inc/email-renderer';
import { afterEach, expect, it, vi } from 'vitest';
import { createPreparationExecutor } from './executor';
import { digest, sourceTuple } from './keys';
import type { WorkerRequest, WorkerResponse } from './worker-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: MessageEvent<WorkerResponse>) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  requests: WorkerRequest[] = [];
  terminated = 0;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(request: WorkerRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated++;
  }
  respond(data: WorkerResponse) {
    this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
  }
}

afterEach(() => {
  FakeWorker.instances = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const big = {
  html: `<p>${'y'.repeat(300 * 1024)}</p>`,
  text: 'z'.repeat(1024),
};
const small = { html: '<p>small</p>' };

it('falls back for every in-flight request when the worker errors, and ignores its late replies', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const executor = createPreparationExecutor();
  const first = executor.prepare(big, {});
  const second = executor.prepare(small, { showQuotedContent: true }, 3);
  const worker = FakeWorker.instances[0];
  expect(worker.requests).toHaveLength(2);
  worker.onerror?.();
  expect(await first).toEqual(prepareEmailBody(big, {}));
  expect(await second).toEqual(
    prepareEmailBody(small, { showQuotedContent: true })
  );
  // A late reply for a request that already fell back must not throw or
  // resolve anything twice.
  worker.respond({ id: worker.requests[0].id, result: 'garbage' });
  expect(worker.terminated).toBe(1);
  // Further work never restarts the worker.
  expect(await executor.prepare(small, {}, 2)).toEqual(prepareEmailBody(small));
  expect(FakeWorker.instances).toHaveLength(1);
  executor.dispose();
});

it('treats messageerror and a 15 s watchdog like a crash', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.stubGlobal('Worker', FakeWorker);
  const crashed = createPreparationExecutor();
  const pending = crashed.prepare(small, {}, 2);
  FakeWorker.instances[0].onmessageerror?.();
  expect(await pending).toEqual(prepareEmailBody(small));
  crashed.dispose();

  const hung = createPreparationExecutor();
  const slow = hung.prepare(big, {});
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await slow).toEqual(prepareEmailBody(big));
  expect(FakeWorker.instances[1].terminated).toBe(1);
  hung.dispose();
});

it('a worker-side failure falls back to the main thread with the correct result', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const executor = createPreparationExecutor();
  const result = executor.prepare(small, {}, 1);
  const worker = FakeWorker.instances[0];
  worker.respond({ id: worker.requests[0].id, error: 'Preparation failed' });
  expect(await result).toEqual(prepareEmailBody(small));
  executor.dispose();
});

it('routes speculative source hashing to the worker only after it is ready, with correct ids', async () => {
  vi.stubGlobal('Worker', FakeWorker);
  const executor = createPreparationExecutor();
  // Not ready yet: hashing stays direct.
  expect(await executor.hashSource(small, 3)).toBe(
    await digest(sourceTuple(small))
  );
  expect(FakeWorker.instances).toHaveLength(0);
  const prepared = executor.prepare(small, {}, 2);
  const worker = FakeWorker.instances[0];
  worker.respond({
    id: worker.requests[0].id,
    result: prepareEmailBody(small),
  });
  await prepared;
  const hashed = executor.hashSource(big, 3);
  expect(worker.requests[1].kind).toBe('source');
  // Out-of-order and unknown ids are ignored.
  worker.respond({ id: 999, result: 'wrong' });
  worker.respond({ id: worker.requests[1].id, result: 'from-worker' });
  expect(await hashed).toBe('from-worker');
  executor.dispose();
  await expect(executor.hashSource(small, 3)).rejects.toThrow('disposed');
  await expect(executor.hash('x')).rejects.toThrow('disposed');
});
