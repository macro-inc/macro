import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createComposeOperation } from './compose-operation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe('compose operations', () => {
  it('keeps progress pending until concurrent requests and completion effects finish', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const completion = deferred<void>();
    const root = createRoot((dispose) => ({
      dispose,
      operation: createComposeOperation(
        (input: number) => (input === 1 ? first.promise : second.promise),
        { onSuccess: () => completion.promise }
      ),
    }));
    try {
      const a = root.operation.run(1);
      const b = root.operation.run(2);
      expect(root.operation.pending()).toBe(true);
      first.resolve('first');
      await Promise.resolve();
      expect(root.operation.result()).toBe('first');
      expect(root.operation.pending()).toBe(true);
      completion.resolve();
      await a;
      expect(root.operation.pending()).toBe(true);
      second.resolve('second');
      await b;
      expect(root.operation.pending()).toBe(false);
    } finally {
      root.dispose();
    }
  });
  it('reports a failure once, clears progress, and permits another attempt', async () => {
    const fail = vi
      .fn()
      .mockRejectedValueOnce('offline')
      .mockResolvedValueOnce('saved');
    const onError = vi.fn();
    const root = createRoot((dispose) => ({
      dispose,
      operation: createComposeOperation(fail, { onError }),
    }));
    try {
      await expect(root.operation.run('draft')).rejects.toThrow('offline');
      expect(onError).toHaveBeenCalledWith(expect.any(Error), 'draft');
      expect(root.operation.pending()).toBe(false);
      expect(await root.operation.run('draft')).toBe('saved');
      expect(onError).toHaveBeenCalledOnce();
    } finally {
      root.dispose();
    }
  });
});
