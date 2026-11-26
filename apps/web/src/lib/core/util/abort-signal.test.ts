import { describe, expect, it, vi } from 'vitest';
import { empty, fromArray, make } from 'wonka';
import { anyAbortSignal, firstOrAborted, untilAborted } from './abort-signal';

describe('anyAbortSignal', () => {
  it('aborts with the reason of the first input to abort', () => {
    const first = new AbortController();
    const second = new AbortController();
    const signal = anyAbortSignal([first.signal, second.signal]);

    second.abort('second');
    first.abort('first');

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('second');
  });

  it('starts aborted when an input already is', () => {
    const signal = anyAbortSignal([
      new AbortController().signal,
      AbortSignal.abort('done'),
    ]);

    expect(signal.aborted).toBe(true);
    expect(signal.reason).toBe('done');
  });

  it('detaches from a long-lived input once it aborts', () => {
    const longLived = new AbortController();
    const shortLived = new AbortController();
    const add = vi.spyOn(longLived.signal, 'addEventListener');
    anyAbortSignal([longLived.signal, shortLived.signal]);

    shortLived.abort();

    const options = add.mock.calls[0]?.[2];
    expect(typeof options === 'object' && options.signal?.aborted).toBe(true);
  });
});

describe('untilAborted', () => {
  it('rejects with the reason once the signal aborts, though the work never settles', async () => {
    const controller = new AbortController();
    const ignored = new Promise<string>(() => {});

    const raced = untilAborted(ignored, controller.signal);
    controller.abort('deadline');

    await expect(raced).rejects.toBe('deadline');
  });

  it('rejects at once when the signal already aborted', async () => {
    await expect(
      untilAborted(Promise.resolve('late'), AbortSignal.abort('done'))
    ).rejects.toBe('done');
  });

  it('settles as the work does and stops listening', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');

    await expect(
      untilAborted(Promise.resolve('read'), controller.signal)
    ).resolves.toBe('read');
    await expect(
      untilAborted(Promise.reject(new Error('failed')), controller.signal)
    ).rejects.toThrow('failed');

    for (const call of add.mock.calls) {
      const options = call[2];
      expect(typeof options === 'object' && options.signal?.aborted).toBe(true);
    }
    expect(add).toHaveBeenCalledTimes(2);
  });
});

describe('firstOrAborted', () => {
  it('leaves the source once the signal aborts', async () => {
    let left = false;
    const held = make<string>(() => () => {
      left = true;
    });
    const controller = new AbortController();

    const settled = firstOrAborted(held, controller.signal);
    controller.abort();

    await expect(settled).resolves.toEqual({ kind: 'aborted' });
    expect(left).toBe(true);
  });

  it('takes the first value, or says the source ended without one', async () => {
    await expect(
      firstOrAborted(fromArray(['a', 'b']), undefined)
    ).resolves.toEqual({ kind: 'value', value: 'a' });
    await expect(firstOrAborted(empty, undefined)).resolves.toEqual({
      kind: 'ended',
    });
  });
});
