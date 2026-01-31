import { describe, expect, it } from 'vitest';
import { shouldResetVirtualList } from '../utils/virtualList';

describe('shouldResetVirtualList', () => {
  it('does not reset on initial load', () => {
    expect(shouldResetVirtualList([], ['a'])).toBe(false);
    expect(shouldResetVirtualList(['a'], [])).toBe(false);
  });

  it('does not reset for append or prepend', () => {
    expect(shouldResetVirtualList(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    expect(shouldResetVirtualList(['a', 'b'], ['z', 'a', 'b'])).toBe(false);
  });

  it('does not reset for removing from start or end', () => {
    expect(shouldResetVirtualList(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    expect(shouldResetVirtualList(['a', 'b', 'c'], ['b', 'c'])).toBe(false);
  });

  it('resets for middle inserts or removals', () => {
    expect(shouldResetVirtualList(['a', 'b', 'c'], ['a', 'b', 'x', 'c'])).toBe(
      true
    );
    expect(shouldResetVirtualList(['a', 'b', 'c'], ['a', 'c'])).toBe(true);
  });
});
