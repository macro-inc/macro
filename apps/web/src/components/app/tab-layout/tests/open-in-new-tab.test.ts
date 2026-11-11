import { setGlobalTabManager } from '@app/signal/tabLayout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canOpenInNewTab, openInNewTab } from '../open-in-new-tab';
import { consumeOpenInNewTabIntent } from '../open-in-tab-intent';
import type { TabManager } from '../tab-manager';

afterEach(() => {
  setGlobalTabManager(undefined);
  consumeOpenInNewTabIntent();
});

describe('openInNewTab', () => {
  it('is not offered, and does nothing, without desktop tabs', () => {
    const open = vi.fn();
    expect(canOpenInNewTab()).toBe(false);
    expect(openInNewTab(open)).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
    expect(consumeOpenInNewTabIntent()).toBeUndefined();
  });

  it('runs the ordinary open with an intent to switch to the new tab', () => {
    setGlobalTabManager({} as TabManager);
    const open = vi.fn(() => {
      expect(consumeOpenInNewTabIntent()).toEqual({ activate: true });
      return 'opened';
    });
    expect(canOpenInNewTab()).toBe(true);
    expect(openInNewTab(open)).toBe('opened');
    expect(open).toHaveBeenCalledOnce();
  });

  it('expires an intent no navigation consumed', () => {
    setGlobalTabManager({} as TabManager);
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    openInNewTab(() => undefined);
    now.mockReturnValue(10_000);
    expect(consumeOpenInNewTabIntent()).toBeUndefined();
  });
});
