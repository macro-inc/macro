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

  it('opens in a new split when that is the default', () => {
    expect(openInNewSplitForMention(true)).toBe(true);
  });

  it('stays in the current split when that is the default', () => {
    expect(openInNewSplitForMention(false)).toBe(false);
  });

  it('always opens in the current split on touch devices', () => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    expect(openInNewSplitForMention(true)).toBe(false);
  });
});
