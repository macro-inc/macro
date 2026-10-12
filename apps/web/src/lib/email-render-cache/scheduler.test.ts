import { describe, expect, it } from 'vitest';
import { PreparationScheduler } from './scheduler';

describe('preparation priority queue', () => {
  it('promotes queued foreground work, skips cancelled work, and does not preempt a running parser', async () => {
    const scheduler = new PreparationScheduler();
    let finish!: () => void;
    const order: string[] = [];
    const active = scheduler.schedule(
      () => 3,
      () => true,
      async () => {
        order.push('active');
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
    );
    await Promise.resolve();
    let priority = 4;
    const speculative = scheduler.schedule(
      () => 3,
      () => true,
      async () => {
        order.push('speculative');
      }
    );
    const promoted = scheduler.schedule(
      () => priority,
      () => true,
      async () => {
        order.push('foreground');
      }
    );
    priority = 0;
    let valid = true;
    const cancelled = scheduler.schedule(
      () => 0,
      () => valid,
      async () => {
        order.push('cancelled');
      }
    );
    const rejected = expect(cancelled).rejects.toMatchObject({
      name: 'AbortError',
    });
    valid = false;
    finish();
    await Promise.all([active, speculative, promoted, rejected]);
    expect(order).toEqual(['active', 'foreground', 'speculative']);
    scheduler.dispose();
  });
});
