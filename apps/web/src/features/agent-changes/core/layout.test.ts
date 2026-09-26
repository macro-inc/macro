import { describe, expect, it } from 'vitest';
import {
  clampChangesShare,
  clampFileTreeWidth,
  DEFAULT_CHANGES_SHARE,
  DEFAULT_FILE_TREE_WIDTH,
  ensureChangesVisible,
  isChangesVisible,
  isSessionVisible,
  MAX_FILE_TREE_WIDTH,
  MIN_FILE_TREE_WIDTH,
  toggleChanges,
  toggleSpotlight,
} from './layout';

describe('layout moves', () => {
  it('toggles the pane from the session header', () => {
    expect(toggleChanges('agent-only')).toBe('split');
    expect(toggleChanges('split')).toBe('agent-only');
    expect(toggleChanges('changes-only')).toBe('agent-only');
  });

  it('spotlights and comes back', () => {
    expect(toggleSpotlight('split')).toBe('changes-only');
    expect(toggleSpotlight('changes-only')).toBe('split');
    expect(toggleSpotlight('agent-only')).toBe('changes-only');
  });

  it('only opens a closed pane', () => {
    expect(ensureChangesVisible('agent-only')).toBe('split');
    expect(ensureChangesVisible('changes-only')).toBe('changes-only');
    expect(ensureChangesVisible('split')).toBe('split');
  });

  it('knows which panes are on screen', () => {
    expect(isChangesVisible('agent-only')).toBe(false);
    expect(isSessionVisible('changes-only')).toBe(false);
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

describe('clampFileTreeWidth', () => {
  it('keeps the width inside the bounds and recovers from junk', () => {
    expect(clampFileTreeWidth(40)).toBe(MIN_FILE_TREE_WIDTH);
    expect(clampFileTreeWidth(4000)).toBe(MAX_FILE_TREE_WIDTH);
    expect(clampFileTreeWidth(300.4)).toBe(300);
    expect(clampFileTreeWidth(Number.NaN)).toBe(DEFAULT_FILE_TREE_WIDTH);
  });
});
