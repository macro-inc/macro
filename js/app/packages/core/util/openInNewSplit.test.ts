import { describe, expect, it } from 'vitest';
import { openInNewSplitForMention } from './openInNewSplit';

describe('openInNewSplitForMention', () => {
  it('opens in a new split by default for mouse/keyboard interactions', () => {
    expect(openInNewSplitForMention(false, true)).toBe(true);
  });

  it('opens in the current split when Option (alt) is held', () => {
    expect(openInNewSplitForMention(true, true)).toBe(false);
  });

  it('defaults to current split when there is no event (e.g. touch)', () => {
    expect(openInNewSplitForMention(undefined, false)).toBe(false);
  });
});
