import { describe, expect, it } from 'vitest';
import {
  accumulateExplicitScrollDownDistance,
  hasExplicitScrollDownGesture,
  isExplicitScrollDown,
  shouldStickToBottomOnDataChange,
} from '../ThreadList';

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

  it('does not stick while prepending', () => {
    expect(
      shouldStickToBottomOnDataChange(
        true,
        () => false,
        () => true
      )
    ).toBe(false);
  });
});

describe('isExplicitScrollDown', () => {
  it('returns true only for recent explicit down intent', () => {
    expect(
      isExplicitScrollDown(24, { direction: 'down', at: 1000 }, 1100)
    ).toBe(true);
  });

  it('returns false when intent is missing, stale, or not downward', () => {
    expect(isExplicitScrollDown(24, undefined, 1100)).toBe(false);
    expect(isExplicitScrollDown(24, { direction: 'up', at: 1000 }, 1100)).toBe(
      false
    );
    expect(
      isExplicitScrollDown(24, { direction: 'down', at: 1000 }, 1300)
    ).toBe(false);
  });

  it('returns false when scroll delta is not positive', () => {
    expect(isExplicitScrollDown(0, { direction: 'down', at: 1000 }, 1100)).toBe(
      false
    );
    expect(
      isExplicitScrollDown(-8, { direction: 'down', at: 1000 }, 1100)
    ).toBe(false);
  });
});

describe('accumulateExplicitScrollDownDistance', () => {
  it('accumulates distance for recent explicit downward intent', () => {
    expect(
      accumulateExplicitScrollDownDistance(
        20,
        16,
        { direction: 'down', at: 1000 },
        1100
      )
    ).toBe(36);
  });

  it('resets when movement is not explicitly downward', () => {
    expect(
      accumulateExplicitScrollDownDistance(
        20,
        -8,
        { direction: 'down', at: 1000 },
        1100
      )
    ).toBe(0);
    expect(
      accumulateExplicitScrollDownDistance(
        20,
        8,
        { direction: 'up', at: 1000 },
        1100
      )
    ).toBe(0);
  });
});

describe('hasExplicitScrollDownGesture', () => {
  it('requires a minimum accumulated downward distance', () => {
    expect(hasExplicitScrollDownGesture(63)).toBe(false);
    expect(hasExplicitScrollDownGesture(64)).toBe(true);
  });
});
