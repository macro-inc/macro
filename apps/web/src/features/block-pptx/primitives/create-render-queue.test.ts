import { describe, expect, it } from 'vitest';
import { createRenderQueue } from './create-render-queue';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('render queue', () => {
  it('holds background work while urgent work runs', async () => {
    const queue = createRenderQueue();
    const order: string[] = [];
    const slow = deferred<void>();
    const urgent = queue.urgent(async () => {
      order.push('urgent:start');
      await slow.promise;
      order.push('urgent:end');
    });
    const bg = queue.background(async () => {
      order.push('background');
      return 1;
    });
    await Promise.resolve();
    expect(order).toEqual(['urgent:start']);
    slow.resolve();
    await urgent;
    expect(await bg).toBe(1);
    expect(order).toEqual(['urgent:start', 'urgent:end', 'background']);
  });

  it('runs background jobs one at a time and drops unwanted ones', async () => {
    const queue = createRenderQueue();
    let running = 0;
    let peak = 0;
    const job = (value: number) => async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return value;
    };
    const results = await Promise.all([
      queue.background(job(1)),
      queue.background(job(2), () => false),
      queue.background(job(3)),
    ]);
    expect(results).toEqual([1, undefined, 3]);
    expect(peak).toBe(1);
  });
});
