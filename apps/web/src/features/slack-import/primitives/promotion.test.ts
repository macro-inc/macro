import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hideSlackImportPromotion,
  isSlackImportPromotionHidden,
} from './promotion';

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Slack import promotion persistence', () => {
  it('persists dismissal and isolates users and teams', () => {
    hideSlackImportPromotion('alice', 'team-one');
    expect(isSlackImportPromotionHidden('alice', 'team-one')).toBe(true);
    expect(
      localStorage.getItem('slack-import-promotion:v1:team-one:alice')
    ).toBe('hidden');
    expect(isSlackImportPromotionHidden('bob', 'team-one')).toBe(false);
    expect(isSlackImportPromotionHidden('alice', 'team-two')).toBe(false);
  });

  it('restores a previously saved dismissal', () => {
    localStorage.setItem('slack-import-promotion:v1:saved:user', 'hidden');
    expect(isSlackImportPromotionHidden('user', 'saved')).toBe(true);
  });

  it('continues to hide in memory when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    hideSlackImportPromotion('offline', 'team');
    expect(isSlackImportPromotionHidden('offline', 'team')).toBe(true);
  });

  it('does not persist an unknown user or team', () => {
    hideSlackImportPromotion(undefined, 'team');
    hideSlackImportPromotion('unknown', undefined);
    expect(isSlackImportPromotionHidden(undefined, 'team')).toBe(false);
    expect(isSlackImportPromotionHidden('unknown', undefined)).toBe(false);
    expect(localStorage.length).toBe(0);
  });
});
