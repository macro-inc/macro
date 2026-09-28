import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CalculationWorker,
  createCalculationClient,
} from './calculation-client';

afterEach(() => vi.useRealTimers());

function worker() {
  const result: CalculationWorker = {
    postMessage: vi.fn(),
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
  };
  return result;
}

describe('calculation worker lifetime', () => {
  it('terminates a hung calculation and starts a fresh worker on retry', async () => {
    vi.useFakeTimers();
    const first = worker();
    const second = worker();
    const factory = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const client = createCalculationClient(factory, 100);
    expect(factory).not.toHaveBeenCalled();
    const hung = client.run({ type: 'calculate', cells: {}, rowCount: 200 });
    first.onmessage?.call(
      first as Worker,
      new MessageEvent('message', { data: { id: 1, type: 'started' } })
    );
    const rejection = expect(hung).rejects.toThrow('exceeded');
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(first.terminate).toHaveBeenCalledOnce();
    const retry = client.run({
      type: 'calculate',
      cells: { A1: { value: '42' } },
      rowCount: 200,
    });
    second.onmessage?.call(
      second as Worker,
      new MessageEvent('message', {
        data: {
          id: 2,
          type: 'calculate',
          values: { A1: { display: '42', number: 42 } },
        },
      })
    );
    expect(await retry).toMatchObject({ values: { A1: { number: 42 } } });
    client.dispose();
  });

  it('ignores stale results and cancels pending work when disposed', async () => {
    const first = worker();
    const second = worker();
    const client = createCalculationClient(
      vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    );
    const old = client.run({ type: 'calculate', cells: {}, rowCount: 200 });
    const oldRejection = expect(old).rejects.toThrow('cancelled');
    const next = client.run({ type: 'calculate', cells: {}, rowCount: 300 });
    await oldRejection;
    first.onmessage?.call(
      first as Worker,
      new MessageEvent('message', {
        data: {
          id: 1,
          type: 'calculate',
          values: { A1: { display: 'stale' } },
        },
      })
    );
    const nextRejection = expect(next).rejects.toThrow('cancelled');
    client.dispose();
    await nextRejection;
    expect(second.terminate).toHaveBeenCalledOnce();
  });
});
