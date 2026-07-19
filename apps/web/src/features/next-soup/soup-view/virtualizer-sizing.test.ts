import { describe, expect, it } from 'vitest';
import { resolveSoupVirtualizerSizing } from './virtualizer-sizing';

describe('resolveSoupVirtualizerSizing', () => {
  it('leaves item size unset so heterogeneous rows are measured', () => {
    expect(resolveSoupVirtualizerSizing(undefined, 5)).toEqual({
      itemSize: undefined,
      bufferSize: 200,
    });
  });

  it('preserves an explicit fixed row size', () => {
    expect(resolveSoupVirtualizerSizing(72, 5)).toEqual({
      itemSize: 72,
      bufferSize: 360,
    });
  });
});
