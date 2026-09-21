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
