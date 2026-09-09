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
    expect(openInNewSplitForMention({ altKey: false, shiftKey: false })).toBe(
      true
    );
  });

  it('prefers a new split on Shift+click instead of inverting', () => {
    expect(openInNewSplitForMention({ shiftKey: true })).toBe(true);
  });

  it('opens in the current split when Option (alt) is held', () => {
    expect(openInNewSplitForMention({ altKey: true })).toBe(false);
  });

  it('defaults to current split when there is no event (e.g. touch)', () => {
    expect(openInNewSplitForMention(undefined)).toBe(false);
    expect(openInNewSplitForMention(null)).toBe(false);
  });

  it('always opens in the current split on touch devices', () => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    expect(openInNewSplitForMention({ shiftKey: true })).toBe(false);
    expect(openInNewSplitForMention({ altKey: false, shiftKey: false })).toBe(
      false
    );
  });
});
