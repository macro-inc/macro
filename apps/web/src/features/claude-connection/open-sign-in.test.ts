// @vitest-environment jsdom

import { isTauri } from '@core/util/platform';
import { openExternalUrl } from '@core/util/url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openClaudeSignIn } from './open-sign-in';

vi.mock('@core/util/platform', () => ({ isTauri: vi.fn(() => false) }));
vi.mock('@core/util/url', () => ({ openExternalUrl: vi.fn() }));
afterEach(() => vi.restoreAllMocks());

describe('Claude sign-in navigation', () => {
  it('reserves an isolated tab with no referrer and navigates it once ready', () => {
    const popup = {
      opener: window,
      document: document.implementation.createHTMLDocument(),
      closed: false,
      location: { replace: vi.fn() },
      close: vi.fn(),
    };
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue(popup as unknown as Window);
    const signIn = openClaudeSignIn();
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(popup.opener).toBeNull();
    expect(
      popup.document
        .querySelector('meta[name="referrer"]')
        ?.getAttribute('content')
    ).toBe('no-referrer');
    signIn?.navigate('https://claude.com/consent');
    expect(popup.location.replace).toHaveBeenCalledWith(
      'https://claude.com/consent'
    );
    signIn?.close();
    expect(popup.close).toHaveBeenCalledOnce();
  });
  it('returns no reserved tab when blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openClaudeSignIn()).toBeUndefined();
  });
  it('uses the native external browser without opening a blank tab', () => {
    vi.mocked(isTauri).mockReturnValueOnce(true);
    const open = vi.spyOn(window, 'open');
    const signIn = openClaudeSignIn();
    expect(open).not.toHaveBeenCalled();
    signIn?.navigate('https://claude.com/consent');
    expect(openExternalUrl).toHaveBeenCalledWith('https://claude.com/consent');
  });
});
