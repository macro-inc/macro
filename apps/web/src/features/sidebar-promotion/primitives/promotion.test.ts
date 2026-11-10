import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hidePromotion,
  hidePromotionUntilCommitted,
  isPromotionHiddenLocally,
} from './promotion';

const host = vi.hoisted(() => ({ dismiss: vi.fn() }));
vi.mock('@queries/prompt-dismissals', () => ({
  dismissPromptEverywhere: host.dismiss,
}));

beforeEach(() => host.dismiss.mockClear());
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('sidebar promotion dismissal', () => {
  it('dismisses on the server once and mirrors it per user and promotion', () => {
    hidePromotion('alice', 'import:files');
    hidePromotion('alice', 'import:files');
    expect(host.dismiss).toHaveBeenCalledTimes(1);
    expect(host.dismiss).toHaveBeenCalledWith('import:files');
    expect(isPromotionHiddenLocally('alice', 'import:files')).toBe(true);
    expect(
      localStorage.getItem('sidebar-promotion:v1:import%3Afiles:alice')
    ).toBe('hidden');
    expect(isPromotionHiddenLocally('alice', 'calendar')).toBe(false);
    expect(isPromotionHiddenLocally('bob', 'import:files')).toBe(false);
  });

  it('restores a previously mirrored dismissal', () => {
    localStorage.setItem('sidebar-promotion:v1:home:saved', 'hidden');
    expect(isPromotionHiddenLocally('saved', 'home')).toBe(true);
  });

  it('still hides in memory when storage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    hidePromotion('offline', 'pull-requests');
    expect(isPromotionHiddenLocally('offline', 'pull-requests')).toBe(true);
    expect(host.dismiss).toHaveBeenCalledWith('pull-requests');
  });

  it('ignores an unknown user', () => {
    hidePromotion(undefined, 'home');
    expect(host.dismiss).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('hides at once but dismisses everywhere only once committed', () => {
    const pending = hidePromotionUntilCommitted('alice', 'routines:email');
    expect(isPromotionHiddenLocally('alice', 'routines:email')).toBe(true);
    expect(host.dismiss).not.toHaveBeenCalled();
    pending.commit();
    pending.undo();
    expect(host.dismiss).toHaveBeenCalledExactlyOnceWith('routines:email');
    expect(isPromotionHiddenLocally('alice', 'routines:email')).toBe(true);
  });

  it('shows it again on undo, and the server never hears of it', () => {
    const pending = hidePromotionUntilCommitted('alice', 'routines:calls');
    expect(isPromotionHiddenLocally('alice', 'routines:calls')).toBe(true);
    pending.undo();
    pending.commit();
    expect(isPromotionHiddenLocally('alice', 'routines:calls')).toBe(false);
    expect(host.dismiss).not.toHaveBeenCalled();
  });

  it('dismisses everywhere if the page goes away before undo', () => {
    hidePromotionUntilCommitted('alice', 'routines:tasks');
    window.dispatchEvent(new Event('pagehide'));
    expect(host.dismiss).toHaveBeenCalledExactlyOnceWith('routines:tasks');
  });
});
