import { describe, expect, it, vi } from 'vitest';
import { anyAbortSignal } from './abort-signal';

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
