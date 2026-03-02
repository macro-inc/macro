import { describe, expect, it } from 'vitest';
import {
  getInnerRailBottom,
  innerRailTop,
  innerRailX,
  replyCenterOffsetX,
  threadConnectorStyle,
  threadOffsetX,
} from '../thread-rail-geometry';

describe('thread-rail-geometry', () => {
  it('exports stable offsets for thread layout alignment', () => {
    expect(replyCenterOffsetX).toBe(
      'calc(var(--user-icon-width) / 2 + var(--body-padding))'
    );
    expect(threadOffsetX).toBe(
      'calc(var(--left-of-connector) + var(--thread-shift) - var(--user-icon-width) / 2 - var(--body-padding))'
    );
    expect(innerRailX).toBe(
      'calc(var(--left-of-connector) + var(--thread-shift))'
    );
    expect(innerRailTop).toBe(
      'calc(var(--body-padding) + var(--user-icon-width) / 2)'
    );
  });

  it('exposes connector style geometry', () => {
    expect(threadConnectorStyle).toEqual({
      left: 'calc(var(--left-of-connector) - 8px)',
      top: 'calc(var(--body-padding) + var(--user-icon-width) / 2 - 20px)',
      width: 'calc(var(--thread-shift) + 2px)',
      height: '18px',
    });
  });

  it('extends inner rail to bottom while replying', () => {
    expect(getInnerRailBottom(true)).toBe('0px');
    expect(getInnerRailBottom(false)).toBe(
      'calc(var(--user-icon-width) / 2 + 0.5rem)'
    );
  });
});
