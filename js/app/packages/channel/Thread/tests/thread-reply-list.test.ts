import { describe, expect, it } from 'vitest';
import { getReplyElementAtIndex } from '../utils/reply-list-navigation';

describe('getReplyElementAtIndex', () => {
  it('returns the element at the requested index', () => {
    const first = {} as HTMLElement;
    const second = {} as HTMLElement;

    expect(getReplyElementAtIndex([first, second], 1)).toBe(second);
  });

  it('returns undefined for negative or missing indexes', () => {
    const first = {} as HTMLElement;

    expect(getReplyElementAtIndex([first], -1)).toBeUndefined();
    expect(getReplyElementAtIndex([first], 3)).toBeUndefined();
  });
});
