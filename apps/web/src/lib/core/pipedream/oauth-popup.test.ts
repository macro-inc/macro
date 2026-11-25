import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/util/platform', () => ({ isTauri: () => false }));

import { reserveOauthPopup } from './oauth-popup';

function stubTab() {
  const tab = { opener: window as Window | null };
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  return tab;
}

describe('reserveOauthPopup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('cuts the tab off from this one by default', () => {
    const tab = stubTab();
    expect(reserveOauthPopup()).toBe(tab);
    expect(window.open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
  });

  it('keeps the link when asked, so the tab can be retired later', () => {
    const tab = stubTab();
    expect(reserveOauthPopup({ keepOpener: true })).toBe(tab);
    expect(tab.opener).toBe(window);
  });
});
