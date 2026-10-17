import { afterEach, describe, expect, it, vi } from 'vitest';
import { LANDING_REFERRER_KEY } from '../../../app/utils/landingReferrer';
import { journeyHref, routePhoneToMobileSignup } from './navigation';

const setViewport = (phone: boolean) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: phone ? 390 : 1280,
  });
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: phone && query.includes('pointer: coarse'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as MediaQueryList
  );
};

describe('phone signup navigation', () => {
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('sends a phone to /mobile-signup with the landing query and external referrer', () => {
    setViewport(true);
    vi.spyOn(document, 'referrer', 'get').mockReturnValue(
      'https://instagram.com/'
    );
    window.history.replaceState(
      {},
      '',
      '/?utm_source=ig&utm_medium=cpc&utm_campaign=Macro_MobileSignUps'
    );
    expect(journeyHref()).toBe(
      '/mobile-signup?utm_source=ig&utm_medium=cpc&utm_campaign=Macro_MobileSignUps'
    );
    expect(sessionStorage.getItem(LANDING_REFERRER_KEY)).toBe(
      'https://instagram.com/'
    );
  });

  it('leaves desktop signup on /app/signup', () => {
    setViewport(false);
    window.history.replaceState({}, '', '/?utm_source=ig');
    const event = new MouseEvent('click', { cancelable: true });
    routePhoneToMobileSignup(event);
    expect(event.defaultPrevented).toBe(false);
    expect(window.location.pathname).toBe('/');
    expect(journeyHref()).toBe('/app/signup');
  });
});
