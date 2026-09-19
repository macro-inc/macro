import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openInNewSplitForMention } from './openInNewSplit';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: vi.fn(() => false),
}));

describe('openInNewSplitForMention', () => {
  afterEach(() => {
    vi.mocked(isTouchDevice).mockReturnValue(false);
  });

  it('opens in a new split by default for mouse/keyboard interactions', () => {
    expect(openInNewSplitForMention(false, true)).toBe(true);
  });

  it('opens in the current split when Option (alt) is held', () => {
    expect(openInNewSplitForMention(true, true)).toBe(false);
  });

  it('defaults to current split when there is no event (e.g. touch)', () => {
    expect(openInNewSplitForMention(undefined, false)).toBe(false);
  });

  it('always opens in the current split on touch devices', () => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    expect(openInNewSplitForMention(false, true)).toBe(false);
  });
});
