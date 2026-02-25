import { describe, expect, it } from 'vitest';
import { shouldStickToBottomOnDataChange } from './ThreadList';

describe('shouldStickToBottomOnDataChange', () => {
  it('sticks when near bottom and not shifting', () => {
    expect(shouldStickToBottomOnDataChange(true)).toBe(true);
    expect(shouldStickToBottomOnDataChange(true, () => false)).toBe(true);
  });

  it('does not stick when not near bottom', () => {
    expect(shouldStickToBottomOnDataChange(false)).toBe(false);
    expect(shouldStickToBottomOnDataChange(false, () => false)).toBe(false);
    expect(shouldStickToBottomOnDataChange(false, () => true)).toBe(false);
  });

  it('does not stick while shifting', () => {
    expect(shouldStickToBottomOnDataChange(true, () => true)).toBe(false);
  });
});
