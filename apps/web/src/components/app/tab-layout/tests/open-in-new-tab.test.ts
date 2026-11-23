import { setGlobalTabManager } from '@app/signal/tabLayout';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canOpenInNewTab, openInNewTab } from '../open-in-new-tab';
import { consumeOpenInNewTabIntent } from '../open-in-tab-intent';
import type { TabManager } from '../tab-manager';

afterEach(() => {
  setGlobalTabManager(undefined);
  consumeOpenInNewTabIntent();
  vi.restoreAllMocks();
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

  it('holds the intent while an async open waits, then lets it expire', async () => {
    setGlobalTabManager({} as TabManager);
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    let finish!: () => void;
    const pending = openInNewTab(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );

    now.mockReturnValue(60_000);
    finish();
    await pending;
    await Promise.resolve();
    // Released at 60s: still armed just after, gone once a click's window passes.
    now.mockReturnValue(60_100);
    expect(consumeOpenInNewTabIntent()).toEqual({ activate: true });

    openInNewTab(() => undefined);
    now.mockReturnValue(120_000);
    expect(consumeOpenInNewTabIntent()).toBeUndefined();
  });
});
