import { describe, expect, it } from 'vitest';
import {
  createInvocationAllocator,
  MAX_INVOCATION,
} from './invocation-allocator';

describe('createInvocationAllocator', () => {
  it('issues each token once, in order, from 1 by default', () => {
    const allocator = createInvocationAllocator();
    expect([allocator.next(), allocator.next(), allocator.next()]).toEqual([
      1, 2, 3,
    ]);
  });

  it('the largest token is the native u32 maximum', () => {
    expect(MAX_INVOCATION).toBe(4_294_967_295);
  });

  it('issues max and then throws without wrapping', () => {
    const allocator = createInvocationAllocator(MAX_INVOCATION - 1);
    expect(allocator.next()).toBe(MAX_INVOCATION - 1);
    expect(allocator.next()).toBe(MAX_INVOCATION);
    expect(() => allocator.next()).toThrow(
      'AI edit invocation tokens are exhausted for this editor'
    );
    // Still exhausted: a failed call issues nothing and does not wrap to 1.
    expect(() => allocator.next()).toThrow(
      'AI edit invocation tokens are exhausted for this editor'
    );
  });

  it('an empty range constructs exhausted', () => {
    const allocator = createInvocationAllocator(5, 4);
    expect(() => allocator.next()).toThrow(
      'AI edit invocation tokens are exhausted for this editor'
    );
  });

  it('a one-token range issues it once', () => {
    const allocator = createInvocationAllocator(7, 7);
    expect(allocator.next()).toBe(7);
    expect(() => allocator.next()).toThrow(
      'AI edit invocation tokens are exhausted for this editor'
    );
  });

  for (const [first, max] of [
    [0, 10],
    [-1, 10],
    [1.5, 10],
    [Number.NaN, 10],
    [1, MAX_INVOCATION + 1],
    [1, Number.POSITIVE_INFINITY],
    [1, 2.5],
  ] as const) {
    it(`rejects the invalid range first=${first} max=${max}`, () => {
      expect(() => createInvocationAllocator(first, max)).toThrow(
        'Invalid AI edit invocation range'
      );
    });
  }

  it('separate allocators do not share tokens', () => {
    const a = createInvocationAllocator();
    const b = createInvocationAllocator();
    expect([a.next(), b.next(), a.next()]).toEqual([1, 1, 2]);
  });
});
