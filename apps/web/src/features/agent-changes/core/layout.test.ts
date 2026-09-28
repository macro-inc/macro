import { describe, expect, it } from 'vitest';
import {
  clampChangesShare,
  DEFAULT_CHANGES_SHARE,
  ensureChangesVisible,
  isChangesVisible,
  isSessionVisible,
  toggleChanges,
  toggleSpotlight,
} from './layout';

describe('layout moves', () => {
  it('toggles the pane from the session header', () => {
    expect(toggleChanges('closed')).toBe('split');
    expect(toggleChanges('split')).toBe('closed');
    expect(toggleChanges('full')).toBe('closed');
  });

  it('spotlights and comes back', () => {
    expect(toggleSpotlight('split')).toBe('full');
    expect(toggleSpotlight('full')).toBe('split');
    expect(toggleSpotlight('closed')).toBe('full');
  });

  it('only opens a closed pane', () => {
    expect(ensureChangesVisible('closed')).toBe('split');
    expect(ensureChangesVisible('full')).toBe('full');
    expect(ensureChangesVisible('split')).toBe('split');
  });

  it('knows which panes are on screen', () => {
    expect(isChangesVisible('closed')).toBe(false);
    expect(isSessionVisible('full')).toBe(false);
    expect(isChangesVisible('split') && isSessionVisible('split')).toBe(true);
  });
});

describe('clampChangesShare', () => {
  it('keeps the share inside the bounds and recovers from junk', () => {
    expect(clampChangesShare(10)).toBe(22);
    expect(clampChangesShare(90)).toBe(74);
    expect(clampChangesShare(50)).toBe(50);
    expect(clampChangesShare(Number.NaN)).toBe(DEFAULT_CHANGES_SHARE);
  });
});
