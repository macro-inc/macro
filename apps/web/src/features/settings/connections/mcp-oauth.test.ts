import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignOauthUrl, reserveOauthPopup } from './mcp-oauth';

const openExternalUrl = vi.fn();

vi.mock('@core/util/platform', () => ({
  isTauri: () => false,
}));

vi.mock('@core/util/url', () => ({
  openExternalUrl: (...args: unknown[]) => openExternalUrl(...args),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('reserveOauthPopup', () => {
  it('opens a blank tab and severs opener during the call', () => {
    const popup = { opener: window, location: { href: '' } };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as Window);
    const reserved = reserveOauthPopup();
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(reserved).toBe(popup);
    expect(popup.opener).toBeNull();
  });
});

describe('assignOauthUrl', () => {
  it('assigns the reserved popup when one exists', () => {
    const popup = { location: { href: '' } } as Window;
    assignOauthUrl(popup, 'https://oauth.example/start');
    expect(popup.location.href).toBe('https://oauth.example/start');
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('falls back to openExternalUrl when the popup is missing', () => {
    assignOauthUrl(null, 'https://oauth.example/start');
    expect(openExternalUrl).toHaveBeenCalledWith('https://oauth.example/start');
  });
});
