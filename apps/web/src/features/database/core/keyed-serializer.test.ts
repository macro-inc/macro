import { describe, expect, it } from 'vitest';
import { createKeyedSerializer } from './keyed-serializer';

describe('keyed serializer', () => {
  it('runs one key’s tasks in queue order and another key’s alongside them', async () => {
    const serializer = createKeyedSerializer();
    const order: string[] = [];
    const { promise: firstGate, resolve: openFirst } =
      Promise.withResolvers<void>();

    const first = serializer.run('view', async () => {
      await firstGate;
      order.push('view: first');
    });
    const second = serializer.run('view', async () => {
      order.push('view: second');
    });
    await serializer.run('other', async () => {
      order.push('other');
    });
    openFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(['other', 'view: first', 'view: second']);
  });

  it('runs the next task after a rejected one and hands the rejection to its caller', async () => {
    const serializer = createKeyedSerializer();

    const failed = serializer.run('view', async () => {
      throw new Error('refused');
    });
    const next = serializer.run('view', async () => 'ran');

    await expect(failed).rejects.toThrow('refused');
    expect(await next).toBe('ran');
  });
});
